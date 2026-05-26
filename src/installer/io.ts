/**
 * Installer 公共 IO：备份 + atomic 写。
 *
 * 行为：
 *   - 写前若文件存在 → 备份到 <path>.bak.<timestamp>
 *   - 写：先写 <path>.tmp，再 rename 到 <path>
 *   - mkdir -p 目标目录
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface WriteOutcome {
  path: string;
  backup: string | undefined;
}

export async function backupAndWrite(
  path: string,
  content: string,
): Promise<WriteOutcome> {
  await fs.mkdir(dirname(path), { recursive: true });

  let backup: string | undefined;
  try {
    await fs.access(path);
    backup = `${path}.bak.${Date.now()}`;
    await fs.copyFile(path, backup);
  } catch {
    // 文件不存在 → 无需备份
  }

  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, path);

  return { path, backup };
}

export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
