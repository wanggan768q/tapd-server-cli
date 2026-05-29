/**
 * Plugin manifest 静态校验：
 *   1. plugin.json / marketplace.json / .mcp.json 都是合法 JSON
 *   2. version 在 4 处一致：
 *      package.json.version
 *      === plugin.json.version
 *      === marketplace.json.plugins[0].version
 *      === src/runtime/version.ts 的 VERSION 常量字面值
 *   3. .mcp.json 的 env.TAPD_TOKEN 是 ${user_config.tapd_token} 占位符（不能写死真 PAT）
 *   4. .mcp.json args[1] 的 minor 范围与 package.json.version minor 一致
 *   5. npm version 钩子的 git add 列表覆盖 sync 脚本所有 writeFileSync 目标
 *      （元测试，防 hook 漏 add 导致版本漂移——v0.2.1 → 0.2.2 hotfix 的根因）
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

  it('version in package.json / plugin.json / marketplace.json / version.ts all match', () => {
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8')).version;
    const plg = JSON.parse(readFileSync('./.claude-plugin/plugin.json', 'utf8')).version;
    const mkt = JSON.parse(readFileSync('./.claude-plugin/marketplace.json', 'utf8'))
      .plugins[0].version;

    // 提取 src/runtime/version.ts 的 VERSION 常量字面值。
    // 用 readFileSync + regex 而非 import：vitest 直接 import .ts 走 ESM 编译路径
    // 容易踩坑，且我们要测的就是源文件字面字符串（最贴近 hook + dist 编译视角）。
    const versionTs = readFileSync('./src/runtime/version.ts', 'utf8');
    const versionTsMatch = /export const VERSION = '([^']+)'/.exec(versionTs);
    expect(versionTsMatch).not.toBeNull();
    const versionTsValue = versionTsMatch![1];

    expect(plg).toBe(pkg);
    expect(mkt).toBe(pkg);
    expect(versionTsValue).toBe(pkg);
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

  it('version sync targets cover all writeFileSync paths in sync script', () => {
    // 元测试：防 v0.2.1 → 0.2.2 hotfix 那种漂移再发生
    // —— scripts/sync-plugin-version.mjs 的 writeFileSync 集合
    //    必须等于 package.json.scripts.version 钩子的 git add 列表。
    // 漂移即 hook 漏 add，导致 npm version 自动 commit 缺文件、
    // 推 tag 后 CI 从 tag commit build 出来的 dist 也跟着旧。

    const script = readFileSync('./scripts/sync-plugin-version.mjs', 'utf8');
    const writeMatches = [...script.matchAll(/writeFileSync\(\s*([A-Za-z]+)\s*,/g)];
    // 收集所有 writeFileSync 的第一参数标识符（如 pluginPath / marketplacePath）
    const writeVars = new Set(writeMatches.map((m) => m[1]));
    // 把这些标识符解析回路径常量（脚本顶部的 const 声明）
    const constMatches = [...script.matchAll(/const\s+(\w+Path)\s*=\s*'([^']+)'/g)];
    const constMap = new Map(constMatches.map((m) => [m[1], m[2]]));
    const writePaths = new Set<string>();
    for (const v of writeVars) {
      const p = constMap.get(v);
      expect(p, `sync 脚本里 writeFileSync 用了未声明的 path 变量: ${v}`).toBeDefined();
      // 归一化：去掉前缀 ./
      writePaths.add(p!.replace(/^\.\//, ''));
    }

    // 解析 package.json.scripts.version 的 git add 列表
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
    const versionHook = pkg.scripts?.version as string;
    expect(versionHook).toBeDefined();
    const gitAddMatch = /git add ([^"]+)$/.exec(versionHook);
    expect(gitAddMatch, `package.json.scripts.version 应以 'git add <files...>' 结尾`).not.toBeNull();
    const gitAddPaths = new Set(gitAddMatch![1].trim().split(/\s+/));

    // 两集合必须相等
    expect(
      [...writePaths].sort(),
      `sync 脚本写过的文件 vs npm version 钩子 git add 列表不一致——hook 漏 add 会让 release commit 缺文件`,
    ).toEqual([...gitAddPaths].sort());
  });
});
