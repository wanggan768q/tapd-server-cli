/**
 * 持久化凭据文件清理。
 *
 * 用于 `tapd-server-cli uninstall --purge` 路径,统一封装"删除 cookie 文件 +
 * 删除 token 文件"两个动作。每个文件独立处理,单文件失败不影响另一个。
 *
 * 边界(spec tapd-auth#uninstall --purge 的凭据清理边界):
 *   - 仅删除两个固定文件名:`cookie` 与 `token`。
 *   - MUST NOT 递归删除 `~/.config/tapd-mcp/` 目录。
 *   - MUST NOT 触碰目录下的其它文件。
 *   - MUST NOT 读取被删除文件的内容(避免日志意外泄露)。
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_DIR = join(homedir(), '.config', 'tapd-mcp');
const COOKIE_FILE_NAME = 'cookie';
const TOKEN_FILE_NAME = 'token';

export type PurgeOutcome =
  | { status: 'removed' }
  | { status: 'not_present' }
  | { status: 'failed'; error: string };

export interface PurgeResult {
  cookie: PurgeOutcome;
  token: PurgeOutcome;
  /** 实际尝试删除的文件路径(诊断用) */
  paths: { cookie: string; token: string };
}

export interface PurgePersistentFilesOptions {
  /** 覆盖根目录,便于测试。默认 ~/.config/tapd-mcp */
  baseDir?: string;
}

/**
 * 删除 server 自有的两个持久化凭据文件。
 *
 * 行为:
 *   - 文件存在且 unlink 成功 → `{ status: 'removed' }`
 *   - 文件不存在(ENOENT) → `{ status: 'not_present' }`,**不报错**
 *   - 其它错误(EACCES、EBUSY 等) → `{ status: 'failed', error: '<message>' }`
 *
 * 两个文件并行尝试删除,任一失败不影响另一个。
 */
export async function purgePersistentFiles(
  opts: PurgePersistentFilesOptions = {},
): Promise<PurgeResult> {
  const baseDir = opts.baseDir ?? DEFAULT_DIR;
  const cookiePath = join(baseDir, COOKIE_FILE_NAME);
  const tokenPath = join(baseDir, TOKEN_FILE_NAME);

  const [cookie, token] = await Promise.all([
    purgeOne(cookiePath),
    purgeOne(tokenPath),
  ]);

  return {
    cookie,
    token,
    paths: { cookie: cookiePath, token: tokenPath },
  };
}

async function purgeOne(path: string): Promise<PurgeOutcome> {
  try {
    await fs.unlink(path);
    return { status: 'removed' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { status: 'not_present' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: message };
  }
}

/**
 * 探测是否存在任一持久化凭据文件,用于 uninstall(无 --purge)末尾追加提示行。
 *
 * 仅做存在性检查,不读内容。
 */
export async function hasAnyPersistentFile(
  opts: PurgePersistentFilesOptions = {},
): Promise<{ cookie: boolean; token: boolean }> {
  const baseDir = opts.baseDir ?? DEFAULT_DIR;
  const cookiePath = join(baseDir, COOKIE_FILE_NAME);
  const tokenPath = join(baseDir, TOKEN_FILE_NAME);

  const [cookie, token] = await Promise.all([exists(cookiePath), exists(tokenPath)]);
  return { cookie, token };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
