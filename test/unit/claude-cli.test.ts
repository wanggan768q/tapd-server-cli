/**
 * B1: preferClaudeCliInstall — 优先调用 Claude Code 官方 CLI `claude mcp add-json` 注册 MCP
 *     server，CLI 不可用或调用失败时回退给调用方手写 ~/.claude.json 的现行路径。
 *
 * 这一层从 ClaudeCliProbe 接口注入子进程探针，便于在单测里完全脱离真实 `claude` CLI。
 */

import { describe, expect, it } from 'vitest';

import {
  defaultClaudeCliProbe,
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
    expect(payload).toEqual({
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

/**
 * Smoke tests for defaultClaudeCliProbe — exercises the REAL spawnSync path
 * (no mocks). Verifies that when `claude` is not on PATH, the probe degrades
 * gracefully to `isAvailable() === false` without throwing.
 *
 * PR #1 follow-up #6: real spawn path was previously untested.
 */
describe('defaultClaudeCliProbe (smoke)', () => {
  it('isAvailable() returns false and does not throw when claude is not on PATH', () => {
    const oldPath = process.env.PATH;
    const oldPathExt = process.env.PATHEXT;
    // 用一个一定不存在的目录覆盖 PATH，让 'claude' / 'claude.cmd' 等都 ENOENT
    process.env.PATH = process.platform === 'win32' ? 'C:\\__nonexistent__' : '/__nonexistent__';
    // PATHEXT 也清空，避免 Node 内部 shell-less 解析意外命中
    if (process.platform === 'win32') process.env.PATHEXT = '';
    try {
      const probe = defaultClaudeCliProbe();
      expect(() => probe.isAvailable()).not.toThrow();
      expect(probe.isAvailable()).toBe(false);
    } finally {
      process.env.PATH = oldPath;
      if (oldPathExt !== undefined) process.env.PATHEXT = oldPathExt;
    }
  });

  it('addJson on missing binary returns ok:false without throwing', () => {
    const oldPath = process.env.PATH;
    process.env.PATH = process.platform === 'win32' ? 'C:\\__nonexistent__' : '/__nonexistent__';
    try {
      const probe = defaultClaudeCliProbe();
      const r = probe.addJson('tapd', '{}', 'user');
      expect(r.ok).toBe(false);
      // stderr 不应包含原始 token（这里没传 token，仅断言不抛 + 返回结构正确）
      expect(typeof r.stderr).toBe('string');
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('on win32, resolveBinaryName probes .cmd/.ps1/.exe candidates without throwing', () => {
    // 用 TAPD_TEST_PLATFORM 钩子强制走 win32 候选名探测分支，
    // 在非 Windows 上这些候选名也都不存在，应平稳归到 'claude' 兜底。
    const oldPath = process.env.PATH;
    const oldPlatform = process.env.TAPD_TEST_PLATFORM;
    process.env.PATH = '/__nonexistent__';
    process.env.TAPD_TEST_PLATFORM = 'win32';
    try {
      // resolveBinaryName 是模块加载时执行；这里通过新一次 defaultClaudeCliProbe 调用触发
      const probe = defaultClaudeCliProbe();
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
