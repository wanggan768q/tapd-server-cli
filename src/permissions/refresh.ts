/**
 * 权限快照刷新：手动 refresh_permissions 触发。
 * 清空缓存 → 重新拉取 workspace 白名单 → 替换 snapshot 中的 workspaces 引用。
 */

import type { TapdHttpClient } from '../api/client.js';

import type { ProbeService } from './probe.js';
import { type PermissionSnapshot, type WorkspaceEntry } from './snapshot.js';
import { fetchAccessibleWorkspaces } from './workspaces.js';

export interface RefreshResult {
  workspaces: WorkspaceEntry[];
  snapshotAt: string;
}

/**
 * 注意：snapshot.workspaces 在类型上是 ReadonlyMap，运行时直接替换 Map 内容。
 */
export async function refreshSnapshot(
  client: TapdHttpClient,
  snapshot: PermissionSnapshot,
  probes: ProbeService,
): Promise<RefreshResult> {
  probes.clearAll();
  const workspaces = await fetchAccessibleWorkspaces(client);
  const mutableMap = snapshot.workspaces as Map<string, WorkspaceEntry>;
  mutableMap.clear();
  for (const w of workspaces) mutableMap.set(w.id, w);
  const snapshotAt = new Date().toISOString();
  Object.assign(snapshot, { snapshotAt });
  return { workspaces, snapshotAt };
}
