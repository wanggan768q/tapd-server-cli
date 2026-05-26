import { describe, expect, it, vi } from 'vitest';

import type { TapdHttpClient } from '../../src/api/client.js';
import { TapdApiError } from '../../src/api/errors.js';
import { createProbeService } from '../../src/permissions/probe.js';
import { refreshSnapshot } from '../../src/permissions/refresh.js';
import { createSnapshot, isExpired, probeKey } from '../../src/permissions/snapshot.js';

function fakeClient(impl: Partial<TapdHttpClient>): TapdHttpClient {
  return {
    get: impl.get ?? (() => Promise.reject(new Error('not impl'))),
    post: impl.post ?? (() => Promise.reject(new Error('not impl'))),
    close: impl.close ?? (() => Promise.resolve()),
  };
}

describe('probe cache', () => {
  it('caches read probe success for TTL', async () => {
    const snapshot = createSnapshot([{ id: '61376769', name: 'GSTM', category: 'project' }]);
    const get = vi.fn(() => Promise.resolve([]));
    const probes = createProbeService({
      client: fakeClient({ get }),
      snapshot,
      readTtlSec: 600,
      now: () => 1_000_000,
    });
    await probes.ensureRead('bugs', '61376769');
    await probes.ensureRead('bugs', '61376769');
    expect(get).toHaveBeenCalledTimes(1);
    expect(probes.knownReadAllowed('bugs', '61376769')).toBe(true);
  });

  it('re-probes after TTL expires', async () => {
    const snapshot = createSnapshot([{ id: '61376769', name: 'GSTM', category: 'project' }]);
    const get = vi.fn(() => Promise.resolve([]));
    let nowMs = 1_000_000;
    const probes = createProbeService({
      client: fakeClient({ get }),
      snapshot,
      readTtlSec: 600,
      now: () => nowMs,
    });
    await probes.ensureRead('bugs', '61376769');
    nowMs += 700_000; // TTL 已过
    await probes.ensureRead('bugs', '61376769');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('caches denied probe and surfaces error without re-probing', async () => {
    const snapshot = createSnapshot([{ id: '99999999', name: 'X', category: 'project' }]);
    const get = vi.fn(() =>
      Promise.reject(
        new TapdApiError({
          kind: 'not_found',
          tapdStatus: 404,
          httpStatus: 200,
          info: 'workspace 99999999 not existed',
        }),
      ),
    );
    const probes = createProbeService({
      client: fakeClient({ get }),
      snapshot,
      readTtlSec: 600,
    });
    await expect(probes.ensureRead('stories', '99999999')).rejects.toMatchObject({
      kind: 'not_found',
    });
    await expect(probes.ensureRead('stories', '99999999')).rejects.toMatchObject({
      kind: 'permission_denied',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('write failure cache lives 1 hour', () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    let nowMs = 0;
    const probes = createProbeService({
      client: fakeClient({}),
      snapshot,
      readTtlSec: 600,
      now: () => nowMs,
    });
    expect(probes.isWriteDenied('bugs', '1')).toBe(false);
    probes.markWriteDenied('bugs', '1');
    expect(probes.isWriteDenied('bugs', '1')).toBe(true);
    nowMs += 59 * 60 * 1000;
    expect(probes.isWriteDenied('bugs', '1')).toBe(true);
    nowMs += 2 * 60 * 1000; // 共 61 分钟
    expect(probes.isWriteDenied('bugs', '1')).toBe(false);
  });

  it('clearAll resets read + write caches', async () => {
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const get = vi.fn(() => Promise.resolve([]));
    const probes = createProbeService({
      client: fakeClient({ get }),
      snapshot,
      readTtlSec: 600,
    });
    await probes.ensureRead('bugs', '1');
    probes.markWriteDenied('bugs', '1');
    probes.clearAll();
    expect(probes.knownReadAllowed('bugs', '1')).toBe(false);
    expect(probes.isWriteDenied('bugs', '1')).toBe(false);
    await probes.ensureRead('bugs', '1');
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('refreshSnapshot', () => {
  it('replaces workspace map and updates snapshotAt', async () => {
    const snapshot = createSnapshot([{ id: 'old', name: 'Old', category: 'project' }]);
    const oldSnapshotAt = snapshot.snapshotAt;
    const probes = createProbeService({
      client: fakeClient({}),
      snapshot,
      readTtlSec: 600,
    });
    const get = vi.fn(() =>
      Promise.resolve([
        { Workspace: { id: '47384552', name: 'Org', category: 'organization' } },
        { Workspace: { id: '61376769', name: 'GSTM', category: 'project' } },
      ]),
    );
    const client = fakeClient({ get });
    // 确保 timestamp 变化
    await new Promise((r) => setTimeout(r, 5));
    const result = await refreshSnapshot(client, snapshot, probes);
    expect(result.workspaces).toHaveLength(2);
    expect([...snapshot.workspaces.keys()]).toEqual(['47384552', '61376769']);
    expect(snapshot.snapshotAt).not.toBe(oldSnapshotAt);
  });
});

describe('snapshot helpers', () => {
  it('isExpired compares now with expiresAtMs', () => {
    expect(isExpired({ outcome: 'allowed', expiresAtMs: 100 }, 99)).toBe(false);
    expect(isExpired({ outcome: 'allowed', expiresAtMs: 100 }, 100)).toBe(true);
    expect(isExpired({ outcome: 'allowed', expiresAtMs: 100 }, 101)).toBe(true);
  });

  it('probeKey is deterministic', () => {
    expect(probeKey('bugs', '1')).toBe('bugs::1');
    expect(probeKey('bugs', '1')).toBe(probeKey('bugs', '1'));
  });
});
