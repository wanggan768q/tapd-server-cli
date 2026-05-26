import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backupAndWrite, readIfExists } from '../../src/installer/io.js';

describe('installer/io', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-installer-io-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('readIfExists returns undefined when file missing', async () => {
    const result = await readIfExists(join(dir, 'no.json'));
    expect(result).toBeUndefined();
  });

  it('backupAndWrite creates file when missing, no backup', async () => {
    const target = join(dir, 'a', 'b', 'c.json');
    const out = await backupAndWrite(target, '{"k":1}');
    expect(out.path).toBe(target);
    expect(out.backup).toBeUndefined();
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('{"k":1}');
  });

  it('backupAndWrite creates timestamped backup when file exists', async () => {
    const target = join(dir, 'cfg.json');
    await fs.writeFile(target, '{"old":true}');
    const out = await backupAndWrite(target, '{"new":true}');
    expect(out.backup).toBeDefined();
    expect(out.backup).toMatch(/cfg\.json\.bak\.\d+$/);
    const backupContent = await fs.readFile(out.backup!, 'utf8');
    expect(backupContent).toBe('{"old":true}');
    const newContent = await fs.readFile(target, 'utf8');
    expect(newContent).toBe('{"new":true}');
  });

  it('backupAndWrite leaves no .tmp residue', async () => {
    const target = join(dir, 'cfg.json');
    await backupAndWrite(target, '{"x":1}');
    await expect(fs.access(`${target}.tmp`)).rejects.toThrow();
  });
});
