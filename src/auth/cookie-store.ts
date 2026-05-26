import { promises as fs, constants as fsConstants } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import type { Logger } from 'pino';

/**
 * Cookie 持久化模块。
 *
 * 来源优先级（load）：
 *   1) 环境变量 `TAPD_WEB_COOKIE`（非空）
 *   2) 文件 `~/.config/tapd-mcp/cookie`（POSIX 平台 mode 600；否则拒读 + warn）
 *   3) undefined
 *
 * 写（save）：仅写到文件；原子写（写 `.tmp` → rename）+ POSIX chmod 600。
 *
 * 与 PAT 处理不同：
 *   - PAT 不允许 server 自身写盘（tapd-auth#令牌不落盘）
 *   - cookie 是浏览器登录态，与 PAT 等同凭据但允许 server 持久化到自有目录
 *     （tapd-auth#令牌不落盘 的修订版）
 */

const SAFE_FILE_MODE_MASK = 0o077;
const DEFAULT_DIR = join(homedir(), '.config', 'tapd-mcp');
const COOKIE_FILE_NAME = 'cookie';

export type CookieSource = 'env' | 'file' | 'none';

export interface LoadedCookie {
  value: string;
  source: 'env' | 'file';
}

export interface CookieStore {
  /** env > file > undefined */
  load(): Promise<LoadedCookie | undefined>;
  /** 写到文件（atomic）+ POSIX chmod 600；不动 env */
  save(value: string): Promise<{ path: string }>;
  /** 删除 cookie 文件（如存在） */
  clear(): Promise<{ path: string; existed: boolean }>;
  /** cookie 文件完整路径（用于诊断 / 错误消息） */
  filePath(): string;
}

export interface CreateCookieStoreOptions {
  /** 覆盖文件根目录，便于测试。默认 ~/.config/tapd-mcp */
  baseDir?: string;
  /** 覆盖环境变量来源，便于测试。默认 process.env */
  env?: NodeJS.ProcessEnv;
  /** 用于记录权限不安全等告警 */
  logger?: Logger;
}

export function createCookieStore(opts: CreateCookieStoreOptions = {}): CookieStore {
  const baseDir = opts.baseDir ?? DEFAULT_DIR;
  const path = join(baseDir, COOKIE_FILE_NAME);
  const env = opts.env ?? process.env;
  const logger = opts.logger;

  return {
    filePath() {
      return path;
    },

    async load() {
      const envValue = env.TAPD_WEB_COOKIE;
      if (envValue && envValue.length > 0) {
        return { value: envValue, source: 'env' as const };
      }

      try {
        const stat = await fs.stat(path);
        if (!stat.isFile()) return undefined;

        if (platform() !== 'win32') {
          const mode = stat.mode & 0o777;
          if ((mode & SAFE_FILE_MODE_MASK) !== 0) {
            logger?.warn(
              {
                msg: 'cookie_file_mode_unsafe',
                path,
                mode: mode.toString(8).padStart(3, '0'),
              },
              'cookie 文件权限不安全（应为 600），将忽略文件 cookie',
            );
            return undefined;
          }
        }

        const raw = await fs.readFile(path, 'utf8');
        const trimmed = raw.trim();
        if (trimmed.length === 0) return undefined;
        return { value: trimmed, source: 'file' as const };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
      }
    },

    async save(value: string) {
      if (!value || value.length === 0) {
        throw new Error('cookie 值不能为空');
      }
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await fs.writeFile(tmp, value, { encoding: 'utf8', mode: 0o600 });
      if (platform() !== 'win32') {
        try {
          await fs.chmod(tmp, 0o600);
        } catch {
          // 某些 FS 不支持 chmod（如 WSL 挂载 NTFS）；不阻断
        }
      }
      await fs.rename(tmp, path);
      return { path };
    },

    async clear() {
      try {
        await fs.access(path, fsConstants.F_OK);
      } catch {
        return { path, existed: false };
      }
      await fs.unlink(path);
      return { path, existed: true };
    },
  };
}
