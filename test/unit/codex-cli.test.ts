/**
 * B1: preferCodexCliInstall — 优先调用 Codex 官方 CLI `codex mcp add` 注册 MCP server，
 *     CLI 不可用或调用失败时回退给调用方手写 ~/.codex/config.toml 的现行路径。
 */

import { describe, expect, it } from 'vitest';

import {
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
