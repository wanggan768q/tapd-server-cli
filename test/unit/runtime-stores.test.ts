import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cacheJsonPath,
  projectTapdDir,
  tapdConfigPath,
  TAPD_CACHE_FILE,
  TAPD_CONFIG_FILE,
  TAPD_DIR_NAME,
  userTapdDir,
} from '../../src/runtime/paths.js';
import {
  IncompatibleConfigError,
  mergeSkillEntries,
  readTapdConfig,
  SUPPORTED_SCHEMA_VERSION as CFG_VERSION,
  writeTapdConfig,
  type SkillEntry,
  type TapdConfig,
} from '../../src/runtime/config-store.js';
import {
  appendKnownUser,
  readCache,
  setLastSelectedWorkspace,
  SUPPORTED_SCHEMA_VERSION as CACHE_VERSION,
  writeCache,
  type TapdCache,
} from '../../src/runtime/cache-store.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tapd-runtime-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<TapdConfig> = {}): TapdConfig {
  return {
    schemaVersion: CFG_VERSION,
    version: '0.4.0',
    installedAt: '2026-05-30T08:00:00Z',
    scope: 'user',
    role: 'user',
    clients: ['claude-code'],
    skills: [],
    ...overrides,
  };
}

function makeCache(overrides: Partial<TapdCache> = {}): TapdCache {
  return {
    schemaVersion: CACHE_VERSION,
    writtenAt: '2026-05-30T08:00:00Z',
    identity: { tapdUserName: '张三', tapdUserId: '1000' },
    workspaces: [{ id: '12345', name: '项目A' }],
    ...overrides,
  };
}

describe('paths', () => {
  it('userTapdDir uses homeOverride', () => {
    expect(userTapdDir({ homeOverride: '/tmp/h' })).toBe(join('/tmp/h', TAPD_DIR_NAME));
  });

  it('projectTapdDir uses cwdOverride', () => {
    expect(projectTapdDir({ cwdOverride: '/tmp/p' })).toBe(join('/tmp/p', TAPD_DIR_NAME));
  });

  it('tapdConfigPath user vs project', () => {
    expect(tapdConfigPath('user', { homeOverride: '/h' })).toBe(
      join('/h', TAPD_DIR_NAME, TAPD_CONFIG_FILE),
    );
    expect(tapdConfigPath('project', { cwdOverride: '/p' })).toBe(
      join('/p', TAPD_DIR_NAME, TAPD_CONFIG_FILE),
    );
  });

  it('cacheJsonPath user vs project', () => {
    expect(cacheJsonPath('user', { homeOverride: '/h' })).toBe(
      join('/h', TAPD_DIR_NAME, TAPD_CACHE_FILE),
    );
    expect(cacheJsonPath('project', { cwdOverride: '/p' })).toBe(
      join('/p', TAPD_DIR_NAME, TAPD_CACHE_FILE),
    );
  });
});

describe('config-store', () => {
  it('read returns undefined when file missing', async () => {
    const r = await readTapdConfig(join(tmpRoot, 'nope.json'));
    expect(r).toBeUndefined();
  });

  it('round-trip write + read', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    const cfg = makeConfig({
      skills: [
        { name: 'tapd-overview', version: '0.4.0', writtenSha256: 'a'.repeat(64), path: '/x' },
      ],
    });
    await writeTapdConfig(p, cfg);
    const got = await readTapdConfig(p);
    expect(got).toEqual(cfg);
  });

  it('write creates parent directory', async () => {
    const p = join(tmpRoot, 'nested', 'deeper', TAPD_CONFIG_FILE);
    await writeTapdConfig(p, makeConfig());
    await expect(fs.access(p)).resolves.toBeUndefined();
  });

  it('schemaVersion > supported throws IncompatibleConfigError', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    await fs.writeFile(p, JSON.stringify({ ...makeConfig(), schemaVersion: 99 }));
    await expect(readTapdConfig(p)).rejects.toBeInstanceOf(IncompatibleConfigError);
  });

  it('missing schemaVersion throws plain error', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    await fs.writeFile(p, JSON.stringify({ scope: 'user' }));
    await expect(readTapdConfig(p)).rejects.toThrow(/schemaVersion/);
  });

  it('write with wrong schemaVersion is rejected', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    await expect(
      writeTapdConfig(p, { ...makeConfig(), schemaVersion: 99 }),
    ).rejects.toThrow(/schemaVersion/);
  });

  it('atomic: tmp file is removed after rename', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    await writeTapdConfig(p, makeConfig());
    await expect(fs.access(`${p}.tmp`)).rejects.toThrow();
  });

  it('JSON parse error propagates', async () => {
    const p = join(tmpRoot, 'tapd.config.json');
    await fs.writeFile(p, 'not json {');
    await expect(readTapdConfig(p)).rejects.toThrow();
  });
});

describe('mergeSkillEntries', () => {
  const a: SkillEntry = { name: 'tapd-overview', version: '0.4.0', writtenSha256: 'a', path: '/a' };
  const aPrime: SkillEntry = { ...a, version: '0.4.1', writtenSha256: 'a2', path: '/a2' };
  const b: SkillEntry = { name: 'tapd-my-work', version: '0.4.0', writtenSha256: 'b', path: '/b' };

  it('incoming overrides existing by name', () => {
    expect(mergeSkillEntries([a], [aPrime])).toEqual([aPrime]);
  });

  it('keeps entries not present in incoming', () => {
    const merged = mergeSkillEntries([a, b], [aPrime]);
    expect(merged).toEqual([b, aPrime].sort((x, y) => x.name.localeCompare(y.name)));
  });

  it('returns sorted by name', () => {
    const merged = mergeSkillEntries([], [b, a]);
    expect(merged.map((s) => s.name)).toEqual(['tapd-my-work', 'tapd-overview']);
  });
});

describe('cache-store', () => {
  it('read returns undefined when file missing', async () => {
    const r = await readCache(join(tmpRoot, 'nope.json'));
    expect(r).toBeUndefined();
  });

  it('round-trip write + read', async () => {
    const p = join(tmpRoot, 'cache.json');
    const cache = makeCache();
    await writeCache(p, cache);
    expect(await readCache(p)).toEqual(cache);
  });

  it('atomic: tmp file removed after rename', async () => {
    const p = join(tmpRoot, 'cache.json');
    await writeCache(p, makeCache());
    await expect(fs.access(`${p}.tmp`)).rejects.toThrow();
  });

  it('write rejects bad schemaVersion', async () => {
    const p = join(tmpRoot, 'cache.json');
    await expect(writeCache(p, { ...makeCache(), schemaVersion: 7 })).rejects.toThrow(
      /schemaVersion/,
    );
  });

  it('appendKnownUser dedupes by tapdUserId', async () => {
    const p = join(tmpRoot, 'cache.json');
    await writeCache(p, makeCache({ knownUsers: [{ tapdUserName: '李四', tapdUserId: '2000' }] }));

    await appendKnownUser(p, { tapdUserName: '张三', tapdUserId: '1000' });
    await appendKnownUser(p, { tapdUserName: '张三 alt', tapdUserId: '1000' });

    const got = await readCache(p);
    expect(got?.knownUsers?.map((u) => u.tapdUserId)).toEqual(['2000', '1000']);
  });

  it('appendKnownUser silently skips when cache missing', async () => {
    const p = join(tmpRoot, 'absent.json');
    await expect(
      appendKnownUser(p, { tapdUserName: '张三', tapdUserId: '1000' }),
    ).resolves.toBeUndefined();
    await expect(fs.access(p)).rejects.toThrow();
  });

  it('setLastSelectedWorkspace updates only if changed', async () => {
    const p = join(tmpRoot, 'cache.json');
    await writeCache(p, makeCache({ lastSelectedWorkspace: '12345' }));
    const before = (await fs.stat(p)).mtimeMs;

    await setLastSelectedWorkspace(p, '12345');
    const sameStat = (await fs.stat(p)).mtimeMs;
    expect(sameStat).toBe(before);

    await setLastSelectedWorkspace(p, '67890');
    const got = await readCache(p);
    expect(got?.lastSelectedWorkspace).toBe('67890');
  });

  it('setLastSelectedWorkspace silently skips when cache missing', async () => {
    const p = join(tmpRoot, 'absent.json');
    await expect(setLastSelectedWorkspace(p, 'x')).resolves.toBeUndefined();
  });

  it('readCache: invalid JSON throws', async () => {
    const p = join(tmpRoot, 'cache.json');
    await fs.writeFile(p, '{ not json');
    await expect(readCache(p)).rejects.toThrow();
  });
});
