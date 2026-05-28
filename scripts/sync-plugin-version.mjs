#!/usr/bin/env node
/**
 * 同步 plugin.json / marketplace.json / .mcp.json / src/runtime/version.ts
 * 的 version 到 package.json.version。由 npm version 钩子调用：
 *   "scripts": { "version": "node scripts/sync-plugin-version.mjs && git add ..." }
 *
 * 同步映射：
 *   package.json.version             ↦ plugin.json.version
 *   package.json.version             ↦ marketplace.json.plugins[*].version
 *   ~<major>.<minor>.0               ↦ .mcp.json.mcpServers.tapd.args[1] 的 @<range> 部分
 *   `export const VERSION = '<v>'`  ↦ src/runtime/version.ts
 *
 * 退出码：
 *   0 — 同步成功（即便 version 已经一致也算成功）
 *   1 — 文件读写失败 / JSON 解析失败 / .mcp.json args 形态非预期
 */

import { readFileSync, writeFileSync } from 'node:fs';

const pkgPath = './package.json';
const pluginPath = './.claude-plugin/plugin.json';
const marketplacePath = './.claude-plugin/marketplace.json';
const mcpPath = './.mcp.json';
const versionTsPath = './src/runtime/version.ts';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const targetVersion = pkg.version;
const m = /^(\d+)\.(\d+)\.\d+/.exec(targetVersion);
if (!m) {
  console.error(`package.json.version "${targetVersion}" 不是合法 semver`);
  process.exit(1);
}
const minorRange = `~${m[1]}.${m[2]}.0`;
console.log(`Syncing → version=${targetVersion}, .mcp.json range=${minorRange}`);

// plugin.json
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
if (plugin.version !== targetVersion) {
  plugin.version = targetVersion;
  writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
  console.log(`  ✓ ${pluginPath}`);
} else {
  console.log(`  = ${pluginPath} (already ${targetVersion})`);
}

// marketplace.json
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
let marketplaceChanged = false;
for (const p of marketplace.plugins ?? []) {
  if (p.version !== targetVersion) {
    p.version = targetVersion;
    marketplaceChanged = true;
  }
}
if (marketplaceChanged) {
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n', 'utf8');
  console.log(`  ✓ ${marketplacePath}`);
} else {
  console.log(`  = ${marketplacePath} (already ${targetVersion})`);
}

// .mcp.json — args[1] 形如 'tapd-server-cli@~0.2.0'
const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
const args = mcp?.mcpServers?.tapd?.args;
if (!Array.isArray(args) || args.length < 2) {
  console.error(`.mcp.json: mcpServers.tapd.args 不是含 >=2 个元素的数组`);
  process.exit(1);
}
const targetArg = `tapd-server-cli@${minorRange}`;
if (args[1] !== targetArg) {
  args[1] = targetArg;
  writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n', 'utf8');
  console.log(`  ✓ ${mcpPath} → ${targetArg}`);
} else {
  console.log(`  = ${mcpPath} (already ${targetArg})`);
}

// src/runtime/version.ts
const versionTs = readFileSync(versionTsPath, 'utf8');
const newVersionTs = versionTs.replace(
  /export const VERSION = '[^']+';/,
  `export const VERSION = '${targetVersion}';`,
);
if (newVersionTs === versionTs) {
  // 看是不是已经是目标值
  if (versionTs.includes(`export const VERSION = '${targetVersion}';`)) {
    console.log(`  = ${versionTsPath} (already ${targetVersion})`);
  } else {
    console.error(
      `${versionTsPath}: 没找到 \`export const VERSION = '...';\` 形态行，无法同步`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(versionTsPath, newVersionTs, 'utf8');
  console.log(`  ✓ ${versionTsPath} → ${targetVersion}`);
}
