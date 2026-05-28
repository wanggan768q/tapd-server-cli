/**
 * Tool-level tests for src/tools/update.ts:
 *   - 注入式 NpmViewProbe 覆盖 timeout / fetch failure / latest 正常解析
 *   - 任何分支下 fetch_error 都不能含 PAT（spec：update-command「不泄漏环境敏感值」）
 */

import { describe, expect, it } from 'vitest';

import { computeUpdateInfo, type NpmViewProbe } from '../../src/tools/update.js';
import { VERSION } from '../../src/runtime/version.js';

function fakeProbe(impl: NpmViewProbe['fetchLatestVersion']): NpmViewProbe {
  return { fetchLatestVersion: impl };
}

describe('computeUpdateInfo', () => {
  it('returns current=VERSION, latest=fetched, comparison=up-to-date when equal', () => {
    const info = computeUpdateInfo({
      probe: fakeProbe(() => ({ ok: true, version: VERSION })),
      env: { CLAUDE_PLUGIN_ROOT: '/x' },
      argv: ['node', '/x/dist/index.js'],
    });
    expect(info.current).toBe(VERSION);
    expect(info.latest).toBe(VERSION);
    expect(info.comparison).toBe('up-to-date');
    expect(info.installed_via).toBe('plugin');
    expect(info.upgrade_commands).toEqual([]);
    expect(info.fetch_error).toBeNull();
  });

  it('returns update-available when latest > current', () => {
    // current 由 VERSION 内联，假设 0.2.0；这里 mock 返回更高版本
    const info = computeUpdateInfo({
      probe: fakeProbe(() => ({ ok: true, version: '99.0.0' })),
      env: {},
      argv: ['node', '/usr/local/bin/tapd'],
    });
    expect(info.latest).toBe('99.0.0');
    expect(info.comparison).toBe('update-available');
    expect(info.installed_via).toBe('npx');
    expect(info.upgrade_commands.length).toBeGreaterThanOrEqual(1);
    expect(info.upgrade_commands[0]?.steps.some((s) => s.includes('npx'))).toBe(true);
  });

  it('handles probe failure (timeout) → latest=null, fetch_error set, comparison=unknown', () => {
    const info = computeUpdateInfo({
      probe: fakeProbe(() => ({ ok: false, error: 'timeout (5s)' })),
      env: {},
      argv: ['node', '/anywhere'],
    });
    expect(info.latest).toBeNull();
    expect(info.comparison).toBe('unknown');
    expect(info.fetch_error).toBe('timeout (5s)');
    expect(info.upgrade_commands).toHaveLength(1);
    expect(info.upgrade_commands[0]?.label).toContain('手动');
  });

  it('handles probe throwing (defensive) → fetch_error set, no crash', () => {
    const info = computeUpdateInfo({
      probe: fakeProbe(() => {
        throw new Error('boom');
      }),
      env: {},
      argv: ['node', '/anywhere'],
    });
    expect(info.latest).toBeNull();
    expect(info.comparison).toBe('unknown');
    expect(info.fetch_error).toContain('boom');
  });

  it('does not leak TAPD_TOKEN through fetch_error when probe error mentions env values', () => {
    const TOKEN = 'super-secret-pat-99';
    const info = computeUpdateInfo({
      probe: fakeProbe(() => ({
        ok: false,
        error: `npm view crashed because TAPD_TOKEN=${TOKEN} was somehow propagated`,
      })),
      env: { TAPD_TOKEN: TOKEN },
      argv: ['node', '/anywhere'],
    });
    expect(info.fetch_error).toBeTruthy();
    expect(info.fetch_error).not.toContain(TOKEN);
    expect(info.fetch_error).toContain('***');
  });

  it('does not leak URL-encoded form of TAPD_TOKEN', () => {
    const TOKEN = 'tok+abc/def=xyz';
    const encoded = encodeURIComponent(TOKEN);
    const info = computeUpdateInfo({
      probe: fakeProbe(() => ({ ok: false, error: `network failed (encoded=${encoded})` })),
      env: { TAPD_TOKEN: TOKEN },
      argv: ['node', '/anywhere'],
    });
    expect(info.fetch_error).not.toContain(TOKEN);
    expect(info.fetch_error).not.toContain(encoded);
  });
});
