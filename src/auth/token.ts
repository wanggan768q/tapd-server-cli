import { promises as fs } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { CliArgs } from '../config.js';

const USER_TOKEN_FILE = join(homedir(), '.config', 'tapd-mcp', 'token');
const SAFE_FILE_MODE_MASK = 0o077; // 任何 group/other 位都视为不安全

export interface LoadTokenInput {
  cli: CliArgs;
  env: NodeJS.ProcessEnv;
  /** 覆盖用户级配置文件路径，便于测试 */
  userFilePath?: string;
}

export interface LoadedToken {
  token: string;
  source: 'cli' | 'env' | 'file';
}

export class TokenLoadError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'TokenLoadError';
  }
}

/**
 * 按优先级 CLI > env > 用户文件加载令牌。
 *
 * - 文件模式：仅 *nix 平台强制 mode 600；Windows 平台跳过权限检查（NTFS ACL 与 POSIX mode 语义不一致）。
 * - 未找到令牌时返回 null（由调用方决定如何报错，配合 ConfigError）。
 */
export async function loadToken(input: LoadTokenInput): Promise<LoadedToken | null> {
  if (input.cli.token) {
    return { token: input.cli.token, source: 'cli' };
  }
  const envToken = input.env.TAPD_TOKEN;
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: 'env' };
  }

  const filePath = input.userFilePath ?? USER_TOKEN_FILE;
  const fileToken = await readTokenFile(filePath);
  if (fileToken) {
    return { token: fileToken, source: 'file' };
  }

  return null;
}

async function readTokenFile(filePath: string): Promise<string | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!stat.isFile()) return null;

  if (platform() !== 'win32') {
    const mode = stat.mode & 0o777;
    if ((mode & SAFE_FILE_MODE_MASK) !== 0) {
      throw new TokenLoadError(
        `令牌文件 ${filePath} 权限不安全（mode=${mode.toString(8).padStart(3, '0')}）`,
        '请执行: chmod 600 ' + filePath,
      );
    }
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const token = raw.trim();
  return token.length > 0 ? token : null;
}
