import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadToken, TokenLoadError } from '../../src/auth/token.js';

const TEST_PAT = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';

describe('loadToken', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `tapd-mcp-token-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true });
  });

  it('prefers CLI over env over file', async () => {
    await fs.writeFile(tmpFile, 'from-file', { mode: 0o600 });
    const result = await loadToken({
      cli: { token: 'from-cli' },
      env: { TAPD_TOKEN: 'from-env' },
      userFilePath: tmpFile,
    });
    expect(result).toEqual({ token: 'from-cli', source: 'cli' });
  });

  it('falls back to env when CLI omitted', async () => {
    const result = await loadToken({
      cli: {},
      env: { TAPD_TOKEN: TEST_PAT },
    });
    expect(result).toEqual({ token: TEST_PAT, source: 'env' });
  });

  it('falls back to file when CLI and env omitted', async () => {
    await fs.writeFile(tmpFile, `${TEST_PAT}\n`, { mode: 0o600 });
    const result = await loadToken({
      cli: {},
      env: {},
      userFilePath: tmpFile,
    });
    expect(result).toEqual({ token: TEST_PAT, source: 'file' });
  });

  it('returns null when nothing is provided', async () => {
    const result = await loadToken({
      cli: {},
      env: {},
      userFilePath: tmpFile,
    });
    expect(result).toBeNull();
  });

  it('rejects file with insecure permissions on POSIX', async () => {
    if (process.platform === 'win32') return; // Windows 不强制 POSIX mode
    await fs.writeFile(tmpFile, TEST_PAT, { mode: 0o644 });
    await expect(
      loadToken({ cli: {}, env: {}, userFilePath: tmpFile }),
    ).rejects.toBeInstanceOf(TokenLoadError);
  });
});
