/**
 * 基于 session cookie 的 www.tapd.cn 域 HTTP 客户端。
 *
 * 与 `TapdHttpClient` 完全独立：不同 base URL、不同鉴权（Cookie 头）、
 * 不同响应格式（二进制下载 vs JSON 包络）。
 *
 * 唯一接口 `downloadBinary(path, query)` 用于下载附件等二进制。
 *
 * cookie 失效检测启发式（见 spec tapd-web-client）：
 *   1) Content-Length ≤ 2 且 content-type 是 text/html
 *   2) 响应体起始 256 字节内含 `<title>登录-TAPD</title>`
 *   3) 请求 URL 含 `attachments/download` 且响应体起始为 `<!DOCTYPE html>`
 *
 * 命中任一启发式即抛 `TapdApiError(kind: 'unauthenticated', info: '... TAPD_WEB_COOKIE 已失效 ...')`
 */

import pLimit, { type LimitFunction } from 'p-limit';
import { Agent, request } from 'undici';

import type { Logger } from 'pino';

import { TapdApiError } from './errors.js';

export interface TapdWebClient {
  /**
   * 下载指定路径的二进制内容。
   * @param path  请求路径（相对 webBase，或绝对 URL）
   * @param query 查询参数
   * @param options 可选：覆盖基地址（如走 file.tapd.cn 子域）/ 追加请求头
   * @returns Uint8Array + 推断的 contentType + filename
   */
  downloadBinary(
    path: string,
    query?: Record<string, string | number | undefined>,
    options?: DownloadOptions,
  ): Promise<DownloadResult>;
  close(): Promise<void>;
}

export interface DownloadOptions {
  /** 覆盖客户端默认 base URL（仅本次请求） */
  base?: string;
  /** 追加请求头（不影响默认 Cookie/User-Agent） */
  extraHeaders?: Record<string, string>;
}

export interface DownloadResult {
  bytes: Uint8Array;
  contentType: string;
  filename: string | undefined;
  /** HTTP 状态码（成功路径恒为 200） */
  statusCode: number;
}

export interface TapdWebClientOptions {
  webBase: string;
  cookie: string;
  concurrency: number;
  timeoutMs: number;
  logger: Logger;
  /** 自定义默认 User-Agent；不传则使用 Chrome-like UA */
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
  httpRequest?: WebHttpRequestFn;
}

export interface WebHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  /** 响应原始字节 */
  body: Uint8Array;
}

export type WebHttpRequestFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<WebHttpResponse>;

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 4_000;
const RETRY_MAX_5XX = 2;
const SNIFF_BYTES = 256;
const LOGIN_TITLE = '<title>登录-TAPD</title>';
const HTML_PREFIX = '<!DOCTYPE html>';
const RATE_LIMIT_HINTS = ['下载过于频繁', '请求过于频繁', '稍后再试', '一分钟后再试'];
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultHttpRequest: WebHttpRequestFn = async (url, init) => {
  const res = await request(url, {
    method: init.method as 'GET',
    headers: init.headers,
    signal: init.signal,
    // 注：undici.request 默认不跟随重定向，301/302 会原样返回，正合我们意——
    // 失效检测要据 3xx + Location 判断 cookie 是否过期。
  });
  const buf = Buffer.from(await res.body.arrayBuffer());
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    headers[k.toLowerCase()] = v;
  }
  return { statusCode: res.statusCode, headers, body: new Uint8Array(buf) };
};

export function createTapdWebClient(options: TapdWebClientOptions): TapdWebClient {
  const defaultBase = options.webBase.replace(/\/$/, '');
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const limit: LimitFunction = pLimit(options.concurrency);
  const sleep = options.sleep ?? defaultSleep;
  const httpRequest = options.httpRequest ?? defaultHttpRequest;

  const agent = options.httpRequest ? undefined : new Agent({ keepAliveTimeout: 30_000 });

  async function exec(
    path: string,
    query: Record<string, string | number | undefined>,
    callOptions: DownloadOptions = {},
  ): Promise<DownloadResult> {
    const base = (callOptions.base ?? defaultBase).replace(/\/$/, '');
    const url = buildUrl(base, path, query);
    const headers: Record<string, string> = {
      Cookie: options.cookie,
      Accept: '*/*',
      'User-Agent': userAgent,
      ...(callOptions.extraHeaders ?? {}),
    };

    let attempt5xx = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      const started = Date.now();
      try {
        const res = await httpRequest(url, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timer);
        const durationMs = Date.now() - started;
        options.logger.debug({
          msg: 'tapd_web_request',
          path,
          base,
          statusCode: res.statusCode,
          durationMs,
          bytes: res.body.byteLength,
        });

        // 5xx 重试
        if (res.statusCode >= 500 && res.statusCode <= 599) {
          if (attempt5xx < RETRY_MAX_5XX) {
            const delay = Math.min(RETRY_BASE_MS * 2 ** attempt5xx, RETRY_CAP_MS);
            attempt5xx++;
            options.logger.warn({ msg: 'tapd_web_retry', statusCode: res.statusCode, delayMs: delay });
            await sleep(delay);
            continue;
          }
          throw new TapdApiError({
            kind: 'internal',
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `web client got ${res.statusCode}`,
          });
        }

        // 失效检测启发式
        const expired = detectExpired(url, res);
        if (expired) {
          throw new TapdApiError({
            kind: 'unauthenticated',
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `TAPD_WEB_COOKIE 已失效（${expired}）。请刷新浏览器 cookie 并更新 TAPD_WEB_COOKIE 环境变量后重启服务。`,
          });
        }

        // 速率限制检测：TAPD 在被打爆时返回 200 + 短 HTML + 中文提示
        const rateLimited = detectRateLimit(res);
        if (rateLimited) {
          throw new TapdApiError({
            kind: 'rate_limited',
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `TAPD 限速：${rateLimited}`,
          });
        }

        // 4xx (非失效)
        if (res.statusCode === 403) {
          throw new TapdApiError({
            kind: 'permission_denied',
            tapdStatus: 0,
            httpStatus: 403,
            info: `web client 403：当前 cookie 用户对该资源无访问权限`,
          });
        }
        if (res.statusCode === 404) {
          throw new TapdApiError({
            kind: 'not_found',
            tapdStatus: 0,
            httpStatus: 404,
            info: `web client 404：附件不存在或当前 cookie 用户无权访问`,
          });
        }
        if (res.statusCode >= 300 && res.statusCode < 400) {
          // 重定向（无 cookie 或 cookie 过期常见为 302 → /login）
          throw new TapdApiError({
            kind: 'unauthenticated',
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `TAPD_WEB_COOKIE 已失效（HTTP ${res.statusCode} 重定向到 ${pickHeader(res.headers, 'location') ?? '?'}）。请刷新 cookie 后重启服务。`,
          });
        }
        if (res.statusCode !== 200) {
          throw new TapdApiError({
            kind: 'unknown',
            tapdStatus: 0,
            httpStatus: res.statusCode,
            info: `unexpected web status ${res.statusCode}`,
          });
        }

        const contentType = pickHeader(res.headers, 'content-type') ?? 'application/octet-stream';
        const filename = parseFilename(pickHeader(res.headers, 'content-disposition'), path);
        return {
          bytes: res.body,
          contentType,
          filename,
          statusCode: 200,
        };
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof TapdApiError) throw err;
        if (controller.signal.aborted) {
          throw new TapdApiError({
            kind: 'internal',
            tapdStatus: 0,
            httpStatus: 0,
            info: `web client request timeout after ${options.timeoutMs}ms`,
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new TapdApiError({
          kind: 'internal',
          tapdStatus: 0,
          httpStatus: 0,
          info: `web client network error: ${msg}`,
        });
      }
    }
  }

  return {
    downloadBinary(path, query, callOptions) {
      return limit(() => exec(path, query ?? {}, callOptions));
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

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function detectExpired(url: string, res: WebHttpResponse): string | undefined {
  const ct = (pickHeader(res.headers, 'content-type') ?? '').toLowerCase();
  // (1) 2 字节空响应 + html
  if (res.body.byteLength <= 2 && ct.includes('text/html')) {
    return '2 字节空 HTML 响应';
  }
  if (ct.includes('text/html')) {
    const sniff = decodeUtf8Slice(res.body, SNIFF_BYTES);
    // (2) 登录页 title
    if (sniff.includes(LOGIN_TITLE)) return '响应是 TAPD 登录页';
    // (3) 下载路径却拿到 html 文档
    if (url.includes('attachments/download') && sniff.startsWith(HTML_PREFIX)) {
      return '附件下载路径返回了 HTML 文档';
    }
  }
  return undefined;
}

function detectRateLimit(res: WebHttpResponse): string | undefined {
  // 速率限制特征：HTTP 200 + 短 HTML + 中文限速文案。典型 ~42 字节 text/html。
  // 不限定大小：万一 TAPD 改变包装，仅按中文 token 判即可。
  const ct = (pickHeader(res.headers, 'content-type') ?? '').toLowerCase();
  if (!ct.includes('text/html')) return undefined;
  // 只看较短响应里的限速文案，避免把含相似文字的大 HTML 误判
  if (res.body.byteLength > 4 * 1024) return undefined;
  const text = decodeUtf8Slice(res.body, Math.min(res.body.byteLength, 1024));
  for (const hint of RATE_LIMIT_HINTS) {
    if (text.includes(hint)) return text.trim();
  }
  return undefined;
}

function decodeUtf8Slice(bytes: Uint8Array, max: number): string {
  const len = Math.min(bytes.byteLength, max);
  if (len === 0) return '';
  return Buffer.from(bytes.buffer, bytes.byteOffset, len).toString('utf8');
}

function parseFilename(
  contentDisposition: string | undefined,
  path: string,
): string | undefined {
  if (contentDisposition) {
    // 优先 filename*=
    const star = /filename\*\s*=\s*([^;]+)/i.exec(contentDisposition);
    if (star && star[1]) {
      const v = star[1].trim();
      // 形如 UTF-8''xxx
      const idx = v.indexOf("''");
      const enc = idx > 0 ? v.slice(idx + 2) : v;
      try {
        return decodeURIComponent(enc.replace(/^"|"$/g, ''));
      } catch {
        // ignore
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
    if (plain && plain[1]) return plain[1];
  }
  const seg = path.split('/').filter(Boolean);
  return seg.length > 0 ? seg[seg.length - 1] : undefined;
}
