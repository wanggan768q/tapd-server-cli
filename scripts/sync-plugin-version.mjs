#!/usr/bin/env node
/**
 * 同步 plugin.json / marketplace.json 的 version 到 package.json.version。
 * 由 npm version 钩子调用：
 *   "scripts": { "version": "node scripts/sync-plugin-version.mjs && git add ..." }
 *
 * 退出码：
 *   0 — 同步成功（即便 version 已经一致也算成功）
 *   1 — 文件读写失败 / JSON 解析失败
 */

import { readFileSync, writeFileSync } from 'node:fs';

const pkgPath = './package.json';
const pluginPath = './.claude-plugin/plugin.json';
const marketplacePath = './.claude-plugin/marketplace.json';

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const targetVersion = pkg.version;
console.log(`Syncing plugin version → ${targetVersion}`);

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
let changed = false;
for (const p of marketplace.plugins ?? []) {
  if (p.version !== targetVersion) {
    p.version = targetVersion;
    changed = true;
  }
}
if (changed) {
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n', 'utf8');
  console.log(`  ✓ ${marketplacePath}`);
} else {
  console.log(`  = ${marketplacePath} (already ${targetVersion})`);
}
