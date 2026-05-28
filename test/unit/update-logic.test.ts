/**
 * Pure-function tests for src/tools/update.ts
 *   - detectInstalledVia: env / argv 双信号检测
 *   - compareVersions: semver 大小比较
 *   - buildUpgradeCommands: 路径 × 比较结果的指令分流
 */

import { describe, expect, it } from 'vitest';

import {
  buildUpgradeCommands,
  compareVersions,
  detectInstalledVia,
} from '../../src/tools/update.js';

describe('detectInstalledVia', () => {
  it('returns plugin when CLAUDE_PLUGIN_ROOT env is set', () => {
    expect(
      detectInstalledVia({ CLAUDE_PLUGIN_ROOT: '/whatever' }, ['node', '/abs/path/index.js']),
    ).toBe('plugin');
  });

  it('returns plugin when argv[1] contains .claude/plugins/ (POSIX)', () => {
    expect(
      detectInstalledVia({}, ['node', '/home/u/.claude/plugins/tapd-server-cli/dist/index.js']),
    ).toBe('plugin');
  });

  it('returns plugin when argv[1] contains .claude\\plugins\\ (Windows)', () => {
    expect(
      detectInstalledVia({}, ['node', 'C:\\Users\\u\\.claude\\plugins\\tapd\\dist\\index.js']),
    ).toBe('plugin');
  });

  it('returns npx as fallback when no plugin signal', () => {
    expect(
      detectInstalledVia({}, ['node', '/usr/local/lib/node_modules/tapd-server-cli/dist/index.js']),
    ).toBe('npx');
  });

  it('env signal takes precedence over argv', () => {
    // env 已表示 plugin，即便 argv 路径不在 plugin 目录里也判 plugin
    expect(
      detectInstalledVia({ CLAUDE_PLUGIN_ROOT: '/x' }, ['node', '/usr/local/bin/tapd']),
    ).toBe('plugin');
  });
});

describe('compareVersions', () => {
  it('returns up-to-date when versions match', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe('up-to-date');
  });

  it('returns update-available when current < latest (patch)', () => {
    expect(compareVersions('0.2.0', '0.2.1')).toBe('update-available');
  });

  it('returns update-available when current < latest (minor)', () => {
    expect(compareVersions('0.2.5', '0.3.0')).toBe('update-available');
  });

  it('returns update-available when current < latest (major)', () => {
    expect(compareVersions('0.9.9', '1.0.0')).toBe('update-available');
  });

  it('returns up-to-date when current > latest (e.g. local dev build)', () => {
    expect(compareVersions('0.3.0', '0.2.5')).toBe('up-to-date');
  });

  it('returns unknown when latest is null', () => {
    expect(compareVersions('0.2.0', null)).toBe('unknown');
  });

  it('returns unknown when version is non-semver', () => {
    expect(compareVersions('not-a-version', '0.2.0')).toBe('unknown');
    expect(compareVersions('0.2.0', 'not-a-version')).toBe('unknown');
  });

  it('ignores pre-release suffixes (compares core only)', () => {
    expect(compareVersions('0.2.0-rc1', '0.2.0')).toBe('up-to-date');
  });
});

describe('buildUpgradeCommands', () => {
  it('returns empty array when up-to-date', () => {
    expect(buildUpgradeCommands('plugin', 'up-to-date')).toEqual([]);
    expect(buildUpgradeCommands('npx', 'up-to-date')).toEqual([]);
  });

  it('returns plugin marketplace update path for plugin × update-available', () => {
    const cmds = buildUpgradeCommands('plugin', 'update-available');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.label).toContain('Claude Code plugin');
    expect(cmds[0]?.steps.some((s) => s.includes('/plugin marketplace update'))).toBe(true);
    expect(cmds[0]?.steps.some((s) => s.includes('重启'))).toBe(true);
  });

  it('returns npx install path for npx × update-available', () => {
    const cmds = buildUpgradeCommands('npx', 'update-available');
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    expect(cmds[0]?.steps.some((s) => s.includes('npx -y tapd-server-cli@latest install'))).toBe(
      true,
    );
    // 步骤里必须显式提示替换 <client>，否则用户会照抄 <client> 字面运行
    expect(cmds[0]?.steps.some((s) => s.includes('<client>'))).toBe(true);
  });

  it('returns "how to manually check" path for unknown', () => {
    const cmds = buildUpgradeCommands('plugin', 'unknown');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.steps.some((s) => s.includes('npm view tapd-server-cli version'))).toBe(true);
    // unknown 时不绑死安装路径，应该把两条路径都提一下让用户自己判断
    expect(cmds[0]?.steps.some((s) => s.includes('plugin'))).toBe(true);
    expect(cmds[0]?.steps.some((s) => s.includes('npx'))).toBe(true);
  });
});
