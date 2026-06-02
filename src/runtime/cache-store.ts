import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { Logger } from 'pino';

/**
 * `~/.tapd/cache.json` 的读写。
 *
 * Schema (v1)：
 *   {
 *     "schemaVersion": 1,
 *     "writtenAt": "<ISO 8601>",
 *     "identity": { "tapdUserName": "...", "tapdUserId": "...", "tapdEmail"?: "..." },
 *     "workspaces": [{ "id": "...", "name": "...", "role"?: "..." }],
 *     "lastSelectedWorkspace"?: "...",
 *     "knownUsers"?: [{ "tapdUserName": "...", "tapdUserId": "..." }]
 *   }
 *
 * 与 config-store 的关键差别：
 *   - cache 没有 TTL（design.md 决策 3：错误驱动重新认证）
 *   - cache 写入 MUST NOT 抛错传播；调用方在 server 启动期会让 cache 写失败仅 warn
 *     —— 但这层只提供原子写实现；warn-or-throw 由调用方决定。
 *   - knownUsers 增量写入支持去重（by `tapdUserId`）。
 */

const SUPPORTED_SCHEMA_VERSION = 1;

export interface CacheIdentity {
  tapdUserName: string;
  tapdUserId: string;
  tapdEmail?: string;
}

export interface CacheWorkspace {
  id: string;
  name: string;
  role?: string;
}

export interface CacheKnownUser {
  tapdUserName: string;
  tapdUserId: string;
}

export interface TapdCache {
  schemaVersion: number;
  writtenAt: string;
  identity: CacheIdentity;
  workspaces: CacheWorkspace[];
  lastSelectedWorkspace?: string;
  knownUsers?: CacheKnownUser[];
}

export interface ReadOptions {
  logger?: Logger;
}

/** 读 cache.json；不存在返回 undefined；JSON 解析失败抛错。 */
export async function readCache(
  path: string,
  options: ReadOptions = {},
): Promise<TapdCache | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }

  try {
    return JSON.parse(raw) as TapdCache;
  } catch (err) {
    options.logger?.warn(
      { msg: 'cache_parse_failed', path, reason: (err as Error).message },
      'cache.json JSON 解析失败',
    );
    throw err;
  }
}

/** 原子写 cache.json：mkdir + tmp + rename。 */
export async function writeCache(path: string, cache: TapdCache): Promise<void> {
  if (cache.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `writeCache: schemaVersion 必须是 ${SUPPORTED_SCHEMA_VERSION}，收到 ${cache.schemaVersion}`,
    );
  }
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const body = JSON.stringify(cache, null, 2) + '\n';
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, path);
}

/**
 * 增量写入 knownUsers。
 *
 * - 文件不存在 → 这是异常情况（启动期应已写过），仅 warn 后跳过；不抛
 *   （调用点是工具调用回调，不应因此让用户工具调用失败）
 * - cache.json 存在 → 按 `tapdUserId` 去重 push 后原子写回
 */
export async function appendKnownUser(
  path: string,
  user: CacheKnownUser,
  options: ReadOptions = {},
): Promise<void> {
  const cache = await readCache(path, options).catch((err) => {
    options.logger?.warn(
      { msg: 'cache_read_failed_for_known_user', reason: (err as Error).message },
      'cache.json 读失败，跳过 knownUsers 写入',
    );
    return undefined;
  });
  if (!cache) {
    options.logger?.warn(
      { msg: 'cache_missing_for_known_user', path, user: user.tapdUserId },
      'cache.json 不存在，跳过 knownUsers 写入',
    );
    return;
  }

  const existing = cache.knownUsers ?? [];
  if (existing.some((u) => u.tapdUserId === user.tapdUserId)) return;

  const updated: TapdCache = {
    ...cache,
    knownUsers: [...existing, user],
    writtenAt: new Date().toISOString(),
  };
  try {
    await writeCache(path, updated);
  } catch (err) {
    options.logger?.warn(
      { msg: 'cache_write_failed', path, reason: (err as Error).message },
      'cache.json 写入失败',
    );
  }
}

/**
 * 更新 lastSelectedWorkspace。语义同 appendKnownUser：cache.json 缺失时不抛，仅 warn。
 */
export async function setLastSelectedWorkspace(
  path: string,
  workspaceId: string,
  options: ReadOptions = {},
): Promise<void> {
  const cache = await readCache(path, options).catch((err) => {
    options.logger?.warn(
      { msg: 'cache_read_failed_for_last_ws', reason: (err as Error).message },
      'cache.json 读失败，跳过 lastSelectedWorkspace 写入',
    );
    return undefined;
  });
  if (!cache) return;
  if (cache.lastSelectedWorkspace === workspaceId) return;

  const updated: TapdCache = {
    ...cache,
    lastSelectedWorkspace: workspaceId,
    writtenAt: new Date().toISOString(),
  };
  try {
    await writeCache(path, updated);
  } catch (err) {
    options.logger?.warn(
      { msg: 'cache_write_failed', path, reason: (err as Error).message },
      'cache.json 写入失败',
    );
  }
}

export { SUPPORTED_SCHEMA_VERSION };
