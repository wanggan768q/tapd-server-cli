import pLimit, { type LimitFunction } from 'p-limit';
import { Agent, request } from 'undici';

import type { Logger } from 'pino';

import { classifyError, TapdApiError, type TapdEnvelope, unwrapEnvelope } from './errors.js';

/**
 * TAPD HTTP 客户端公开接口。
 *
 * - 成功时返回响应包络中的 `data` 字段
 * - 失败时抛出 {@link TapdApiError}（已分类为 unauthenticated / permission_denied 等）
 */
export interface TapdHttpClient {
  get<T = unknown>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T>;
  post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export interface TapdHttpClientOptions {
  apiBase: string;
  token: string;
  concurrency: number;
  timeoutMs: number;
  logger: Logger;
  /** 用于测试注入可控时间的 sleep 函数 */
  sleep?: (ms: number) => Promise<void>;
  /** 用于测试覆盖底层 HTTP 调用；默认使用 undici.request */
  httpRequest?: HttpRequestFn;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export type HttpRequestFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<HttpResponse>;

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 4_000;
const RETRY_MAX_429 = 3;
const RETRY_MAX_5XX = 2;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultHttpRequest: HttpRequestFn = async (url, init) => {
  const res = await request(url, {
    method: init.method as 'GET' | 'POST',
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  const body = await res.body.text();
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    headers[k.toLowerCase()] = v;
  }
  return { statusCode: res.statusCode, headers, body };
};

export function createTapdHttpClient(options: TapdHttpClientOptions): TapdHttpClient {
  const base = options.apiBase.replace(/\/$/, '');
  const limit: LimitFunction = pLimit(options.concurrency);
  const sleep = options.sleep ?? defaultSleep;
  const httpRequest = options.httpRequest ?? defaultHttpRequest;

  // keep-alive Agent，仅在使用默认 httpRequest 时生效；测试注入时不创建
  const agent = options.httpRequest ? undefined : new Agent({ keepAliveTimeout: 30_000 });

  async function exec<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = buildUrl(base, path, query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let attempt429 = 0;
    let attempt5xx = 0;

    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      const started = Date.now();
      try {
        const res = await httpRequest(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const durationMs = Date.now() - started;
        options.logger.debug({ msg: 'tapd_request', method, path, statusCode: res.statusCode, durationMs });

        const envelope = parseEnvelope<T>(res.body, res.statusCode);
        const retryAfterMs = parseRetryAfter(res.headers['retry-after']);

        if (envelope === null) {
          // 非 JSON 响应（如 502 网关 HTML）→ 用 HTTP 状态分类
          const kind = classifyError({ bodyStatus: 0, httpStatus: res.statusCode });
          const err = new TapdApiError({
            kind,
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `non-json response (length=${res.body.length})`,
            requestId: undefined,
            retryAfterMs,
          });
          if (shouldRetry(kind, attempt429, attempt5xx)) {
            const delay = nextDelay(kind, attempt429, attempt5xx, retryAfterMs);
            if (kind === 'rate_limited') attempt429++;
            if (kind === 'internal') attempt5xx++;
            options.logger.warn({ msg: 'tapd_retry', kind, delayMs: delay, attempt429, attempt5xx });
            await sleep(delay);
            continue;
          }
          throw err;
        }

        try {
          return unwrapEnvelope<T>(envelope, res.statusCode, retryAfterMs);
        } catch (err) {
          if (err instanceof TapdApiError && shouldRetry(err.kind, attempt429, attempt5xx)) {
            const delay = nextDelay(err.kind, attempt429, attempt5xx, retryAfterMs);
            if (err.kind === 'rate_limited') attempt429++;
            if (err.kind === 'internal') attempt5xx++;
            options.logger.warn({
              msg: 'tapd_retry',
              kind: err.kind,
              delayMs: delay,
              attempt429,
              attempt5xx,
              requestId: err.requestId,
            });
            await sleep(delay);
            continue;
          }
          throw err;
        }
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof TapdApiError) throw err;
        if (controller.signal.aborted) {
          throw new TapdApiError({
            kind: 'internal',
            tapdStatus: 0,
            httpStatus: 0,
            info: `request timeout after ${options.timeoutMs}ms`,
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new TapdApiError({
          kind: 'internal',
          tapdStatus: 0,
          httpStatus: 0,
          info: `network error: ${msg}`,
        });
      }
    }
  }

  return {
    get<T>(path: string, query?: Record<string, string | number | undefined>) {
      return limit(() => exec<T>('GET', path, query));
    },
    post<T>(path: string, body: Record<string, unknown>) {
      return limit(() => exec<T>('POST', path, {}, body));
    },
    async close() {
      if (agent) await agent.close();
    },
  };
}

function buildUrl(
  base: string,
  path: string,
  query: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function parseEnvelope<T>(body: string, _httpStatus: number): TapdEnvelope<T> | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Partial<TapdEnvelope<T>>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as TapdEnvelope<T>).status === 'number'
    ) {
      return {
        status: (parsed as TapdEnvelope<T>).status,
        data: (parsed as TapdEnvelope<T>).data,
        info: (parsed as TapdEnvelope<T>).info ?? '',
        meta: (parsed as TapdEnvelope<T>).meta,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  if (!header) return undefined;
  const v = Array.isArray(header) ? header[0] : header;
  if (!v) return undefined;
  const seconds = Number(v);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return undefined;
}

function shouldRetry(
  kind: import('./errors.js').TapdErrorKind,
  attempt429: number,
  attempt5xx: number,
): boolean {
  if (kind === 'rate_limited') return attempt429 < RETRY_MAX_429;
  if (kind === 'internal') return attempt5xx < RETRY_MAX_5XX;
  return false;
}

function nextDelay(
  kind: import('./errors.js').TapdErrorKind,
  attempt429: number,
  attempt5xx: number,
  retryAfterMs: number | undefined,
): number {
  if (kind === 'rate_limited' && retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, RETRY_CAP_MS);
  }
  const n = kind === 'rate_limited' ? attempt429 : attempt5xx;
  return Math.min(RETRY_BASE_MS * 2 ** n, RETRY_CAP_MS);
}
