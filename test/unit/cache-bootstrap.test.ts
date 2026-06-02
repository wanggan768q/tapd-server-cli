import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Identity } from '../../src/auth/identity.js';
import type { WorkspaceEntry } from '../../src/permissions/snapshot.js';
import {
  scheduleCacheBootstrap,
  writeCacheFromBootstrap,
} from '../../src/runtime/cache-bootstrap.js';
import {
  cacheJsonPath,
  TAPD_DIR_NAME,
} from '../../src/runtime/paths.js';
import {
  readCache,
  SUPPORTED_SCHEMA_VERSION,
  writeCache,
} from '../../src/runtime/cache-store.js';

let tmpHome: string;
let logger: pino.Logger;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tapd-cache-boot-'));
  logger = pino({ level: 'silent' });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    userId: '1000',
    userName: '张三',
    email: 'zs@example.com',
    currentCompanyId: 'company-1',
    tokenPreview: 'xxxx',
    ...overrides,
  };
}

function makeWorkspaces(): WorkspaceEntry[] {
  return [
    { id: '12345', name: '项目A', category: 'project' },
    { id: '67890', name: '项目B', category: 'project' },
  ];
}

describe('writeCacheFromBootstrap', () => {
  it('writes a fresh cache.json with identity + workspaces', async () => {
    await writeCacheFromBootstrap({
      identity: makeIdentity(),
      workspaces: makeWorkspaces(),
      logger,
      pathOverrides: { homeOverride: tmpHome },
    });

    const got = await readCache(cacheJsonPath('user', { homeOverride: tmpHome }));
    expect(got).toBeDefined();
    expect(got!.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(got!.identity).toEqual({
      tapdUserName: '张三',
      tapdUserId: '1000',
      tapdEmail: 'zs@example.com',
    });
    expect(got!.workspaces).toEqual([
      { id: '12345', name: '项目A', role: 'project' },
      { id: '67890', name: '项目B', role: 'project' },
    ]);
  });

  it('omits tapdEmail field when identity has none', async () => {
    await writeCacheFromBootstrap({
      identity: makeIdentity({ email: undefined }),
      workspaces: makeWorkspaces(),
      logger,
      pathOverrides: { homeOverride: tmpHome },
    });
    const got = await readCache(cacheJsonPath('user', { homeOverride: tmpHome }));
    expect(got!.identity.tapdEmail).toBeUndefined();
  });

  it('preserves lastSelectedWorkspace and knownUsers from prior cache', async () => {
    const path = cacheJsonPath('user', { homeOverride: tmpHome });
    await writeCache(path, {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      writtenAt: '2026-05-01T00:00:00Z',
      identity: { tapdUserName: 'old', tapdUserId: '999' },
      workspaces: [{ id: 'stale', name: 'stale' }],
      lastSelectedWorkspace: '12345',
      knownUsers: [{ tapdUserName: '李四', tapdUserId: '2000' }],
    });

    await writeCacheFromBootstrap({
      identity: makeIdentity(),
      workspaces: makeWorkspaces(),
      logger,
      pathOverrides: { homeOverride: tmpHome },
    });

    const got = await readCache(path);
    // identity / workspaces 都被新值覆盖
    expect(got!.identity.tapdUserId).toBe('1000');
    expect(got!.workspaces.map((w) => w.id)).toEqual(['12345', '67890']);
    // lastSelectedWorkspace / knownUsers 保留
    expect(got!.lastSelectedWorkspace).toBe('12345');
    expect(got!.knownUsers).toEqual([{ tapdUserName: '李四', tapdUserId: '2000' }]);
  });

  it('does not throw when write fails (cache.json directory unwritable)', async () => {
    // 模拟：让 cacheJsonPath 指向不可写位置 — 让 .tapd 名字被占成普通文件
    await fs.writeFile(join(tmpHome, TAPD_DIR_NAME), 'block');

    // 主断言：不抛错（仅 warn 日志，但日志验证比较脆弱，这里只断行为）
    await expect(
      writeCacheFromBootstrap({
        identity: makeIdentity(),
        workspaces: makeWorkspaces(),
        logger,
        pathOverrides: { homeOverride: tmpHome },
      }),
    ).resolves.toBeUndefined();

    // 副断言：cache.json 没被写出（因为父路径占用，写必然失败）
    const cachePath = cacheJsonPath('user', { homeOverride: tmpHome });
    await expect(fs.access(cachePath)).rejects.toThrow();
  });

  it('rolls past corrupted prior cache (read failure → overwrite)', async () => {
    const path = cacheJsonPath('user', { homeOverride: tmpHome });
    await fs.mkdir(join(tmpHome, TAPD_DIR_NAME), { recursive: true });
    await fs.writeFile(path, '{ not json');

    await writeCacheFromBootstrap({
      identity: makeIdentity(),
      workspaces: makeWorkspaces(),
      logger,
      pathOverrides: { homeOverride: tmpHome },
    });

    const got = await readCache(path);
    expect(got!.identity.tapdUserId).toBe('1000');
  });
});

describe('scheduleCacheBootstrap', () => {
  it('eventually writes cache.json after returning synchronously', async () => {
    scheduleCacheBootstrap({
      identity: makeIdentity(),
      workspaces: makeWorkspaces(),
      logger,
      pathOverrides: { homeOverride: tmpHome },
    });

    // 轮询等 cache.json 出现（最多 2s）
    const path = cacheJsonPath('user', { homeOverride: tmpHome });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const got = await readCache(path).catch(() => undefined);
      if (got) {
        expect(got.identity.tapdUserId).toBe('1000');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('cache.json not written within timeout');
  });

  it('does not throw synchronously even if write would fail', async () => {
    // 同样占住 .tapd 路径
    await fs.writeFile(join(tmpHome, TAPD_DIR_NAME), 'block');
    expect(() =>
      scheduleCacheBootstrap({
        identity: makeIdentity(),
        workspaces: makeWorkspaces(),
        logger,
        pathOverrides: { homeOverride: tmpHome },
      }),
    ).not.toThrow();
    // 等异步任务跑完，避免泄露到下个测试
    await new Promise((r) => setTimeout(r, 50));
  });
});
