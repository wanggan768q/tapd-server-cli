import { describe, expect, it } from 'vitest';

import {
  buildTapdEntry,
  entriesEqual,
} from '../../src/installer/adapter.js';
import { claudeCodeAdapter } from '../../src/installer/adapters/claude-code.js';
import { codexAdapter } from '../../src/installer/adapters/codex.js';
import { cursorAdapter } from '../../src/installer/adapters/cursor.js';
import { opencodeAdapter } from '../../src/installer/adapters/opencode.js';

describe('adapter.entriesEqual', () => {
  it('returns true for identical entries', () => {
    const a = buildTapdEntry({ TAPD_TOKEN: 'x' });
    const b = buildTapdEntry({ TAPD_TOKEN: 'x' });
    expect(entriesEqual(a, b)).toBe(true);
  });

  it('returns false when env values differ', () => {
    const a = buildTapdEntry({ TAPD_TOKEN: 'x' });
    const b = buildTapdEntry({ TAPD_TOKEN: 'y' });
    expect(entriesEqual(a, b)).toBe(false);
  });

  it('returns false when env keys differ', () => {
    const a = buildTapdEntry({ TAPD_TOKEN: 'x' });
    const b = buildTapdEntry({ TAPD_TOKEN: 'x', EXTRA: '1' });
    expect(entriesEqual(a, b)).toBe(false);
  });
});

describe('claude-code adapter', () => {
  it('merges into top-level mcpServers.tapd preserving other keys', () => {
    const existing = {
      mcpServers: { other: { command: 'foo' } },
      projects: { '/a': {} },
    };
    const merged = claudeCodeAdapter.merge(existing, { TAPD_TOKEN: 't' }) as Record<
      string,
      unknown
    >;
    expect((merged.mcpServers as Record<string, unknown>).other).toEqual({ command: 'foo' });
    expect((merged.mcpServers as Record<string, unknown>).tapd).toMatchObject({
      command: 'npx',
      args: ['-y', 'tapd-server-cli'],
      env: { TAPD_TOKEN: 't' },
    });
    expect(merged.projects).toEqual({ '/a': {} });
  });

  it('isUpToDate true when entry already matches', () => {
    const env = { TAPD_TOKEN: 'x' };
    const cfg = claudeCodeAdapter.merge(undefined, env);
    expect(claudeCodeAdapter.isUpToDate(cfg, env)).toBe(true);
  });

  it('isUpToDate false when env differs', () => {
    const cfg = claudeCodeAdapter.merge(undefined, { TAPD_TOKEN: 'x' });
    expect(claudeCodeAdapter.isUpToDate(cfg, { TAPD_TOKEN: 'y' })).toBe(false);
  });

  it('describeNext shows command + env keys', () => {
    const text = claudeCodeAdapter.describeNext({ TAPD_TOKEN: 'x', FOO: 'y' });
    expect(text).toContain('command=npx');
    expect(text).toContain('TAPD_TOKEN');
    expect(text).toContain('FOO');
    expect(text).not.toContain('=x'); // 不应泄漏 token 值
  });
});

describe('codex adapter', () => {
  it('merges into mcp_servers.tapd (snake_case)', () => {
    const merged = codexAdapter.merge(undefined, { TAPD_TOKEN: 't' }) as Record<
      string,
      unknown
    >;
    const tapd = (merged.mcp_servers as Record<string, unknown>).tapd as Record<
      string,
      unknown
    >;
    expect(tapd.command).toBe('npx');
    expect(tapd.args).toEqual(['-y', 'tapd-server-cli']);
    expect(tapd.env).toEqual({ TAPD_TOKEN: 't' });
  });

  it('preserves other mcp_servers entries', () => {
    const existing = { mcp_servers: { other: { command: 'foo', args: [] } } };
    const merged = codexAdapter.merge(existing, { TAPD_TOKEN: 't' }) as Record<
      string,
      unknown
    >;
    expect((merged.mcp_servers as Record<string, unknown>).other).toBeDefined();
  });
});

describe('opencode adapter', () => {
  it('writes mcpServers.tapd', () => {
    const merged = opencodeAdapter.merge(undefined, { TAPD_TOKEN: 't' }) as Record<
      string,
      unknown
    >;
    expect((merged.mcpServers as Record<string, unknown>).tapd).toMatchObject({
      command: 'npx',
    });
  });

  it('configPath ends with .config/opencode/mcp.json', () => {
    const p = opencodeAdapter.configPath().replace(/\\/g, '/');
    expect(p).toMatch(/\.config\/opencode\/mcp\.json$/);
  });
});

describe('cursor adapter', () => {
  it('writes mcpServers.tapd', () => {
    const merged = cursorAdapter.merge(undefined, { TAPD_TOKEN: 't' }) as Record<
      string,
      unknown
    >;
    expect((merged.mcpServers as Record<string, unknown>).tapd).toMatchObject({
      command: 'npx',
    });
  });

  it('configPath ends with .cursor/mcp.json', () => {
    const p = cursorAdapter.configPath().replace(/\\/g, '/');
    expect(p).toMatch(/\.cursor\/mcp\.json$/);
  });
});
