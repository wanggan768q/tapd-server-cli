import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCookieStore } from '../../src/auth/cookie-store.js';

describe('createCookieStore', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tapd-cookie-store-test-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('returns undefined when neither env nor file exists', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    const got = await store.load();
    expect(got).toBeUndefined();
  });

  it('prefers env over file', async () => {
    const store = createCookieStore({ baseDir, env: { TAPD_WEB_COOKIE: 'env-value' } });
    await fs.writeFile(join(baseDir, 'cookie'), 'file-value', { mode: 0o600 });
    const got = await store.load();
    expect(got).toEqual({ value: 'env-value', source: 'env' });
  });

  it('falls back to file when env is empty', async () => {
    const store = createCookieStore({ baseDir, env: { TAPD_WEB_COOKIE: '' } });
    await fs.writeFile(join(baseDir, 'cookie'), 'file-value', { mode: 0o600 });
    const got = await store.load();
    expect(got).toEqual({ value: 'file-value', source: 'file' });
  });

  it('refuses file with unsafe permissions on POSIX', async () => {
    if (platform() === 'win32') return; // 跳过：Windows 没有 POSIX mode
    const store = createCookieStore({ baseDir, env: {} });
    await fs.writeFile(join(baseDir, 'cookie'), 'value', { mode: 0o644 });
    const got = await store.load();
    expect(got).toBeUndefined();
  });

  it('save() writes file with 600 permission and rename atomicity', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    const { path } = await store.save('hello-cookie');
    expect(path).toBe(join(baseDir, 'cookie'));
    const content = await fs.readFile(path, 'utf8');
    expect(content).toBe('hello-cookie');
    if (platform() !== 'win32') {
      const stat = await fs.stat(path);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    // tmp 残留不应存在
    await expect(fs.access(`${path}.tmp`)).rejects.toThrow();
  });

  it('save() overwrites previous content atomically', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    await store.save('first');
    await store.save('second');
    const content = await fs.readFile(join(baseDir, 'cookie'), 'utf8');
    expect(content).toBe('second');
  });

  it('clear() removes existing file and returns existed=true', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    await store.save('x');
    const r = await store.clear();
    expect(r.existed).toBe(true);
    expect(r.path).toBe(join(baseDir, 'cookie'));
    await expect(fs.access(r.path)).rejects.toThrow();
  });

  it('clear() is idempotent when file does not exist', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    const r = await store.clear();
    expect(r.existed).toBe(false);
  });

  it('save() rejects empty string', async () => {
    const store = createCookieStore({ baseDir, env: {} });
    await expect(store.save('')).rejects.toThrow(/不能为空/);
  });
});
