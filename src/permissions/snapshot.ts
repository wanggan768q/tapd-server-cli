/**
 * 权限快照对象。
 *
 * - workspaces：启动时由 /workspaces/user_participant_projects 加载，作为 enum 收紧的依据。
 * - readProbes：(resource, workspace_id) → 探针结果与到期时间。
 * - writeFailures：(resource, workspace_id) → 写失败缓存（失败后短期不可用）。
 */

export type WorkspaceCategory = 'organization' | 'project' | string;

export interface WorkspaceEntry {
  id: string;
  name: string;
  category: WorkspaceCategory;
}

export type ProbeOutcome = 'allowed' | 'denied';

export interface ProbeResult {
  outcome: ProbeOutcome;
  expiresAtMs: number;
}

export interface PermissionSnapshot {
  workspaces: ReadonlyMap<string, WorkspaceEntry>;
  readProbes: Map<string, ProbeResult>;
  writeFailures: Map<string, ProbeResult>;
  snapshotAt: string;
}

export function probeKey(resource: string, workspaceId: string): string {
  return `${resource}::${workspaceId}`;
}

export function createSnapshot(workspaces: WorkspaceEntry[]): PermissionSnapshot {
  return {
    workspaces: new Map(workspaces.map((w) => [w.id, w])),
    readProbes: new Map(),
    writeFailures: new Map(),
    snapshotAt: new Date().toISOString(),
  };
}

export function isExpired(result: ProbeResult, nowMs: number): boolean {
  return nowMs >= result.expiresAtMs;
}

export function listWorkspaceIds(snapshot: PermissionSnapshot): string[] {
  return [...snapshot.workspaces.keys()];
}
