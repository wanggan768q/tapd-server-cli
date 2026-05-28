/**
 * B1: preferClaudeCliInstall — 优先调用 Claude Code 官方 CLI `claude mcp add-json` 注册 MCP
 *     server，CLI 不可用或调用失败时回退给调用方手写 ~/.claude.json 的现行路径。
 *
 * 这一层从 ClaudeCliProbe 接口注入子进程探针，便于在单测里完全脱离真实 `claude` CLI。
 */

import { describe, expect, it } from 'vitest';

import {
  preferClaudeCliInstall,
  type ClaudeCliProbe,
} from '../../src/installer/claude-cli.js';

function fakeProbe(overrides: Partial<ClaudeCliProbe>): ClaudeCliProbe {
  return {
    isAvailable: () => true,
    addJson: () => ({ ok: true, stderr: '' }),
    ...overrides,
  };
}

describe('preferClaudeCliInstall', () => {
  it('returns used="fallback" when claude CLI is not available', async () => {
    const probe = fakeProbe({ isAvailable: () => false });
    const r = await preferClaudeCliInstall({ TAPD_TOKEN: 'x' }, probe);
    expect(r.used).toBe('fallback');
  });

  it('invokes claude mcp add-json with --scope user when CLI is available', async () => {
    const calls: Array<{ name: string; json: string; scope: string }> = [];
    const probe = fakeProbe({
      addJson: (name, json, scope) => {
        calls.push({ name, json, scope });
        return { ok: true, stderr: '' };
      },
    });
    const r = await preferClaudeCliInstall(
      { TAPD_TOKEN: 'tok-abc', TAPD_LOG_LEVEL: 'info' },
      probe,
    );
    expect(r.used).toBe('cli');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('tapd');
    expect(calls[0]?.scope).toBe('user');
    const payload = JSON.parse(calls[0]!.json) as Record<string, unknown>;
    expect(payload).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'tapd-server-cli'],
      env: { TAPD_TOKEN: 'tok-abc', TAPD_LOG_LEVEL: 'info' },
    });
  });

  it('returns used="fallback" with stderr when addJson reports failure', async () => {
    const probe = fakeProbe({
      addJson: () => ({ ok: false, stderr: 'Error: invalid scope\n' }),
    });
    const r = await preferClaudeCliInstall({ TAPD_TOKEN: 'x' }, probe);
    expect(r.used).toBe('fallback');
    expect(r.stderr).toContain('invalid scope');
  });

  it('does not leak token to stderr when probe throws', async () => {
    const probe = fakeProbe({
      addJson: () => {
        throw new Error('spawn EACCES');
      },
    });
    const r = await preferClaudeCliInstall({ TAPD_TOKEN: 'super-secret-pat' }, probe);
    expect(r.used).toBe('fallback');
    expect(r.stderr ?? '').not.toContain('super-secret-pat');
  });
});
