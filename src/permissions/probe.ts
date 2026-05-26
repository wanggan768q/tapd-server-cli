import type { TapdHttpClient } from '../api/client.js';
import { TapdApiError } from '../api/errors.js';

import {
  isExpired,
  type PermissionSnapshot,
  probeKey,
  type ProbeResult,
} from './snapshot.js';

const WRITE_FAILURE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ProbeServiceOptions {
  client: TapdHttpClient;
  snapshot: PermissionSnapshot;
  /** 读权限探针缓存 TTL（秒） */
  readTtlSec: number;
  /** 时间源，便于测试 */
  now?: () => number;
}

export interface ProbeService {
  /**
   * 检查 (resource, workspaceId) 的读权限是否已知；不重置缓存。
   */
  knownReadAllowed(resource: string, workspaceId: string): boolean;
  /**
   * 懒探针：若 (resource, workspaceId) 的读权限尚未确认或缓存已过期，
   * 调用 `GET /{resource}?workspace_id=...&limit=1` 进行探针；
   * 探针成功 → outcome=allowed，缓存 readTtlSec 秒
   * 探针 not_found/permission_denied → outcome=denied，缓存 readTtlSec 秒
   * 其它错误 → 不缓存，直接抛出
   */
  ensureRead(resource: string, workspaceId: string): Promise<ProbeResult>;
  /**
   * 写失败标记：当 create/update/delete 调用返回 403/permission_denied 时调用。
   */
  markWriteDenied(resource: string, workspaceId: string): void;
  /**
   * 检查写权限是否已被标记为不可用。
   */
  isWriteDenied(resource: string, workspaceId: string): boolean;
  /**
   * 清空全部探针缓存（手动 refresh）。
   */
  clearAll(): void;
}

export function createProbeService(options: ProbeServiceOptions): ProbeService {
  const { snapshot } = options;
  const now = options.now ?? (() => Date.now());
  const readTtlMs = options.readTtlSec * 1000;

  return {
    knownReadAllowed(resource, workspaceId) {
      const key = probeKey(resource, workspaceId);
      const r = snapshot.readProbes.get(key);
      if (!r) return false;
      if (isExpired(r, now())) return false;
      return r.outcome === 'allowed';
    },

    async ensureRead(resource, workspaceId) {
      const key = probeKey(resource, workspaceId);
      const cached = snapshot.readProbes.get(key);
      if (cached && !isExpired(cached, now())) {
        if (cached.outcome === 'denied') {
          throw new TapdApiError({
            kind: 'permission_denied',
            tapdStatus: 0,
            httpStatus: 0,
            info: `cached probe: ${resource} in workspace ${workspaceId} is not accessible`,
          });
        }
        return cached;
      }

      // 探针调用
      try {
        await options.client.get(`/${resource}`, { workspace_id: workspaceId, limit: 1 });
        const r: ProbeResult = { outcome: 'allowed', expiresAtMs: now() + readTtlMs };
        snapshot.readProbes.set(key, r);
        return r;
      } catch (err) {
        if (
          err instanceof TapdApiError &&
          (err.kind === 'permission_denied' || err.kind === 'not_found')
        ) {
          const r: ProbeResult = { outcome: 'denied', expiresAtMs: now() + readTtlMs };
          snapshot.readProbes.set(key, r);
          throw err;
        }
        throw err;
      }
    },

    markWriteDenied(resource, workspaceId) {
      const key = probeKey(resource, workspaceId);
      snapshot.writeFailures.set(key, {
        outcome: 'denied',
        expiresAtMs: now() + WRITE_FAILURE_TTL_MS,
      });
    },

    isWriteDenied(resource, workspaceId) {
      const key = probeKey(resource, workspaceId);
      const r = snapshot.writeFailures.get(key);
      if (!r) return false;
      if (isExpired(r, now())) {
        snapshot.writeFailures.delete(key);
        return false;
      }
      return true;
    },

    clearAll() {
      snapshot.readProbes.clear();
      snapshot.writeFailures.clear();
    },
  };
}
