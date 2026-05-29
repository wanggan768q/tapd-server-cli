/**
 * `tapd-server-cli login` 子命令实现。
 *
 * 流程：
 *   1) 调 src/auth/browser-login.ts 的 launchAndGrabCookie() 弹独立 Chrome/Edge
 *   2) 用户登录 → 抓 TAPD cookie 头
 *   3) 用 src/auth/cookie-store.ts 的 save() 写到 ~/.config/tapd-mcp/cookie（POSIX 600）
 *   4) stdout 打 ✓ 一行；exit 0
 *
 * 失败：抛错 → stderr 经 redact 脱敏 + exit 1。
 *
 * 注入点（测试用）：opts.deps 可覆盖 browser-login / cookie-store 入口。
 */

import { launchAndGrabCookie } from '../auth/browser-login.js';
import { createCookieStore } from '../auth/cookie-store.js';
import { redactError } from '../installer/redact.js';

export interface LoginCommandOptions {
  /** 总等待超时（秒）。CLI 默认 300，与 browser-login 默认一致。 */
  timeout?: number;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试注入：覆盖 launchAndGrabCookie / createCookieStore */
  deps?: {
    launchAndGrabCookie?: typeof launchAndGrabCookie;
    createCookieStore?: typeof createCookieStore;
  };
}

export interface LoginCommandResult {
  exitCode: 0 | 1;
  /** 仅成功时填充：cookie 落盘路径（用于回归测试） */
  savedTo?: string;
}

export async function loginCommand(opts: LoginCommandOptions = {}): Promise<LoginCommandResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const launch = opts.deps?.launchAndGrabCookie ?? launchAndGrabCookie;
  const makeStore = opts.deps?.createCookieStore ?? createCookieStore;

  const timeoutSeconds = opts.timeout ?? 300;
  const timeoutMs = timeoutSeconds * 1_000;

  try {
    const result = await launch({ timeoutMs });
    const store = makeStore();
    const { path } = await store.save(result.cookieHeader);
    stdout.write(`✓ Logged in. Cookie saved to ${path}\n`);
    stdout.write(`  ${result.cookieCount} cookie(s) captured for ${result.domainSuffix}\n`);
    return { exitCode: 0, savedTo: path };
  } catch (err) {
    const msg = redactError(err, {});
    stderr.write(`Error: ${msg}\n`);
    return { exitCode: 1 };
  }
}
