import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasAnyPersistentFile,
  purgePersistentFiles,
} from '../../src/auth/persistent-files.js';

describe('purgePersistentFiles', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tapd-purge-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('removes both cookie and token when both exist', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'fake-cookie');
    await fs.writeFile(join(baseDir, 'token'), 'fake-token');

    const result = await purgePersistentFiles({ baseDir });
    expect(result.cookie).toEqual({ status: 'removed' });
    expect(result.token).toEqual({ status: 'removed' });

    await expect(fs.access(join(baseDir, 'cookie'))).rejects.toThrow();
    await expect(fs.access(join(baseDir, 'token'))).rejects.toThrow();
  });

  it('reports not_present when neither file exists', async () => {
    const result = await purgePersistentFiles({ baseDir });
    expect(result.cookie).toEqual({ status: 'not_present' });
    expect(result.token).toEqual({ status: 'not_present' });
  });

  it('removes cookie when only cookie exists, reports token not_present', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'fake-cookie');

    const result = await purgePersistentFiles({ baseDir });
    expect(result.cookie).toEqual({ status: 'removed' });
    expect(result.token).toEqual({ status: 'not_present' });
  });

  it('isolates failures between cookie and token', async () => {
    // mock fs.unlink:cookie 抛 EACCES,token 正常
    const realUnlink = fs.unlink.bind(fs);
    await fs.writeFile(join(baseDir, 'cookie'), 'fake-cookie');
    await fs.writeFile(join(baseDir, 'token'), 'fake-token');

    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('cookie')) {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return realUnlink(p);
    });

    const result = await purgePersistentFiles({ baseDir });
    expect(result.cookie).toEqual({ status: 'failed', error: 'permission denied' });
    expect(result.token).toEqual({ status: 'removed' });

    spy.mockRestore();
  });

  it('reports paths for diagnostic use', async () => {
    const result = await purgePersistentFiles({ baseDir });
    expect(result.paths.cookie).toBe(join(baseDir, 'cookie'));
    expect(result.paths.token).toBe(join(baseDir, 'token'));
  });

  it('does not read file contents (no readFile call)', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'sensitive-cookie-value');
    await fs.writeFile(join(baseDir, 'token'), 'sensitive-token-value');

    const readFileSpy = vi.spyOn(fs, 'readFile');
    const result = await purgePersistentFiles({ baseDir });
    expect(result.cookie).toEqual({ status: 'removed' });
    expect(result.token).toEqual({ status: 'removed' });
    expect(readFileSpy).not.toHaveBeenCalled();

    readFileSpy.mockRestore();
  });

  it('does not delete other files in the directory', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'c');
    await fs.writeFile(join(baseDir, 'token'), 't');
    await fs.writeFile(join(baseDir, 'backup.json'), '{}');
    await fs.writeFile(join(baseDir, 'unrelated'), 'x');

    await purgePersistentFiles({ baseDir });

    // 其它文件保留
    await expect(fs.access(join(baseDir, 'backup.json'))).resolves.toBeUndefined();
    await expect(fs.access(join(baseDir, 'unrelated'))).resolves.toBeUndefined();
    // 目录本身保留
    await expect(fs.access(baseDir)).resolves.toBeUndefined();
  });
});

describe('hasAnyPersistentFile', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tapd-has-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('returns false/false when neither exists', async () => {
    const r = await hasAnyPersistentFile({ baseDir });
    expect(r).toEqual({ cookie: false, token: false });
  });

  it('returns true/false when only cookie exists', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'x');
    const r = await hasAnyPersistentFile({ baseDir });
    expect(r).toEqual({ cookie: true, token: false });
  });

  it('returns true/true when both exist', async () => {
    await fs.writeFile(join(baseDir, 'cookie'), 'x');
    await fs.writeFile(join(baseDir, 'token'), 'y');
    const r = await hasAnyPersistentFile({ baseDir });
    expect(r).toEqual({ cookie: true, token: true });
  });
});
