import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { Logger } from 'pino';

/**
 * `~/.tapd/tapd.config.json`（或项目级对应文件）的读写。
 *
 * Schema (v1)：
 *   {
 *     "schemaVersion": 1,
 *     "version": "<package version>",
 *     "installedAt": "<ISO 8601>",
 *     "scope": "user" | "project",
 *     "role": "user",
 *     "clients": ["claude-code", ...],
 *     "skills": [
 *       { "name": "tapd-overview", "version": "...", "writtenSha256": "...", "path": "..." }
 *     ],
 *     "defaults"?: { "workspaceId"?: string }
 *   }
 *
 * 读 (`readTapdConfig`)：
 *   - 文件不存在 → 返回 undefined
 *   - schemaVersion > SUPPORTED_VERSION → 抛 IncompatibleConfigError（CLI 退出码 1 由调用方处理）
 *   - JSON 解析错 → 抛错（不静默修复，避免吞数据）
 *
 * 写 (`writeTapdConfig`)：
 *   - 自动 mkdir -p
 *   - tmp 文件 + rename 原子写
 *   - JSON 缩进 2 空格（便于 diff / 手改）
 *
 * 合并 (`mergeSkillEntries`)：
 *   - 按 `name` 去重；新条目覆盖旧条目
 *   - 已存在但本次未列出的 skill MUST 保留（让单次安装可以仅装子集）
 */

const SUPPORTED_SCHEMA_VERSION = 1;

export type Scope = 'user' | 'project';

export type ClientKey = 'claude-code' | 'codex' | 'cursor' | 'opencode';

export type Role = 'user';

export interface SkillEntry {
  name: string;
  version: string;
  writtenSha256: string;
  path: string;
}

export interface TapdConfigDefaults {
  workspaceId?: string;
}

export interface TapdConfig {
  schemaVersion: number;
  version: string;
  installedAt: string;
  scope: Scope;
  role: Role;
  clients: ClientKey[];
  skills: SkillEntry[];
  defaults?: TapdConfigDefaults;
}

export class IncompatibleConfigError extends Error {
  override readonly name = 'IncompatibleConfigError';
  constructor(
    public readonly foundVersion: number,
    public readonly supportedVersion: number,
    public readonly path: string,
  ) {
    super(
      `tapd.config.json schemaVersion=${foundVersion} 高于本版 tapd-server-cli 支持的 ${supportedVersion}（${path}）。请升级 tapd-server-cli。`,
    );
  }
}

export interface ReadOptions {
  logger?: Logger;
}

/**
 * 读取 tapd.config.json。
 *
 * 不存在 → undefined
 * schemaVersion 过新 → throw IncompatibleConfigError
 * ���它错（JSON 解析 / 权限 / 等）→ 透传抛错
 */
export async function readTapdConfig(
  path: string,
  options: ReadOptions = {},
): Promise<TapdConfig | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    options.logger?.warn(
      { msg: 'tapd_config_parse_failed', path, reason: (err as Error).message },
      'tapd.config.json JSON 解析失败',
    );
    throw err;
  }

  const cfg = parsed as Partial<TapdConfig>;
  const v = cfg.schemaVersion;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`tapd.config.json 缺少有效的 schemaVersion (${path})`);
  }
  if (v > SUPPORTED_SCHEMA_VERSION) {
    throw new IncompatibleConfigError(v, SUPPORTED_SCHEMA_VERSION, path);
  }

  return cfg as TapdConfig;
}

export interface WriteOptions {
  logger?: Logger;
}

/**
 * 原子写 tapd.config.json。
 *
 * - mkdir -p 自身父目录
 * - 写到 `<path>.tmp` 后 rename，避免半写状态被读者看到
 * - JSON.stringify(_, null, 2) 便于人工 diff
 */
export async function writeTapdConfig(
  path: string,
  config: TapdConfig,
  _options: WriteOptions = {},
): Promise<void> {
  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `writeTapdConfig: schemaVersion 必须是 ${SUPPORTED_SCHEMA_VERSION}，收到 ${config.schemaVersion}`,
    );
  }
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body = JSON.stringify(config, null, 2) + '\n';
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, path);
}

/**
 * 合并 skill 条目：按 name 去重，`incoming` 覆盖 `existing` 中同名条目，
 * 但保留 `existing` 中没在 `incoming` 列出的条目（让单次安装可以仅装子集）。
 */
export function mergeSkillEntries(
  existing: SkillEntry[],
  incoming: SkillEntry[],
): SkillEntry[] {
  const map = new Map<string, SkillEntry>();
  for (const e of existing) map.set(e.name, e);
  for (const e of incoming) map.set(e.name, e);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export { SUPPORTED_SCHEMA_VERSION };
