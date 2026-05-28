/**
 * Plugin manifest 静态校验：
 *   1. plugin.json / marketplace.json / .mcp.json 都是合法 JSON
 *   2. plugin.json.version === marketplace.json.plugins[0].version === package.json.version
 *   3. .mcp.json 的 env.TAPD_TOKEN 是 ${user_config.tapd_token} 占位符（不能写死真 PAT）
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('plugin manifest', () => {
  it('plugin.json schema basics', () => {
    const p = JSON.parse(readFileSync('./.claude-plugin/plugin.json', 'utf8'));
    expect(p.name).toBe('tapd-server-cli');
    expect(p.userConfig?.tapd_token?.sensitive).toBe(true);
    expect(p.userConfig?.tapd_token?.type).toBe('string');
    expect(p.mcpServers).toBe('./.mcp.json');
  });

  it('version in plugin.json / marketplace.json / package.json all match', () => {
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8')).version;
    const plg = JSON.parse(readFileSync('./.claude-plugin/plugin.json', 'utf8')).version;
    const mkt = JSON.parse(readFileSync('./.claude-plugin/marketplace.json', 'utf8'))
      .plugins[0].version;
    expect(plg).toBe(pkg);
    expect(mkt).toBe(pkg);
  });

  it('.mcp.json injects TAPD_TOKEN via user_config placeholder, not literal', () => {
    const m = JSON.parse(readFileSync('./.mcp.json', 'utf8'));
    const tapd = m.mcpServers?.tapd;
    expect(tapd?.command).toBe('npx');
    // args[1] 形如 'tapd-server-cli@~0.2.0'：锁 minor 范围（patch 自动跟、
    // minor/major 必须显式 /plugin marketplace update）。
    // 使用宽匹配，避免每次 npm version 都要同步改测试。
    expect(tapd?.args?.[0]).toBe('-y');
    expect(tapd?.args?.[1]).toMatch(/^tapd-server-cli@~\d+\.\d+\.0$/);
    expect(tapd?.env?.TAPD_TOKEN).toBe('${user_config.tapd_token}');
    expect(tapd?.env?.TAPD_LOG_LEVEL).toBe('info');
  });

  it('.mcp.json args minor range matches package.json minor', () => {
    const pkgVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version as string;
    const m = JSON.parse(readFileSync('./.mcp.json', 'utf8'));
    const arg = m.mcpServers?.tapd?.args?.[1] as string;
    const match = /^tapd-server-cli@~(\d+)\.(\d+)\.0$/.exec(arg);
    expect(match).not.toBeNull();
    const pkgMatch = /^(\d+)\.(\d+)\./.exec(pkgVersion);
    expect(pkgMatch).not.toBeNull();
    expect(match![1]).toBe(pkgMatch![1]);
    expect(match![2]).toBe(pkgMatch![2]);
  });
});
