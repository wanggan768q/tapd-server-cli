/**
 * `tapd_users_*` 工具调用后，把解析到的用户名 → id 映射回写到
 * `~/.tapd/cache.json:knownUsers`，让后续 `tapd-comment-and-mention`
 * 等 skill 不必每次都调 `tapd_users_list`。
 *
 * 失败仅 warn，永不抛错——这是工具调用回调，不应让用户感知到 cache
 * 写入失败。
 *
 * 仅对 resource === 'users' 的 list / get 动作生效；其它资源直通。
 */

import type { Logger } from 'pino';

import { cacheJsonPath, type PathOverrides } from '../runtime/paths.js';
import { appendKnownUser } from '../runtime/cache-store.js';

import type { ResourceDef, ResourceActionSpec } from './definitions.js';

interface ExtractedUser {
  tapdUserName: string;
  tapdUserId: string;
}

export interface KnownUserHookOptions {
  logger?: Logger;
  pathOverrides?: PathOverrides;
}

/**
 * 在工具调用结果返回前调用。
 *
 * 同步**不阻塞调用方**——内部 fire-and-forget 写盘。
 */
export function maybeRecordKnownUsers(
  def: ResourceDef,
  spec: ResourceActionSpec,
  result: unknown,
  options: KnownUserHookOptions = {},
): void {
  if (def.resource !== 'users') return;
  if (spec.action !== 'list' && spec.action !== 'get') return;

  const users = extractUsers(result);
  if (users.length === 0) return;

  const path = cacheJsonPath('user', options.pathOverrides);
  // fire-and-forget：appendKnownUser 内部已 swallow 失败 → warn
  // 必须**串行**，否则并发写会互相覆盖（read-modify-write 竞争）。
  void (async () => {
    for (const u of users) {
      await appendKnownUser(path, u, { logger: options.logger });
    }
  })();
}

/**
 * 从 TAPD `users` 资源的响应里提取 `{ tapdUserName, tapdUserId }`。
 *
 * TAPD 返回结构有两种常见形态：
 *   - 数组: `[{ User: { id: "...", name: "...", nick?: "..." } }, ...]`
 *   - 单条: `{ User: { id: "...", name: "..." } }`
 * 这里都接受。任何无法解析的字段直接跳过。
 */
function extractUsers(value: unknown): ExtractedUser[] {
  if (Array.isArray(value)) {
    const out: ExtractedUser[] = [];
    for (const item of value) {
      const u = extractOne(item);
      if (u) out.push(u);
    }
    return out;
  }
  const single = extractOne(value);
  return single ? [single] : [];
}

function extractOne(item: unknown): ExtractedUser | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const obj = item as Record<string, unknown>;
  // TAPD `{ User: {...} }` 包装
  const inner = (obj.User ?? obj) as Record<string, unknown>;
  if (!inner || typeof inner !== 'object') return undefined;

  const id = inner.id ?? inner.user_id;
  const name = inner.name ?? inner.user;
  if (id === undefined || id === null) return undefined;
  if (typeof name !== 'string' || name.length === 0) return undefined;

  return {
    tapdUserName: name,
    tapdUserId: String(id),
  };
}
