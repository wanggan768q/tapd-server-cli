import type { Logger } from 'pino';

import type { Identity } from '../auth/identity.js';
import type { WorkspaceEntry } from '../permissions/snapshot.js';

import {
  cacheJsonPath,
  type PathOverrides,
} from './paths.js';
import {
  readCache,
  SUPPORTED_SCHEMA_VERSION,
  writeCache,
  type TapdCache,
  type CacheKnownUser,
} from './cache-store.js';

/**
 * MCP server 启动期写 `~/.tapd/cache.json`。
 *
 * 触发时机：在 transport 绑定之后，由 server 入口 fire-and-forget。
 * 永不抛错——cache 不影响 server 主流程（design.md 决策 3 / 风险"cache 与 server 启动耦合"）。
 *
 * 行为：
 *  - 用 buildServer 已有的 identity + workspaces 拼出 TapdCache（schema v1）
 *  - 保留旧 cache 的 `lastSelectedWorkspace` 与 `knownUsers`（identity / workspaces 是新的）
 *  - 写入失败仅 warn 日志（msg: 'cache_write_failed'）
 *  - 失败原因：磁盘只读 / 路径权限 / 序列化错；任何一种都不传播
 */

export interface BootstrapInput {
  identity: Identity;
  workspaces: WorkspaceEntry[];
  logger: Logger;
  /** 测试用：注入 home 路径（默认 os.homedir()）。 */
  pathOverrides?: PathOverrides;
}

export async function writeCacheFromBootstrap(input: BootstrapInput): Promise<void> {
  const path = cacheJsonPath('user', input.pathOverrides);

  const previous = await readCache(path, { logger: input.logger }).catch((err) => {
    input.logger.warn(
      { msg: 'cache_read_failed', path, reason: (err as Error).message },
      'cache.json 读失败，将用新数据覆盖',
    );
    return undefined;
  });

  const next: TapdCache = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    writtenAt: new Date().toISOString(),
    identity: {
      tapdUserName: input.identity.userName,
      tapdUserId: input.identity.userId,
      ...(input.identity.email ? { tapdEmail: input.identity.email } : {}),
    },
    workspaces: input.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      ...(w.category ? { role: w.category } : {}),
    })),
  };

  // 保留运行时积累的字段（lastSelectedWorkspace / knownUsers）
  if (previous?.lastSelectedWorkspace) {
    next.lastSelectedWorkspace = previous.lastSelectedWorkspace;
  }
  if (previous?.knownUsers && previous.knownUsers.length > 0) {
    next.knownUsers = preserveKnownUsers(previous.knownUsers);
  }

  try {
    await writeCache(path, next);
    input.logger.info(
      { msg: 'cache_write_ok', path, workspaces: next.workspaces.length },
      'cache.json written',
    );
  } catch (err) {
    input.logger.warn(
      { msg: 'cache_write_failed', path, reason: (err as Error).message },
      'cache.json 写入失败',
    );
  }
}

/** 保留 knownUsers 但去重（防止旧 cache 异常重复）。 */
function preserveKnownUsers(known: CacheKnownUser[]): CacheKnownUser[] {
  const map = new Map<string, CacheKnownUser>();
  for (const u of known) map.set(u.tapdUserId, u);
  return Array.from(map.values());
}

/**
 * Fire-and-forget 包装：让调用方一行接入。
 *
 * 用法：
 *   scheduleCacheBootstrap({ identity, workspaces, logger });
 * 注意：返回 void，**不要 await**。失败已在内部 warn。
 */
export function scheduleCacheBootstrap(input: BootstrapInput): void {
  // 用 setImmediate 让 caller 的 microtask 先排空，确保 server 主流程优先
  setImmediate(() => {
    void writeCacheFromBootstrap(input);
  });
}
