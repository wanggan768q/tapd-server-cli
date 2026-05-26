/**
 * 浏览器登录抓 cookie 模块。
 *
 * 工作流：
 *   1) 找本机 Chrome / Edge
 *   2) spawn 隔离窗口（独立 user-data-dir），打开 loginUrl
 *   3) 通过 CDP（Chrome DevTools Protocol）轮询所有 cookie
 *   4) 检测到 sessionCookieName 出现 → 拼成 'name1=v1; name2=v2; ...' 返回
 *   5) 关闭 CDP、SIGTERM Chrome、清理临时目录
 *
 * 此模块被两个入口共用：
 *   - `src/tools/login.ts`（MCP 工具 tapd.login）
 *   - `scripts/grab-cookie.mjs`（命令行兼容入口，写 ~/.claude.json）
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from 'pino';
import { WebSocket } from 'undici';

export const DEFAULT_LOGIN_URL = 'https://www.tapd.cn/cloud_logins/login';
export const DEFAULT_SESSION_COOKIE = 't_i_token';
export const DEFAULT_DOMAIN_SUFFIX = 'tapd.cn';
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_DEBUG_PORT = 9222;
export const DEFAULT_POLL_INTERVAL_MS = 2_000;

export class BrowserNotFoundError extends Error {
  constructor() {
    super('未在常见路径找到 Chrome 或 Edge');
    this.name = 'BrowserNotFoundError';
  }
}

export class LoginTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`超时未检测到 TAPD 登录态（等待 ${Math.round(timeoutMs / 1000)}s）`);
    this.name = 'LoginTimeoutError';
  }
}

export class LoginAbortedError extends Error {
  constructor() {
    super('登录流程被中止');
    this.name = 'LoginAbortedError';
  }
}

export class CdpConnectError extends Error {
  constructor(reason: string) {
    super(`无法连接到浏览器调试端口: ${reason}`);
    this.name = 'CdpConnectError';
  }
}

export interface LaunchLoginOptions {
  loginUrl?: string;
  sessionCookieName?: string;
  domainSuffix?: string;
  timeoutMs?: number;
  debugPort?: number;
  pollIntervalMs?: number;
  abortSignal?: AbortSignal;
  logger?: Logger;
  /** 覆盖浏览器查找逻辑（测试用） */
  findBrowser?: () => string | undefined;
}

export interface LaunchLoginResult {
  cookieHeader: string;
  cookieCount: number;
  domainSuffix: string;
  browserPath: string;
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
}

interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

function findChromeDefault(): string | undefined {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`
      : undefined,
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
    process.env.BROWSER,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  return candidates.find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

async function waitForJsonList(port: number, deadlineMs: number): Promise<string | undefined> {
  while (Date.now() < deadlineMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json/list`);
      if (res.ok) {
        const pages = (await res.json()) as Array<{
          type?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // 还没起来；继续轮询
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}

function cdpConnect(wsUrl: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = new Map<
      number,
      { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
    >();
    ws.addEventListener('message', (ev: { data: unknown }) => {
      let m: { id?: number; error?: { code: number; message: string }; result?: Record<string, unknown> };
      try {
        const text =
          typeof ev.data === 'string'
            ? ev.data
            : Buffer.from(ev.data as ArrayBuffer).toString('utf8');
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.id && pending.has(m.id)) {
        const slot = pending.get(m.id)!;
        pending.delete(m.id);
        if (m.error) slot.reject(new Error(`CDP ${m.error.code}: ${m.error.message}`));
        else slot.resolve(m.result ?? {});
      }
    });
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          const id = ++msgId;
          return new Promise<Record<string, unknown>>((r, j) => {
            pending.set(id, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
      }),
    );
    ws.addEventListener('error', (e: { message?: string }) =>
      reject(new CdpConnectError(e?.message ?? 'unknown')),
    );
  });
}

function buildCookieHeader(cookies: CdpCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * 启动浏览器、等用户登录、抓 cookie 拼成 `Cookie:` 头形态返回。
 *
 * 整个流程会在以下任一情况干净退出：
 *   - 成功（返回 LaunchLoginResult）
 *   - 超时（抛 LoginTimeoutError）
 *   - abort（抛 LoginAbortedError）
 *   - 浏览器找不到（抛 BrowserNotFoundError）
 *   - CDP 连接失败（抛 CdpConnectError）
 *
 * 异常路径同样保证关闭 CDP、SIGTERM 浏览器、删除临时 user-data-dir。
 */
export async function launchAndGrabCookie(
  opts: LaunchLoginOptions = {},
): Promise<LaunchLoginResult> {
  const loginUrl = opts.loginUrl ?? DEFAULT_LOGIN_URL;
  const sessionCookieName = opts.sessionCookieName ?? DEFAULT_SESSION_COOKIE;
  const domainSuffix = opts.domainSuffix ?? DEFAULT_DOMAIN_SUFFIX;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const debugPort = opts.debugPort ?? DEFAULT_DEBUG_PORT;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const find = opts.findBrowser ?? findChromeDefault;
  const logger = opts.logger;

  const browserPath = find();
  if (!browserPath) {
    throw new BrowserNotFoundError();
  }

  const tmpProfile = mkdtempSync(join(tmpdir(), 'tapd-cookie-'));
  logger?.info(
    { msg: 'browser_login_start', browser: browserPath, debug_port: debugPort },
    'spawning isolated browser for TAPD login',
  );

  let proc: ChildProcess | undefined;
  let cdp: CdpClient | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    try {
      proc?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpProfile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  const abortListener = () => {
    cleanup();
  };
  opts.abortSignal?.addEventListener('abort', abortListener);

  try {
    if (opts.abortSignal?.aborted) {
      throw new LoginAbortedError();
    }

    proc = spawn(
      browserPath,
      [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${tmpProfile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-service-autorun',
        loginUrl,
      ],
      { detached: false, stdio: 'ignore' },
    );

    const startupDeadline = Date.now() + 30_000;
    const wsUrl = await waitForJsonList(debugPort, startupDeadline);
    if (!wsUrl) {
      throw new CdpConnectError('浏览器启动后未在 30 秒内开放调试端口');
    }
    if (opts.abortSignal?.aborted) throw new LoginAbortedError();

    cdp = await cdpConnect(wsUrl);
    logger?.info({ msg: 'browser_login_cdp_ready' }, 'CDP connected, waiting for user login');

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (opts.abortSignal?.aborted) throw new LoginAbortedError();
      const res = (await cdp.send('Network.getAllCookies')) as {
        cookies?: CdpCookie[];
      };
      const tapd = (res.cookies ?? []).filter((c) => c.domain.includes(domainSuffix));
      if (tapd.some((c) => c.name === sessionCookieName)) {
        const cookieHeader = buildCookieHeader(tapd);
        logger?.info(
          { msg: 'browser_login_grabbed', cookie_count: tapd.length, domain: domainSuffix },
          'TAPD session detected; cookie grabbed',
        );
        return {
          cookieHeader,
          cookieCount: tapd.length,
          domainSuffix,
          browserPath,
        };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new LoginTimeoutError(timeoutMs);
  } finally {
    opts.abortSignal?.removeEventListener('abort', abortListener);
    cleanup();
  }
}
