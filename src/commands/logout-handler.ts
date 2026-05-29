/**
 * `tapd-server-cli logout` 子命令实现。
 *
 * 流程：
 *   1) createCookieStore().clear() —— 删 ~/.config/tapd-mcp/cookie（如存在）
 *   2) 文件存在被删 → "✓ Logged out. Cookie cleared."
 *   3) 文件不存在 → "= No cookie file found, nothing to clear."
 *   4) IO 错（权限等）→ stderr "Error: ..." + exit 1
 */

import { createCookieStore } from '../auth/cookie-store.js';

export interface LogoutCommandOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试注入：覆盖 createCookieStore */
  deps?: {
    createCookieStore?: typeof createCookieStore;
  };
}

export interface LogoutCommandResult {
  exitCode: 0 | 1;
  cleared: boolean;
}

export async function logoutCommand(
  opts: LogoutCommandOptions = {},
): Promise<LogoutCommandResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const makeStore = opts.deps?.createCookieStore ?? createCookieStore;

  try {
    const store = makeStore();
    const { path, existed } = await store.clear();
    if (existed) {
      stdout.write(`✓ Logged out. Cookie cleared (${path}).\n`);
      return { exitCode: 0, cleared: true };
    }
    stdout.write(`= No cookie file found, nothing to clear (${path}).\n`);
    return { exitCode: 0, cleared: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`Error: ${msg}\n`);
    return { exitCode: 1, cleared: false };
  }
}
