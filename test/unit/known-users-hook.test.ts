import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { maybeRecordKnownUsers } from '../../src/resources/known-users-hook.js';
import type { ResourceDef, ResourceActionSpec } from '../../src/resources/definitions.js';
import { writeCache } from '../../src/runtime/cache-store.js';
import { cacheJsonPath } from '../../src/runtime/paths.js';

let tmpHome: string;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tapd-known-users-'));
  await writeCache(cacheJsonPath('user', { homeOverride: tmpHome }), {
    schemaVersion: 1,
    writtenAt: '2026-05-30T08:00:00Z',
    identity: { tapdUserName: '张三', tapdUserId: '1000' },
    workspaces: [{ id: '12345', name: '项目A' }],
  });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

const usersDef = { resource: 'users', description: 'users' } as ResourceDef;
const listSpec: ResourceActionSpec = {
  action: 'list',
  apiPath: '/users',
};
const getSpec: ResourceActionSpec = {
  action: 'get',
  apiPath: '/users',
};
const writeSpec: ResourceActionSpec = {
  action: 'create',
  apiPath: '/users',
  write: true,
};
const otherDef = { resource: 'stories', description: 'stories' } as ResourceDef;

async function readCacheFile(home: string) {
  const raw = await fs.readFile(cacheJsonPath('user', { homeOverride: home }), 'utf8');
  return JSON.parse(raw) as { knownUsers?: Array<{ tapdUserName: string; tapdUserId: string }> };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r !== undefined) return r;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timeout');
}

describe('known-users-hook', () => {
  it('records users from a `tapd_users_list` array response', async () => {
    const result = [
      { User: { id: '2000', name: 'lisi' } },
      { User: { id: '3000', name: 'wangwu' } },
    ];
    maybeRecordKnownUsers(usersDef, listSpec, result, {
      pathOverrides: { homeOverride: tmpHome },
    });

    const cache = await waitFor(async () => {
      const c = await readCacheFile(tmpHome);
      return c.knownUsers && c.knownUsers.length === 2 ? c : undefined;
    });
    expect(cache.knownUsers).toEqual([
      { tapdUserName: 'lisi', tapdUserId: '2000' },
      { tapdUserName: 'wangwu', tapdUserId: '3000' },
    ]);
  });

  it('records single user from `tapd_users_get`', async () => {
    const result = { User: { id: '4000', name: 'zhaoliu' } };
    maybeRecordKnownUsers(usersDef, getSpec, result, {
      pathOverrides: { homeOverride: tmpHome },
    });
    const cache = await waitFor(async () => {
      const c = await readCacheFile(tmpHome);
      return c.knownUsers && c.knownUsers.length === 1 ? c : undefined;
    });
    expect(cache.knownUsers).toEqual([{ tapdUserName: 'zhaoliu', tapdUserId: '4000' }]);
  });

  it('skips when resource is not users', async () => {
    maybeRecordKnownUsers(otherDef, listSpec, [{ Story: { id: '1' } }], {
      pathOverrides: { homeOverride: tmpHome },
    });
    await new Promise((r) => setTimeout(r, 50));
    const c = await readCacheFile(tmpHome);
    expect(c.knownUsers ?? []).toEqual([]);
  });

  it('skips on write action (create)', async () => {
    maybeRecordKnownUsers(usersDef, writeSpec, [{ User: { id: '5000', name: 'x' } }], {
      pathOverrides: { homeOverride: tmpHome },
    });
    await new Promise((r) => setTimeout(r, 50));
    const c = await readCacheFile(tmpHome);
    expect(c.knownUsers ?? []).toEqual([]);
  });

  it('dedupes by user id when called twice', async () => {
    const result = [{ User: { id: '6000', name: 'qianqi' } }];
    maybeRecordKnownUsers(usersDef, listSpec, result, {
      pathOverrides: { homeOverride: tmpHome },
    });
    await waitFor(async () => {
      const c = await readCacheFile(tmpHome);
      return c.knownUsers?.length === 1 ? c : undefined;
    });
    // 改名再调一次 — 应该忽略（dedupe by id）
    maybeRecordKnownUsers(
      usersDef,
      listSpec,
      [{ User: { id: '6000', name: 'qianqi-new-name' } }],
      { pathOverrides: { homeOverride: tmpHome } },
    );
    await new Promise((r) => setTimeout(r, 50));
    const c = await readCacheFile(tmpHome);
    expect(c.knownUsers).toEqual([{ tapdUserName: 'qianqi', tapdUserId: '6000' }]);
  });

  it('does not throw when result is malformed', async () => {
    expect(() =>
      maybeRecordKnownUsers(usersDef, listSpec, 'not an object', {
        pathOverrides: { homeOverride: tmpHome },
      }),
    ).not.toThrow();
    expect(() =>
      maybeRecordKnownUsers(usersDef, listSpec, [null, undefined, { wrong: 'shape' }], {
        pathOverrides: { homeOverride: tmpHome },
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('does not throw when cache.json missing (silent skip)', async () => {
    rmSync(cacheJsonPath('user', { homeOverride: tmpHome }), { force: true });
    expect(() =>
      maybeRecordKnownUsers(
        usersDef,
        listSpec,
        [{ User: { id: '7000', name: 'baba' } }],
        { pathOverrides: { homeOverride: tmpHome } },
      ),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('handles plain object (no User wrapper) too', async () => {
    const result = [{ id: '8000', name: 'plain' }];
    maybeRecordKnownUsers(usersDef, listSpec, result, {
      pathOverrides: { homeOverride: tmpHome },
    });
    const cache = await waitFor(async () => {
      const c = await readCacheFile(tmpHome);
      return c.knownUsers?.length === 1 ? c : undefined;
    });
    expect(cache.knownUsers).toEqual([{ tapdUserName: 'plain', tapdUserId: '8000' }]);
  });
});
