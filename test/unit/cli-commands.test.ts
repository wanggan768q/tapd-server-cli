/**
 * Unit tests for src/commands/* CLI handler modules.
 *
 * v0.3.0 §C：login / logout / update 三个 CLI 子命令的 happy/sad path 覆盖。
 * 用 PassThrough stdio + 注入 mock deps 隔离副作用（不弹真浏览器、不真 spawn npm view）。
 */

import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loginCommand } from '../../src/commands/login-handler.js';
import { logoutCommand } from '../../src/commands/logout-handler.js';
import { updateCommand, compareSemver } from '../../src/commands/update-handler.js';

function fakeStdio() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (b: Buffer) => out.push(b.toString('utf8')));
  stderr.on('data', (b: Buffer) => err.push(b.toString('utf8')));
  return {
    stdout: stdout as unknown as NodeJS.WritableStream,
    stderr: stderr as unknown as NodeJS.WritableStream,
    out,
    err,
  };
}

describe('loginCommand', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tapd-login-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('happy path: spawns browser, captures cookie, saves to file, exit 0', async () => {
    const cookiePath = join(tempDir, 'cookie');
    const { stdout, stderr, out } = fakeStdio();

    const r = await loginCommand({
      timeout: 60,
      stdout,
      stderr,
      deps: {
        launchAndGrabCookie: async () => ({
          cookieHeader: 't_i_token=abc123; other=v',
          cookieCount: 2,
          domainSuffix: 'tapd.cn',
          browserPath: '/fake/chrome',
        }),
        createCookieStore: () => ({
          load: async () => undefined,
          save: async (value: string) => {
            await fs.writeFile(cookiePath, value);
            return { path: cookiePath };
          },
          clear: async () => ({ path: cookiePath, existed: false }),
          filePath: () => cookiePath,
        }),
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.savedTo).toBe(cookiePath);
    expect(out.join('')).toContain('✓ Logged in');
    expect(out.join('')).toContain(cookiePath);
    expect(out.join('')).toContain('2 cookie(s)');
    // cookie 真的写入
    await expect(fs.readFile(cookiePath, 'utf8')).resolves.toContain('t_i_token=abc123');
  });

  it('timeout: stderr Error + exit 1', async () => {
    const { stdout, stderr, err } = fakeStdio();

    const r = await loginCommand({
      timeout: 60,
      stdout,
      stderr,
      deps: {
        launchAndGrabCookie: async () => {
          const e = new Error('超时未检测到 TAPD 登录态（等待 60s）');
          e.name = 'LoginTimeoutError';
          throw e;
        },
      },
    });

    expect(r.exitCode).toBe(1);
    expect(err.join('')).toContain('Error:');
    expect(err.join('')).toContain('超时');
  });

  it('browser not found: stderr Error + exit 1', async () => {
    const { stdout, stderr, err } = fakeStdio();

    const r = await loginCommand({
      stdout,
      stderr,
      deps: {
        launchAndGrabCookie: async () => {
          const e = new Error('未在常见路径找到 Chrome 或 Edge');
          e.name = 'BrowserNotFoundError';
          throw e;
        },
      },
    });

    expect(r.exitCode).toBe(1);
    expect(err.join('')).toContain('Chrome');
  });
});

describe('logoutCommand', () => {
  it('cookie exists: deletes, stdout ✓, exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await logoutCommand({
      stdout,
      stderr,
      deps: {
        createCookieStore: () => ({
          load: async () => undefined,
          save: async () => ({ path: '/fake/path/cookie' }),
          clear: async () => ({ path: '/fake/path/cookie', existed: true }),
          filePath: () => '/fake/path/cookie',
        }),
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.cleared).toBe(true);
    expect(out.join('')).toContain('✓ Logged out');
    expect(out.join('')).toContain('/fake/path/cookie');
  });

  it('cookie missing: stdout = nothing to clear, exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await logoutCommand({
      stdout,
      stderr,
      deps: {
        createCookieStore: () => ({
          load: async () => undefined,
          save: async () => ({ path: '/fake/path/cookie' }),
          clear: async () => ({ path: '/fake/path/cookie', existed: false }),
          filePath: () => '/fake/path/cookie',
        }),
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.cleared).toBe(false);
    expect(out.join('')).toContain('No cookie file found');
    expect(out.join('')).toContain('nothing to clear');
  });

  it('IO error: stderr Error + exit 1', async () => {
    const { stdout, stderr, err } = fakeStdio();

    const r = await logoutCommand({
      stdout,
      stderr,
      deps: {
        createCookieStore: () => ({
          load: async () => undefined,
          save: async () => ({ path: '/fake/path/cookie' }),
          clear: async () => {
            throw new Error('EACCES: permission denied');
          },
          filePath: () => '/fake/path/cookie',
        }),
      },
    });

    expect(r.exitCode).toBe(1);
    expect(r.cleared).toBe(false);
    expect(err.join('')).toContain('Error:');
    expect(err.join('')).toContain('EACCES');
  });
});

describe('compareSemver', () => {
  it('equal versions return 0', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('0.3.0', '0.3.0')).toBe(0);
  });

  it('strips leading v', () => {
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('v1.2.3', 'v1.2.4')).toBe(-1);
  });

  it('strips prerelease tags', () => {
    expect(compareSemver('1.2.3-beta.1', '1.2.3')).toBe(0);
  });

  it('major > minor > patch ordering', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
    expect(compareSemver('1.2.5', '1.2.4')).toBe(1);
  });

  it('handles missing parts as 0', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
  });
});

describe('updateCommand', () => {
  it('uptodate: text mode shows ✓, exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.3.0',
        fetchLatestVersion: () => '0.3.0',
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.comparison).toBe('uptodate');
    expect(r.current).toBe('0.3.0');
    expect(r.latest).toBe('0.3.0');
    expect(out.join('')).toContain('✓ Up to date');
    expect(out.join('')).toContain('0.3.0');
  });

  it('outdated: text mode shows upgrade hint with two commands, exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.2.2',
        fetchLatestVersion: () => '0.3.0',
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.comparison).toBe('outdated');
    const joined = out.join('');
    expect(joined).toContain('Update available');
    expect(joined).toContain('0.2.2');
    expect(joined).toContain('0.3.0');
    expect(joined).toContain('npm i -g tapd-server-cli@latest');
    expect(joined).toContain('npx tapd-server-cli@latest install claude-code');
  });

  it('ahead: text mode notes local is newer than npm, exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.4.0',
        fetchLatestVersion: () => '0.3.0',
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.comparison).toBe('ahead');
    expect(out.join('')).toContain('ahead of npm');
  });

  it('fetch error: text mode notes Network error, still exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.3.0',
        fetchLatestVersion: () => {
          throw new Error('ETIMEDOUT: connect timeout');
        },
      },
    });

    expect(r.exitCode).toBe(0);
    expect(r.comparison).toBe('fetch_error');
    expect(r.latest).toBeNull();
    expect(r.fetchError).toContain('ETIMEDOUT');
    expect(out.join('')).toContain('Network error');
    expect(out.join('')).toContain('0.3.0');
  });

  it('--json uptodate: emits parseable JSON with empty upgrade_commands', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      json: true,
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.3.0',
        fetchLatestVersion: () => '0.3.0',
      },
    });

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(out.join('').trim());
    expect(parsed.current).toBe('0.3.0');
    expect(parsed.latest).toBe('0.3.0');
    expect(parsed.comparison).toBe('uptodate');
    expect(parsed.upgrade_commands).toEqual([]);
  });

  it('--json outdated: JSON includes upgrade_commands array of two items', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      json: true,
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.2.2',
        fetchLatestVersion: () => '0.3.0',
      },
    });

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(out.join('').trim());
    expect(parsed.comparison).toBe('outdated');
    expect(parsed.upgrade_commands).toHaveLength(2);
    expect(parsed.upgrade_commands[0]).toContain('npm i -g');
    expect(parsed.upgrade_commands[1]).toContain('npx tapd-server-cli@latest');
  });

  it('--json fetch_error: JSON has latest:null + fetch_error, still exit 0', async () => {
    const { stdout, stderr, out } = fakeStdio();

    const r = await updateCommand({
      json: true,
      stdout,
      stderr,
      deps: {
        readCurrentVersion: () => '0.3.0',
        fetchLatestVersion: () => {
          throw new Error('ENOTFOUND registry.npmjs.org');
        },
      },
    });

    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(out.join('').trim());
    expect(parsed.current).toBe('0.3.0');
    expect(parsed.latest).toBeNull();
    expect(parsed.comparison).toBe('fetch_error');
    expect(parsed.fetch_error).toContain('ENOTFOUND');
  });
});
