/**
 * B1: preferCodexCliInstall — 优先调用 Codex 官方 CLI `codex mcp add` 注册 MCP server，
 *     CLI 不可用或调用失败时回退给调用方手写 ~/.codex/config.toml 的现行路径。
 */

import { describe, expect, it } from 'vitest';

import {
  defaultCodexCliProbe,
  preferCodexCliInstall,
  type CodexCliProbe,
} from '../../src/installer/codex-cli.js';

function fakeProbe(overrides: Partial<CodexCliProbe>): CodexCliProbe {
  return {
    isAvailable: () => true,
    addStdio: () => ({ ok: true, stderr: '' }),
    ...overrides,
  };
}

describe('preferCodexCliInstall', () => {
  it('returns used="fallback" when codex CLI is not available', async () => {
    const probe = fakeProbe({ isAvailable: () => false });
    const r = await preferCodexCliInstall({ TAPD_TOKEN: 'x' }, probe);
    expect(r.used).toBe('fallback');
  });

  it('invokes codex mcp add with stdio command and env when CLI is available', async () => {
    const calls: Array<{
      name: string;
      command: string;
      args: string[];
      env: Record<string, string>;
    }> = [];
    const probe = fakeProbe({
      addStdio: (name, command, args, env) => {
        calls.push({ name, command, args, env });
        return { ok: true, stderr: '' };
      },
    });
    const r = await preferCodexCliInstall(
      { TAPD_TOKEN: 'tok-abc', TAPD_LOG_LEVEL: 'info' },
      probe,
    );
    expect(r.used).toBe('cli');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('tapd');
    expect(calls[0]?.command).toBe('npx');
    expect(calls[0]?.args).toEqual(['-y', 'tapd-server-cli']);
    expect(calls[0]?.env).toEqual({ TAPD_TOKEN: 'tok-abc', TAPD_LOG_LEVEL: 'info' });
  });

  it('returns used="fallback" with stderr when addStdio reports failure', async () => {
    const probe = fakeProbe({
      addStdio: () => ({ ok: false, stderr: 'Error: server name conflict\n' }),
    });
    const r = await preferCodexCliInstall({ TAPD_TOKEN: 'x' }, probe);
    expect(r.used).toBe('fallback');
    expect(r.stderr).toContain('server name conflict');
  });

  it('does not leak token to stderr when probe throws', async () => {
    const probe = fakeProbe({
      addStdio: () => {
        throw new Error('spawn EACCES');
      },
    });
    const r = await preferCodexCliInstall({ TAPD_TOKEN: 'super-secret-pat' }, probe);
    expect(r.used).toBe('fallback');
    expect(r.stderr ?? '').not.toContain('super-secret-pat');
  });
});

/**
 * Smoke tests for defaultCodexCliProbe — exercises the REAL spawnSync path.
 * PR #1 follow-up #6: real spawn path was previously untested.
 */
describe('defaultCodexCliProbe (smoke)', () => {
  it('isAvailable() returns false and does not throw when codex is not on PATH', () => {
    const oldPath = process.env.PATH;
    const oldPathExt = process.env.PATHEXT;
    process.env.PATH = process.platform === 'win32' ? 'C:\\__nonexistent__' : '/__nonexistent__';
    if (process.platform === 'win32') process.env.PATHEXT = '';
    try {
      const probe = defaultCodexCliProbe();
      expect(() => probe.isAvailable()).not.toThrow();
      expect(probe.isAvailable()).toBe(false);
    } finally {
      process.env.PATH = oldPath;
      if (oldPathExt !== undefined) process.env.PATHEXT = oldPathExt;
    }
  });

  it('addStdio on missing binary returns ok:false without throwing', () => {
    const oldPath = process.env.PATH;
    process.env.PATH = process.platform === 'win32' ? 'C:\\__nonexistent__' : '/__nonexistent__';
    try {
      const probe = defaultCodexCliProbe();
      const r = probe.addStdio('tapd', 'npx', ['-y', 'tapd-server-cli'], { TAPD_TOKEN: 'x' });
      expect(r.ok).toBe(false);
      expect(typeof r.stderr).toBe('string');
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('on win32, resolveBinaryName probes .cmd/.ps1/.exe candidates without throwing', () => {
    const oldPath = process.env.PATH;
    const oldPlatform = process.env.TAPD_TEST_PLATFORM;
    process.env.PATH = '/__nonexistent__';
    process.env.TAPD_TEST_PLATFORM = 'win32';
    try {
      const probe = defaultCodexCliProbe();
      expect(probe.isAvailable()).toBe(false);
    } finally {
      process.env.PATH = oldPath;
      if (oldPlatform === undefined) {
        delete process.env.TAPD_TEST_PLATFORM;
      } else {
        process.env.TAPD_TEST_PLATFORM = oldPlatform;
      }
    }
  });
});
