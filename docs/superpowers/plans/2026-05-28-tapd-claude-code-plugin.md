# Claude Code Plugin Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `tapd-server-cli` 仓库改造成 Claude Code plugin（让用户通过 `/plugin marketplace add` + `/plugin install` 一行装好、自动收 PAT、立即可用），同时让现行 `npx install claude-code/codex` 优先调官方 CLI（更稳更安全），并重排 README 顶部置顶 plugin 路径、澄清 `~/.claude.json` ≠ `~/.claude/settings.json`。

**Architecture:** 同仓库 packaging 层改动，零 `src/` server 代码修改。Plugin 启用时通过 `npx -y tapd-server-cli` 拉起现有 server，PAT 走 `userConfig.tapd_token`（sensitive=true）→ 系统 keychain → `${user_config.tapd_token}` 注入到 `.mcp.json` 的 `env`。`npx install` 路径新增 CLI probe 模块（`claude-cli.ts` / `codex-cli.ts`），优先调 `claude mcp add-json --scope user` 或 `codex mcp add`，失败回退现行手写文件。

**Tech Stack:** TypeScript ESM + vitest + Node.js 20 + commander + @inquirer/checkbox（已有依赖），新增模块仅用 Node 内置 `child_process.spawnSync`，零新增 npm 依赖。

**Spec 来源:** `openspec/changes/add-claude-code-plugin/`（commit `7643c91`），含 proposal.md / design.md / tasks.md / specs/claude-code-plugin/spec.md / specs/installer-cli/spec.md。

**PR 拆分（每个 PR 独立可测）:**
- **PR-1**：Tasks 1–10（B0 plugin packaging + 版本同步基建）
- **PR-2**：Tasks 11–24（B1 双 CLI probe + flow 集成 + plugin-manifest 测试）
- **PR-3**：Tasks 25–38（B3 README 重排 + 端到端 smoke + 发版）

---

## PR-1: B0 Plugin Packaging + 版本同步基建

### Task 1: 新增 `.claude-plugin/plugin.json`

**Files:**
- Create: `.claude-plugin/plugin.json`

- [ ] **Step 1: 创建 plugin manifest**

```bash
mkdir -p .claude-plugin
```

写入 `.claude-plugin/plugin.json`：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "tapd-server-cli",
  "displayName": "TAPD MCP Server",
  "version": "0.2.0",
  "description": "腾讯 TAPD 接入 Claude Code，读写需求/缺陷/迭代/工时/评论/附件等数据。",
  "author": {
    "name": "wanggan768q",
    "url": "https://github.com/wanggan768q"
    },
  "homepage": "https://github.com/wanggan768q/tapd-server-cli",
  "repository": "https://github.com/wanggan768q/tapd-server-cli",
  "license": "MIT",
  "keywords": ["tapd", "mcp", "tencent", "agile", "issue-tracker"],
  "userConfig": {
    "tapd_token": {
      "type": "string",
      "title": "TAPD 个人访问令牌",
      "description": "登录 TAPD → 设置 → 个人设置 → 安全设置 → API 令牌生成。令牌等同账号凭证，将存入系统 keychain（不落盘）。",
      "sensitive": true
    }
  },
  "mcpServers": "./.mcp.json"
}
```

- [ ] **Step 2: 验证 JSON 合法**

Run: `node -e "console.log(require('./.claude-plugin/plugin.json').name)"`
Expected: `tapd-server-cli`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat(plugin): add Claude Code plugin manifest"
```

---

### Task 2: 新增 `.claude-plugin/marketplace.json`

**Files:**
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: 写入 marketplace 入口**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "tapd-server-cli",
  "owner": {
    "name": "wanggan768q",
    "url": "https://github.com/wanggan768q"
  },
  "plugins": [
    {
      "name": "tapd-server-cli",
      "source": "./",
      "description": "腾讯 TAPD MCP server — 在 Claude Code 内读写需求/缺陷/迭代/工时/评论/附件",
      "category": "issue-tracker",
      "version": "0.2.0"
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 合法且 version 与 plugin.json 一致**

Run:
```bash
node -e "
const p = require('./.claude-plugin/plugin.json').version;
const m = require('./.claude-plugin/marketplace.json').plugins[0].version;
if (p !== m) { console.error('version mismatch:', p, m); process.exit(1); }
console.log('versions match:', p);
"
```
Expected: `versions match: 0.2.0`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(plugin): add marketplace manifest pointing to repo root"
```

---

### Task 3: 新增 `.mcp.json`

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: 写入 MCP server 配置**

```json
{
  "mcpServers": {
    "tapd": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tapd-server-cli"],
      "env": {
        "TAPD_TOKEN": "${user_config.tapd_token}",
        "TAPD_LOG_LEVEL": "info"
      }
    }
  }
}
```

- [ ] **Step 2: 验证 JSON 合法 + 占位符正确**

Run:
```bash
node -e "
const m = require('./.mcp.json').mcpServers.tapd;
if (m.command !== 'npx') process.exit(1);
if (m.env.TAPD_TOKEN !== '\${user_config.tapd_token}') process.exit(1);
console.log('mcp.json ok');
"
```
Expected: `mcp.json ok`

- [ ] **Step 3: Commit**

```bash
git add .mcp.json
git commit -m "feat(plugin): add bundled MCP server config (npx pulls server)"
```

---

### Task 4: 新增 `commands/login.md` 和 `commands/logout.md`

**Files:**
- Create: `commands/login.md`
- Create: `commands/logout.md`

- [ ] **Step 1: 创建 commands 目录与 login.md**

```bash
mkdir -p commands
```

写入 `commands/login.md`：

```markdown
---
description: 登录 TAPD（弹出隔离浏览器抓 cookie，启用附件下载）
---

请调用 MCP 工具 `tapd.login` 完成 TAPD 浏览器登录：

1. 工具会启动一个独立的 Chrome / Edge 窗口（不污染日常浏览器）
2. 用户在弹出窗口完成 TAPD 账号登录
3. cookie 自动写入 `~/.config/tapd-mcp/cookie`（POSIX 600）
4. 附件下载工具 `tapd.attachments.download` 通过 `tools/list_changed` 热加载，即刻可用

调用工具后，等用户确认登录完成；如有错误（如未安装 Chrome），按 `tapd.login` 返回的指引处理。
```

- [ ] **Step 2: 写入 logout.md**

```markdown
---
description: 登出 TAPD（清除 server 端 cookie，撤销附件下载工具）
---

请调用 MCP 工具 `tapd.logout` 清除 TAPD 浏览器 cookie：

1. 删除 `~/.config/tapd-mcp/cookie` 文件
2. `tapd.attachments.download` 工具通过 `tools/list_changed` 撤销
3. 后续如需下载附件，需重新调用 `tapd.login`

注意：`tapd.logout` 不会撤销 TAPD 服务端的 PAT；要完全卸载 plugin 与本地凭据，去 `/plugin uninstall tapd-server-cli` + `npx -y tapd-server-cli uninstall claude-code --purge`。
```

- [ ] **Step 3: Commit**

```bash
git add commands/login.md commands/logout.md
git commit -m "feat(plugin): add /tapd-server-cli:login /logout slash commands"
```

---

### Task 5: 新增 `.npmignore`

**Files:**
- Create: `.npmignore`

- [ ] **Step 1: 写入排除规则**

```
# Plugin packaging — never publish to npm registry
.claude-plugin/
.codex-plugin/
.mcp.json
commands/
skills/

# OpenSpec / docs not for end users of npm package
openspec/
docs/

# Build / test artifacts
test/
*.log
.git/
```

- [ ] **Step 2: 验证 npm pack 不含 plugin 文件**

Run: `npm pack --dry-run 2>&1 | tee /tmp/pack-output.txt`
Expected：输出的 "Tarball Contents" 区域**不**包含 `.claude-plugin/`、`.mcp.json`、`commands/`。

Run: `grep -E "\.claude-plugin|\.mcp\.json|^commands/|^skills/|^openspec/|^docs/" /tmp/pack-output.txt && exit 1 || echo "✓ npm package clean"`
Expected: `✓ npm package clean`

- [ ] **Step 3: Commit**

```bash
git add .npmignore
git commit -m "chore: exclude plugin files from npm publish"
```

---

### Task 6: 跑 `claude plugin validate ./` 与 `claude --plugin-dir ./` 本地验证

**Files:** （仅本地验证，无文件改动）

- [ ] **Step 1: 跑 plugin validate**

Run: `claude plugin validate ./`
Expected: 无 error；warning 可接受（unknown 字段警告等）。

如果命令不存在（旧版 claude），跳过这一步并在 PR 描述里注明。

- [ ] **Step 2: 跑 claude --plugin-dir 加载**

Run: `claude --plugin-dir ./`

进入 Claude Code 后输入 `/plugin`，确认列表里有 `tapd-server-cli`。

- [ ] **Step 3: 在加载状态下输入 `/mcp`**

Expected: 看到 `tapd ✓ Connected`（如果尚未在 userConfig 提交 PAT，可能显示 pending；提交后即可 connected）。

- [ ] **Step 4: 退出 Claude Code，无文件改动**

无 commit。验证结果写进 PR 描述（截图或文本）。

---

### Task 7: 新增 `scripts/sync-plugin-version.mjs`

**Files:**
- Create: `scripts/sync-plugin-version.mjs`

- [ ] **Step 1: 写脚本**

```javascript
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
```

- [ ] **Step 2: 跑一次确认幂等**

Run: `node scripts/sync-plugin-version.mjs`
Expected：
```
Syncing plugin version → 0.2.0
  = ./.claude-plugin/plugin.json (already 0.2.0)
  = ./.claude-plugin/marketplace.json (already 0.2.0)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-plugin-version.mjs
git commit -m "feat(release): add sync-plugin-version script"
```

---

### Task 8: 在 `package.json` 加 `version` 钩子

**Files:**
- Modify: `package.json`（在 `scripts` 节加 `version` 字段）

- [ ] **Step 1: 编辑 package.json**

在 `package.json` 的 `scripts` 对象中（在 `"release:dry"` 后面），新增一行：

```json
"version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json",
```

最终 `scripts` 节示例（保留现有所有字段）：

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "dev": "tsx watch src/index.ts",
  "start": "node dist/index.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "lint": "eslint \"src/**/*.ts\" \"test/**/*.ts\"",
  "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
  "typecheck": "tsc --noEmit",
  "release": "node scripts/publish.mjs",
  "release:dry": "node scripts/publish.mjs --dry-run",
  "version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json",
  "prepublishOnly": "npm run typecheck && npm run test && npm run build"
},
```

- [ ] **Step 2: 验证 npm 不会报错**

Run: `npm run version`
Expected: 输出 sync 脚本的同步消息，无 error。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(release): wire npm version hook to sync plugin manifests"
```

---

### Task 9: 修改 `.github/workflows/release.yml` — 加版本同步与 npm pack 校验

**Files:**
- Modify: `.github/workflows/release.yml`（在现有 release workflow 中补 version sync 校验，并把 npm pack 校验放到 build 之后、publish 之前）

- [ ] **Step 1: 编辑 release.yml（版本同步校验的位置）**

把现有第 22-30 行的 "Verify tag matches package.json version" 步骤之后（在 "Extract release notes" 之前）插入下面步骤：

```yaml
      - name: Verify plugin version sync
        run: |
          set -euo pipefail
          PKG=$(node -p "require('./package.json').version")
          PLG=$(node -p "require('./.claude-plugin/plugin.json').version")
          MKT=$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version")
          if [ "$PKG" != "$PLG" ] || [ "$PKG" != "$MKT" ]; then
            echo "::error::版本不同步：package.json=$PKG plugin.json=$PLG marketplace.json=$MKT"
            exit 1
          fi
          echo "✓ versions in sync at $PKG"
```

- [ ] **Step 1b: 编辑 release.yml（npm pack 校验的正确位置）**

把下面步骤插入到 `- run: npm run build` 与 `- name: npm publish (with provenance)` 之间：

```yaml
      - name: Verify npm package excludes plugin files
        run: |
          set -euo pipefail
          npm pack --dry-run 2>&1 | tee /tmp/pack.txt
          if grep -E "\.claude-plugin/|\.mcp\.json|^commands/|^skills/|^openspec/|^docs/" /tmp/pack.txt; then
            echo "::error::plugin 文件被打包进 npm 发布包，命中以下条目："
            grep -E "\.claude-plugin/|\.mcp\.json|^commands/|^skills/|^openspec/|^docs/" /tmp/pack.txt | sed 's/^/::error::  /'
            exit 1
          fi
          echo "✓ npm package clean"
```

> **位置说明**：`Verify npm package excludes plugin files` 必须在 `npm run build` 之后跑——否则 `dist/` 不存在，`files: ["dist", ...]` 白名单匹配 0 文件、tarball 自然不含 plugin 文件，校验沦为无意义恒过。把它放在 build 之后、publish 之前作为最后一道门禁。
>
> **错误信息增强**：失败时 echo 出 grep 命中的具体行（`sed 's/^/::error::  /'`），让 maintainer 直接在 GitHub Actions UI 看到哪些文件混入，无需重跑 `npm pack`。

- [ ] **Step 2: 验证 YAML 合法**

Run: `node -e "const y = require('js-yaml'); y.load(require('fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('yaml ok')"` （如未安装 js-yaml，跳过这一步）

或简单读一下文件确认格式正确：

Run: `head -50 .github/workflows/release.yml`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): verify plugin version sync and npm pack excludes"
```

---

### Task 10: 验证版本不同步会 fail

**Files:** （临时改动，最后 revert）

- [ ] **Step 1: 故意改 plugin.json.version 为不同值**

```bash
# 临时改 plugin.json 的 version 到 9.9.9
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('./.claude-plugin/plugin.json', 'utf8'));
p.version = '9.9.9';
fs.writeFileSync('./.claude-plugin/plugin.json', JSON.stringify(p, null, 2) + '\n');
"
```

- [ ] **Step 2: 本地模拟 CI 校验脚本**

Run:
```bash
PKG=$(node -p "require('./package.json').version")
PLG=$(node -p "require('./.claude-plugin/plugin.json').version")
MKT=$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version")
if [ "$PKG" != "$PLG" ] || [ "$PKG" != "$MKT" ]; then
  echo "FAIL（预期）：PKG=$PKG PLG=$PLG MKT=$MKT"
else
  echo "ERR: should have failed"
  exit 1
fi
```
Expected: `FAIL（预期）：PKG=0.2.0 PLG=9.9.9 MKT=0.2.0`

- [ ] **Step 3: revert 临时改动**

```bash
git checkout .claude-plugin/plugin.json
node -p "require('./.claude-plugin/plugin.json').version"
```
Expected: `0.2.0`

- [ ] **Step 4: 验证 sync 脚本能修复不一致**

```bash
# 再次故意改坏，跑 sync 修复，确认 sync 后两文���一致
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('./.claude-plugin/plugin.json','utf8')); p.version='9.9.9'; fs.writeFileSync('./.claude-plugin/plugin.json', JSON.stringify(p,null,2)+'\n');"
node scripts/sync-plugin-version.mjs
node -p "require('./.claude-plugin/plugin.json').version"
```
Expected: `0.2.0`（被 sync 脚本修复回来）

- [ ] **Step 5: 无 commit（仅验证）**

Run: `git status --short`
Expected: 无 modified 文件。

---

### Task 10b: 预格式化 plugin.json 让 sync 脚本字节稳定

**Files:**
- Modify: `.claude-plugin/plugin.json`（仅 `keywords` 字段格式调整）

**Context**: `scripts/sync-plugin-version.mjs` 用 `JSON.stringify(obj, null, 2)` 重写文件——它会把任何数组展开成多行。如果 `.claude-plugin/plugin.json` 的 `keywords` 是手写的 inline 数组，第一次跑 `npm version` 会产生 6 行无谓格式 diff（除了 version 字段）。这一 task 把 keywords 预先改成多行形态，让 sync 脚本输出与文件 byte-identical（version 已对齐时）。

- [ ] **Step 1: 改 keywords 字段格式**

把 `.claude-plugin/plugin.json` 里：

```json
"keywords": ["tapd", "mcp", "tencent", "agile", "issue-tracker"],
```

改为：

```json
"keywords": [
  "tapd",
  "mcp",
  "tencent",
  "agile",
  "issue-tracker"
],
```

- [ ] **Step 2: 验证 sync 脚本字节稳定**

```bash
cd "<repo>"
cp .claude-plugin/plugin.json /tmp/before-sync.json
node scripts/sync-plugin-version.mjs
diff /tmp/before-sync.json .claude-plugin/plugin.json && echo "✓ byte-stable"
rm -f /tmp/before-sync.json
```
Expected: `✓ byte-stable`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore(plugin): pre-format keywords to match sync script output"
```

---

### PR-1 完成标志

- [ ] 所有 task 1-10 的步骤打勾
- [ ] `git log --oneline` 显示 9 个新 commit（task 1-9 各一个；task 10 无 commit）
- [ ] `npm pack --dry-run` 输出不含 plugin 文件
- [ ] 推 PR-1，title: `feat(plugin): add Claude Code plugin packaging + version sync (B0)`

---

## PR-2: B1 双 CLI Probe + flow 集成 + 测试

### Task 11: 写 `test/unit/claude-cli.test.ts` 4 个失败用例

**Files:**
- Create: `test/unit/claude-cli.test.ts`

- [ ] **Step 1: 写测试**

```typescript
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
```

- [ ] **Step 2: 跑测试，确认全红**

Run: `npx vitest run test/unit/claude-cli.test.ts`
Expected: FAIL，提示找不到模块 `../../src/installer/claude-cli.js`。

- [ ] **Step 3: 不 commit（红测试随实现一起 commit）**

继续到 Task 12。

---

### Task 12: 实现 `src/installer/claude-cli.ts`

**Files:**
- Create: `src/installer/claude-cli.ts`

- [ ] **Step 1: 写实现**

```typescript
/**
 * B1: 优先调用 Claude Code 官方 CLI `claude mcp add-json` 注册 MCP server。
 *
 * 决策（来自 openspec/changes/add-claude-code-plugin/design.md D4）：
 *   - 检测 `claude --version` 可用 → 调 `claude mcp add-json tapd '<json>' --scope user`
 *   - 不可用或失败 → 返回 used='fallback'，让调用方走现行手写 ~/.claude.json 路径
 *   - 5 秒超时（spawnSync.timeout=5000，SIGTERM 终止）
 *   - PAT 走 args 数组不经 shell expansion，不进 shell history
 *   - stderr 必须脱敏：抛错时移除任何 TAPD_TOKEN 值
 */

import { spawnSync } from 'node:child_process';

export interface ClaudeCliProbe {
  /** 检查 `claude --version` 是否可执行（PATH 里有且能跑通） */
  isAvailable(): boolean;
  /** 调用 `claude mcp add-json <name> '<json>' --scope <scope>`，返回成功/失败 + stderr */
  addJson(
    name: string,
    json: string,
    scope: 'user' | 'local' | 'project',
  ): { ok: boolean; stderr: string };
}

const SPAWN_TIMEOUT_MS = 5000;

/** 默认实现：spawn 真实 `claude` 子进程 */
export function defaultClaudeCliProbe(): ClaudeCliProbe {
  return {
    isAvailable() {
      try {
        const r = spawnSync('claude', ['--version'], {
          stdio: 'ignore',
          timeout: SPAWN_TIMEOUT_MS,
          shell: false,
        });
        return r.status === 0;
      } catch {
        return false;
      }
    },
    addJson(name, json, scope) {
      try {
        const r = spawnSync(
          'claude',
          ['mcp', 'add-json', name, json, '--scope', scope],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: SPAWN_TIMEOUT_MS,
            encoding: 'utf8',
            shell: false,
          },
        );
        return {
          ok: r.status === 0,
          stderr: typeof r.stderr === 'string' ? r.stderr : '',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, stderr: msg };
      }
    },
  };
}

/** 从字符串里清掉所有 env 值（防 PAT 出现在 stderr） */
function redact(text: string, env: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(env)) {
    if (v && v.length >= 4) {
      out = out.split(v).join('***');
    }
  }
  return out;
}

/**
 * 高阶函数：尝试用 CLI 注册；CLI 不可用或失败时返回 fallback 让调用方走手写路径。
 *
 * @param tapdEnv  注入到 mcpServers.tapd.env 的环境变量（含 TAPD_TOKEN）
 * @param probe    注入式探针（默认走真实 claude CLI）
 * @returns        used='cli' 表示已通过 CLI 写入；used='fallback' 表示要走手写
 */
export async function preferClaudeCliInstall(
  tapdEnv: Record<string, string>,
  probe: ClaudeCliProbe = defaultClaudeCliProbe(),
): Promise<{ used: 'cli' | 'fallback'; stderr?: string }> {
  if (!probe.isAvailable()) {
    return { used: 'fallback' };
  }
  const json = JSON.stringify({
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tapd-server-cli'],
    env: tapdEnv,
  });
  let result: { ok: boolean; stderr: string };
  try {
    result = probe.addJson('tapd', json, 'user');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { used: 'fallback', stderr: redact(msg, tapdEnv) };
  }
  if (result.ok) {
    return { used: 'cli' };
  }
  return {
    used: 'fallback',
    stderr: redact(result.stderr, tapdEnv),
  };
}
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run test/unit/claude-cli.test.ts`
Expected: 4 个用例全 PASS。

- [ ] **Step 3: 跑 typecheck**

Run: `npm run typecheck`
Expected: 无 error。

- [ ] **Step 4: Commit（红测试 + 实现一起）**

```bash
git add test/unit/claude-cli.test.ts src/installer/claude-cli.ts
git commit -m "feat(installer): preferClaudeCliInstall via claude mcp add-json"
```

---

### Task 13: 跑测试至全绿

（包含在 Task 12 Step 2 中，本任务作占位确认。）

- [ ] **Step 1: 跑全量 vitest，确认现存测试不破坏**

Run: `npm test`
Expected: 全部 PASS（应该 28+ 测试，含原有 25 + 新增 4）。

- [ ] **Step 2: 不 commit（仅验证）**

---

### Task 14: 手动验证 happy path（可装 claude CLI 的环境）

**Files:** （仅本地验证）

- [ ] **Step 1: 检查 claude CLI 已安装**

Run: `claude --version`
Expected: 输出版本号。如果未安装，跳过 Task 14-15，在 PR 描述里注明。

- [ ] **Step 2: 准备一个临时 TAPD_TOKEN（可以用占位 `test-pat-12345`，反正不会真的连 TAPD）**

```bash
export TAPD_TOKEN=test-pat-12345
```

- [ ] **Step 3: 跑 install（**注意**：这一步会真改你的 `~/.claude.json`。测试前先备份）**

```bash
cp ~/.claude.json ~/.claude.json.bak.before-task14 2>/dev/null || true
TAPD_TOKEN=test-pat-12345 npx tapd-server-cli install claude-code
```

> **注意**：Task 14 依赖 Task 20 的 flow.ts 集成完成才能真正走 CLI 优先路径。如果按本计划顺序执行，先做 Task 11-19，最后做 Task 20，再回来跑 Task 14。**因此 Task 14-15 应该在 Task 20 之后执行。**

期望（Task 20 完成后）：输出包含 `通过 claude CLI 注册到 user scope`，`claude mcp list` 能看到 `tapd`。

- [ ] **Step 4: 跑 claude mcp list 验证**

Run: `claude mcp list`
Expected: 列表里有 `tapd: npx -y tapd-server-cli - (TAPD_TOKEN=*** TAPD_LOG_LEVEL=info)`。

- [ ] **Step 5: 清理**

```bash
claude mcp remove tapd
mv ~/.claude.json.bak.before-task14 ~/.claude.json 2>/dev/null || true
```

---

### Task 15: 手动验证 fallback path（claude CLI 不可用）

**Files:** （仅本地验证）

- [ ] **Step 1: 临时把 claude 从 PATH 移走**

```bash
# 找到 claude 可执行路径
which claude  # 或 where claude（Windows）

# 重命名（注意：这是临时操作，验证完一定要改回来）
sudo mv /path/to/claude /path/to/claude.bak  # macOS/Linux
# 或 Windows PowerShell:
# Move-Item "C:\path\to\claude.cmd" "C:\path\to\claude.cmd.bak"
```

- [ ] **Step 2: 跑 install，期望走 fallback 手写文件**

```bash
cp ~/.claude.json ~/.claude.json.bak.before-task15 2>/dev/null || true
TAPD_TOKEN=test-pat-12345 npx tapd-server-cli install claude-code
```
Expected: 输出包含 `(claude CLI 不可用，回退手写)` 或类似消息，并写入 `~/.claude.json` 顶层 `mcpServers.tapd`。

- [ ] **Step 3: 验证文件已写入**

Run: `node -p "require(require('os').homedir() + '/.claude.json').mcpServers.tapd"`
Expected: 打印出 `tapd` 配置对象。

- [ ] **Step 4: 恢复 claude 与配置**

```bash
sudo mv /path/to/claude.bak /path/to/claude
mv ~/.claude.json.bak.before-task15 ~/.claude.json 2>/dev/null || true
```

---

### Task 16: 写 `test/unit/codex-cli.test.ts` 4 个失败用例

**Files:**
- Create: `test/unit/codex-cli.test.ts`

- [ ] **Step 1: 写测试**

```typescript
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
```

- [ ] **Step 2: 跑测试，确认全红**

Run: `npx vitest run test/unit/codex-cli.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 不 commit（红测试随实现一起 commit）**

---

### Task 17: 实现 `src/installer/codex-cli.ts`

**Files:**
- Create: `src/installer/codex-cli.ts`

- [ ] **Step 1: 写实现**

```typescript
/**
 * B1: 优先调用 Codex 官方 CLI `codex mcp add` 注册 MCP server。
 *
 * 决策（来自 openspec/changes/add-claude-code-plugin/design.md D4）：
 *   - 检测 `codex --version` 可用 → 调 `codex mcp add tapd --env K=V ... -- npx -y tapd-server-cli`
 *   - 不可用或失败 → 返回 used='fallback'，让调用方走现行手写 ~/.codex/config.toml 路径
 *   - 5 秒超时
 *   - PAT 走 args 数组不进 shell history
 *   - stderr 脱敏
 */

import { spawnSync } from 'node:child_process';

export interface CodexCliProbe {
  /** 检查 `codex --version` 是否可执行 */
  isAvailable(): boolean;
  /** 等价于 `codex mcp add <name> --env K=V ... -- <command> [args...]` */
  addStdio(
    name: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ): { ok: boolean; stderr: string };
}

const SPAWN_TIMEOUT_MS = 5000;

export function defaultCodexCliProbe(): CodexCliProbe {
  return {
    isAvailable() {
      try {
        const r = spawnSync('codex', ['--version'], {
          stdio: 'ignore',
          timeout: SPAWN_TIMEOUT_MS,
          shell: false,
        });
        return r.status === 0;
      } catch {
        return false;
      }
    },
    addStdio(name, command, args, env) {
      // codex mcp add <name> --env K1=V1 --env K2=V2 ... -- <command> [args...]
      const cliArgs = ['mcp', 'add', name];
      for (const [k, v] of Object.entries(env)) {
        cliArgs.push('--env', `${k}=${v}`);
      }
      cliArgs.push('--', command, ...args);
      try {
        const r = spawnSync('codex', cliArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: SPAWN_TIMEOUT_MS,
          encoding: 'utf8',
          shell: false,
        });
        return {
          ok: r.status === 0,
          stderr: typeof r.stderr === 'string' ? r.stderr : '',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, stderr: msg };
      }
    },
  };
}

function redact(text: string, env: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(env)) {
    if (v && v.length >= 4) {
      out = out.split(v).join('***');
    }
  }
  return out;
}

export async function preferCodexCliInstall(
  tapdEnv: Record<string, string>,
  probe: CodexCliProbe = defaultCodexCliProbe(),
): Promise<{ used: 'cli' | 'fallback'; stderr?: string }> {
  if (!probe.isAvailable()) {
    return { used: 'fallback' };
  }
  const result = probe.addStdio('tapd', 'npx', ['-y', 'tapd-server-cli'], tapdEnv);
  if (result.ok) {
    return { used: 'cli' };
  }
  return {
    used: 'fallback',
    stderr: redact(result.stderr, tapdEnv),
  };
}
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run test/unit/codex-cli.test.ts`
Expected: 4 个用例全 PASS。

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 无 error。

- [ ] **Step 4: Commit**

```bash
git add test/unit/codex-cli.test.ts src/installer/codex-cli.ts
git commit -m "feat(installer): preferCodexCliInstall via codex mcp add"
```

---

### Task 18: 跑测试至全绿（codex-cli）

（包含在 Task 17 Step 2 中。）

- [ ] **Step 1: 跑全量 vitest**

Run: `npm test`
Expected: 全部 PASS（应该 32+ 测试，含原有 25 + claude-cli 4 + codex-cli 4）。

---

### Task 19: 手动验证 codex 端（在 Task 20 之后做）

**Files:** （仅本地验证）

> Task 19 与 Task 14-15 一样，依赖 Task 20 的 flow 集成。**实际执行顺序：先 Task 20，再回来做 Task 14-15-19。**

- [ ] **Step 1: 检查 codex CLI 已安装**

Run: `codex --version`
Expected: 输出版本号。如果没装跳过 Task 19。

- [ ] **Step 2: 备份 ~/.codex/config.toml，跑 install**

```bash
cp ~/.codex/config.toml ~/.codex/config.toml.bak.before-task19 2>/dev/null || true
TAPD_TOKEN=test-pat-12345 npx tapd-server-cli install codex
```
Expected: 输出包含 `通过 codex CLI 注册` 类似消息。

- [ ] **Step 3: 验证 ~/.codex/config.toml 含 tapd 节**

Run: `grep -A 5 "mcp_servers.tapd" ~/.codex/config.toml`
Expected: 看到 `command`、`args`、`env` 字段。

- [ ] **Step 4: 清理**

```bash
codex mcp remove tapd 2>/dev/null || true
mv ~/.codex/config.toml.bak.before-task19 ~/.codex/config.toml 2>/dev/null || true
```

---

### Task 20: 修改 `src/installer/flow.ts` — 在 claude-code/codex 分支前置 CLI 优先逻辑

**Files:**
- Modify: `src/installer/flow.ts`（在第 130 行 `for (const key of opts.clients)` 循环里，进入 `try` 块之前先走 CLI probe）

- [ ] **Step 1: 读现有 flow.ts**

确保已读过 `src/installer/flow.ts`（如未读，先读完整文件）。

- [ ] **Step 2: 在文件顶部加 import**

在现有 import 之后（约第 10-14 行附近），新增两行：

```typescript
import { preferClaudeCliInstall } from './claude-cli.js';
import { preferCodexCliInstall } from './codex-cli.js';
```

- [ ] **Step 3: 在 for 循环里前置 CLI 优先逻辑**

定位 `try {` 块的开始（约第 143 行）。在其**之前**（即 `if (!adapter)` 块之后、`try` 之前）插入 CLI 优先分支：

```typescript
    // B1：claude-code / codex 优先调官方 CLI；不可用或失败再走手写文件 fallback。
    if (!opts.dryRun && (key === 'claude-code' || key === 'codex')) {
      const cliResult =
        key === 'claude-code'
          ? await preferClaudeCliInstall(tapdEnv)
          : await preferCodexCliInstall(tapdEnv);
      if (cliResult.used === 'cli') {
        const via =
          key === 'claude-code'
            ? '<via claude mcp add-json --scope user>'
            : '<via codex mcp add>';
        stdout.write(`已通过官方 CLI 注册 ${adapter.displayName}：${via}\n`);
        results.push({
          client: key,
          outcome: 'wrote',
          path: via,
        });
        continue;
      }
      if (cliResult.stderr) {
        stdout.write(`(${adapter.displayName} CLI 不可用或失败：${cliResult.stderr.trim()})\n`);
      }
      // 走 fallback：继续往下到现行手写文件路径
    }
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: 无 error。

- [ ] **Step 5: 跑 installer-flow 既有测试，确认未破坏**

Run: `npx vitest run test/unit/installer-flow.test.ts`
Expected: 全部 PASS（既有用例都不走 claude-code/codex CLI 分支，因为它们用 fakeStdio 不会真 spawn）。

> 等等——如果既有测试默认调真实 `defaultClaudeCliProbe`，会真去 spawn claude，可能在 CI 里乱写 `~/.claude.json`！这是个隐患。**Task 21 会通过 mock probe 规避**。但本步先确认现状测试不爆。如果在没装 claude 的 CI 上跑，`isAvailable()` 返 false，自动走 fallback——和原行为等价。如果本地装了 claude，**测试会真调 claude**，污染本地配置。

为防万一，在本步骤先**临时**确认现有测试不会乱调 CLI——读一下 installer-flow.test.ts 的 dry-run 用例（应该都用 `dryRun: true` 或 `tokenOverride: 'x'`）。

Run: `grep -n "claude-code\|codex" test/unit/installer-flow.test.ts | head -20`

观察现有测试是否传 `dryRun: true`：
- 如果是 `dryRun: true`，CLI 优先分支被跳过（看 Step 3 的 `if (!opts.dryRun && ...)`），安全。
- 如果是 `dryRun: false` 且 client 是 claude-code/codex，需要在 Task 21 加 mock probe。

- [ ] **Step 6: Commit**

```bash
git add src/installer/flow.ts
git commit -m "feat(installer): prefer official CLI for claude-code/codex install"
```

---

### Task 21: 增量写 2 个 installer-flow 集成用例

**Files:**
- Modify: `test/unit/installer-flow.test.ts`（在文件末尾新增两个 describe 块）

- [ ] **Step 1: 读现有 installer-flow.test.ts，理解 fakeStdio 与 mock 模式**

Run: `head -80 test/unit/installer-flow.test.ts`

观察：现有用例用 `vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath)` mock adapter 路径。

- [ ] **Step 2: 在文件末尾追加新 describe 块**

```typescript
describe('runInstall — claude-code prefers claude CLI', () => {
  it('skips adapter.write when claude CLI succeeds', async () => {
    // 用 vi.doMock 注入 mock probe
    vi.resetModules();
    const writeSpy = vi.spyOn(claudeCodeAdapter, 'write').mockResolvedValue();
    vi.doMock('../../src/installer/claude-cli.js', () => ({
      preferClaudeCliInstall: async () => ({ used: 'cli' }),
    }));
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');

    const { stdout, stderr, out } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['claude-code'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('wrote');
    expect(writeSpy).not.toHaveBeenCalled();
    expect(out.join('')).toContain('via claude mcp add-json');

    vi.doUnmock('../../src/installer/claude-cli.js');
    writeSpy.mockRestore();
  });

  it('falls back to adapter.write when claude CLI is unavailable', async () => {
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), 'tapd-fallback-'));
    const fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);

    vi.doMock('../../src/installer/claude-cli.js', () => ({
      preferClaudeCliInstall: async () => ({ used: 'fallback' }),
    }));
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');

    const { stdout, stderr } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['claude-code'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('wrote');
    expect(result.results[0]?.path).toBe(fakePath);
    // 文件被实际写入
    await expect(fs.access(fakePath)).resolves.toBeUndefined();

    vi.doUnmock('../../src/installer/claude-cli.js');
  });
});
```

- [ ] **Step 3: 跑这两个用例**

Run: `npx vitest run test/unit/installer-flow.test.ts -t "prefers claude CLI"`
Expected: 2 个 PASS。

- [ ] **Step 4: 跑全量 vitest，确认未破坏**

Run: `npm test`
Expected: 全部 PASS（34+ 测试）。

- [ ] **Step 5: Commit**

```bash
git add test/unit/installer-flow.test.ts
git commit -m "test(installer): cover claude CLI prefer/fallback in flow"
```

---

### Task 22: 跑全部 npm test，确认现行测试不破坏

（包含在 Task 21 Step 4 中，本任务作占位确认。）

- [ ] **Step 1: 跑 npm test**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 2: 跑 typecheck**

Run: `npm run typecheck`
Expected: 无 error。

- [ ] **Step 3: 不 commit**

---

### Task 23: 写 `test/unit/plugin-manifest.test.ts`

**Files:**
- Create: `test/unit/plugin-manifest.test.ts`

- [ ] **Step 1: 写测试**

```typescript
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
    expect(tapd?.args).toEqual(['-y', 'tapd-server-cli']);
    expect(tapd?.env?.TAPD_TOKEN).toBe('${user_config.tapd_token}');
    expect(tapd?.env?.TAPD_LOG_LEVEL).toBe('info');
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run test/unit/plugin-manifest.test.ts`
Expected: 3 个用例全 PASS（因为 PR-1 已经创建好了所有 manifest 文件）。

- [ ] **Step 3: Commit**

```bash
git add test/unit/plugin-manifest.test.ts
git commit -m "test(plugin): static checks for plugin/marketplace/mcp manifests"
```

---

### Task 24: 跑全量测试至全绿（plugin-manifest）

- [ ] **Step 1: 跑 npm test**

Run: `npm test`
Expected: 全部 PASS（37+ 测试）。

- [ ] **Step 2: 不 commit**

---

### PR-2 完成标志

- [ ] Task 11-13, 16-18, 20-24 全打勾（Task 14-15, 19 是手动验证，可在 PR-3 smoke 一起做）
- [ ] `git log --oneline` 显示 5 个新 commit
- [ ] `npm test` 全绿
- [ ] 推 PR-2，title: `feat(installer): prefer official CLI for claude-code/codex (B1)`

---

## PR-3: B3 README 重排 + 端到端 smoke + 发版

### Task 25: README 顶部新增「在 Claude Code 中安装（推荐）」节

**Files:**
- Modify: `README.md`（在 "## 获取 TAPD 个人访问令牌" 之后、"## 快速开始（推荐：一键安装）" 之前插入新节）

- [ ] **Step 1: 读现有 README 第 30-50 行**

Run: `head -50 README.md`

定位现有「## 快速开始（推荐：一键安装）」标题（约第 33 行）。

- [ ] **Step 2: 在「获取 TAPD 个人访问令牌」节之后、「快速开始」之前插入新节**

```markdown
## 在 Claude Code 中安装（推荐）

最简单的安装方式——**完全在 Claude Code 内完成**，不需要终端：

```text
> /plugin marketplace add wanggan768q/tapd-server-cli
> /plugin install tapd-server-cli@tapd-server-cli
```

弹窗会要求你输入「TAPD 个人访问令牌」（PAT），一次性输入即可：

- PAT 走系统 keychain（macOS/Windows 钥匙串、Linux 走 `~/.claude/.credentials.json`），**不会落普通配置文件**
- Plugin 启用后 MCP server 自动通过 `npx -y tapd-server-cli` 拉起，env 注入 PAT
- `/mcp` 应该立即显示 `tapd ✓ Connected`

> **注意 — 配置文件位置**：Claude Code 的 MCP 配置存在 `~/.claude.json`（家目录顶层），不是 `~/.claude/settings.json`（settings 文件不放 MCP）。如果你之前在 `settings.json` 里找过 `tapd` 配置没找到，是找错文件了——plugin 路径完全屏蔽这个困惑。

### 首次使用附件下载

附件下载需要浏览器 cookie（PAT 不够，TAPD 限制）。在 Claude Code 会话里输入：

```text
> /tapd-server-cli:login
```

会弹出隔离浏览器窗口，登录 TAPD 后 cookie 自动持久化，附件下载工具立即可用。

### 卸载

```text
> /plugin uninstall tapd-server-cli
```

如果想完全清理本地凭据（cookie / token 文件）：

```bash
npx -y tapd-server-cli uninstall claude-code --purge
```

### 升级（已通过 `npx install claude-code` 装过）

如果你之前用 `npx tapd-server-cli install claude-code` 装过，要切换到 plugin：

1. **先卸载老的 user-scope 配置**：`npx tapd-server-cli uninstall claude-code`（清掉 `~/.claude.json` 顶层 `mcpServers.tapd`）
2. 在 Claude Code 内 `/plugin marketplace add wanggan768q/tapd-server-cli`
3. `/plugin install tapd-server-cli@tapd-server-cli`，弹窗输入 PAT
4. 重启 Claude Code

> 按 Claude Code 官方优先级（local > project > **user > plugin** > claude.ai），如果不先卸载 user scope 那条 `tapd` 配置，会**屏蔽** plugin 提供的同名 server。
```

- [ ] **Step 3: 验证 markdown 格式正确**

Run: `head -100 README.md`

确认新节插入正确，markdown 代码块（` ```text `、` ```bash `）配对。

- [ ] **Step 4: 不 commit（与 Task 26-30 一起 commit）**

---

### Task 26: 把现行「快速开始」节降级为「在其它客户端中安装」

**Files:**
- Modify: `README.md`（修改现有「## 快速开始（推荐：一键安装）」标题）

- [ ] **Step 1: 找到现有标题**

Run: `grep -n "^## 快速开始" README.md`

应该输出第 33 行：`## 快速开始（推荐：一键安装）`

- [ ] **Step 2: 改标题与开头说明**

把「## 快速开始（推荐：一键安装）」替换为：

```markdown
## 在其它客户端中安装（npx install）

适用于 Codex / OpenCode / Cursor，以及在终端里批量装 / CI 场景。

> 如果你用 **Claude Code**，请优先看上面的「在 Claude Code 中安装（推荐）」节——plugin 路径更简单、PAT 直接进 keychain。

> Claude Code / Codex 这两家客户端，本工具会**优先调官方 CLI**（`claude mcp add-json --scope user` / `codex mcp add`）写入配置；CLI 不可用时回退到手写配置文件，行为与旧版兼容。

最省事的形态——在 TTY 终端跑零参，按空格挑想装的客户端：
```

把原来的「最省事的形态」一行替换掉（保留下面的 `npx -y tapd-server-cli install` 命令块不变）。

- [ ] **Step 3: 不 commit**

---

### Task 27: 在「高级：手动配置 MCP 客户端」节加红字澄清

**Files:**
- Modify: `README.md`（在「高级：手动配置 MCP 客户端」节附近）

- [ ] **Step 1: 找到 Claude Code 配置文件路径说明**

Run: `grep -n "Claude Code:.*\.claude\.json" README.md`

应该输出原第 186 行附近：`- Claude Code: \`~/.claude.json\`（顶层 \`mcpServers.tapd\`）`

- [ ] **Step 2: 替换该行，加红字**

把原行：

```markdown
- Claude Code: `~/.claude.json`（顶层 `mcpServers.tapd`）
```

替换为：

```markdown
- Claude Code: `~/.claude.json`（家目录顶层 `mcpServers.tapd`）
  > ⚠️ **不是** `~/.claude/settings.json`！`settings.json` 是 permissions / hooks / env / UI 行为的设置文件，**不放** MCP server 配置。如果你打开 `settings.json` 找不到 `tapd`，是找错文件了。
```

- [ ] **Step 3: 不 commit**

---

### Task 28: 故障排查表新增两行

**Files:**
- Modify: `README.md`（在故障排查表里新增 2 行）

- [ ] **Step 1: 找到故障排查表**

Run: `grep -n "现象.*含义.*处理" README.md`

定位现有故障排查表（约第 329 行附近）。

- [ ] **Step 2: 在表格末尾（在 `tapd.login` 相关行之后、`## 开发` 之前）追加两行**

```markdown
| `/mcp` 看不到 `tapd`（Claude Code） | 配置文件位置错或 Claude Code 未重启 | 检查 `~/.claude.json`（**不是** `~/.claude/settings.json`）；完全退出 Claude Code 进程后重启；或在新会话跑 `claude mcp list` 确认 |
| 已通过 `npx install claude-code` 装过、又装 plugin 但 `/mcp` 仍只看到一份 `tapd` | 按 Claude Code 优先级，user scope 屏蔽 plugin | 先 `npx tapd-server-cli uninstall claude-code` 清掉 `~/.claude.json` 顶层 `mcpServers.tapd`，再用 plugin |
```

- [ ] **Step 3: 不 commit**

---

### Task 29: 卸载节同步 plugin 路径

**Files:**
- Modify: `README.md`（「## 卸载」节）

- [ ] **Step 1: 找到「## 卸载」节**

Run: `grep -n "^## 卸载" README.md`

- [ ] **Step 2: 在卸载节开头加 plugin 卸载路径**

把原「## 卸载」节开头：

```markdown
## 卸载

与安装对称的撤销入口。零参 TTY 弹 checkbox 多选；显式列出客户端走非交互流程；`--dry-run` 只预览；`--purge` 额外清理本地凭据文件。**不需要输入 PAT**（卸载不读 token）。
```

替换为：

```markdown
## 卸载

### Claude Code 用户（plugin 路径）

```text
> /plugin uninstall tapd-server-cli
```

如需同时清理本地 cookie / token 文件：

```bash
npx -y tapd-server-cli uninstall claude-code --purge
```

### 其它客户端（npx install 路径）

与安装对称的撤销入口。零参 TTY 弹 checkbox 多选；显式列出客户端走非交互流程；`--dry-run` 只预览；`--purge` 额外清理本地凭据文件。**不需要输入 PAT**（卸载不读 token）。
```

- [ ] **Step 3: 不 commit**

---

### Task 30: 「Slash 命令」节加 plugin 提供的命令

**Files:**
- Modify: `README.md`（找到 "## Slash 命令" 节）

- [ ] **Step 1: 找到 Slash 命令节**

Run: `grep -n "^## Slash 命令" README.md`

- [ ] **Step 2: 在节内的命令列表开头加 plugin 命令**

如果原节内是：

```markdown
- **Claude Code**：`/mcp__tapd__setup`
- **Cursor**：`/tapd:setup`
- **其它 MCP 客户端**：在客户端的 prompts 列表里找名为 `setup` 的条目
```

改为：

```markdown
- **Claude Code（plugin 路径，推荐）**：
  - `/tapd-server-cli:login` — 登录 TAPD（启用附件下载）
  - `/tapd-server-cli:logout` — 登出 TAPD
  - `/mcp__tapd__setup` — 首次设置向导（含 PAT 验证 + cookie 状态诊断）
- **Cursor**：`/tapd:setup`
- **其它 MCP 客户端**：在客户端的 prompts 列表里找名为 `setup` 的条目
```

- [ ] **Step 3: 跑 markdown 链接 / 格式 lint（如有）**

Run: `head -300 README.md | tail -100`

肉眼检查格式无明显错位。

- [ ] **Step 4: Commit Task 25-30 一起**

```bash
git add README.md
git commit -m "docs: promote plugin install path; clarify ~/.claude.json vs settings.json"
```

---

### Task 31: 端到端 smoke — 干净环境装 plugin

**Files:** （仅手动验证）

- [ ] **Step 1: 准备干净环境**

```bash
# 备份现有 ~/.claude.json
cp ~/.claude.json ~/.claude.json.bak.smoke 2>/dev/null || true

# 确认 ~/.claude.json 顶层没有 mcpServers.tapd（如有，先 uninstall）
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.claude.json';
if (fs.existsSync(p)) {
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (c.mcpServers?.tapd) {
    console.log('warning: ~/.claude.json 顶层有 mcpServers.tapd，先跑 npx tapd-server-cli uninstall claude-code');
    process.exit(1);
  }
}
console.log('clean state ok');
"
```

- [ ] **Step 2: 用 `claude --plugin-dir` 加载本仓库**

```bash
cd /path/to/tapd-server-cli
claude --plugin-dir ./
```

- [ ] **Step 3: 在 Claude Code 内确认 plugin 加载**

输入 `/plugin`，看列表里有 `tapd-server-cli`。

输入 `/plugin install tapd-server-cli@tapd-server-cli`，弹窗输入 PAT（用真实 PAT 或测试 PAT，看后续是否真连 TAPD）。

- [ ] **Step 4: 验证 /mcp**

输入 `/mcp`。
Expected: `tapd ✓ Connected`。

如果只显示 pending，等几秒（npx 首次拉包）。

- [ ] **Step 5: 写到 PR 描述里**

记录 `/mcp` 截图或文本输出到 PR description。

---

### Task 32: 端到端 smoke — 调 MCP 工具

**Files:** （仅手动验证）

- [ ] **Step 1: 在 Claude Code 内调 tapd.whoami**

输入：`请调用 tapd.whoami 看我是谁`

Expected: 返回 `user_id` / `user_name`（脱敏）。

- [ ] **Step 2: 调 tapd.list_workspaces**

输入：`列出我能访问的 TAPD workspace`

Expected: 返回 workspace 列表。

- [ ] **Step 3: 写到 PR 描述**

---

### Task 33: 端到端 smoke — /tapd-server-cli:login

**Files:** （仅手动验证）

- [ ] **Step 1: 在 Claude Code 内输入 /tapd-server-cli:login**

输入：`/tapd-server-cli:login`

Expected: Claude 调用 `tapd.login` 工具，弹出隔离浏览器窗口。

- [ ] **Step 2: 在浏览器完成 TAPD 登录**

登录成功后浏览器自动关闭，server 抓到 cookie。

- [ ] **Step 3: 验证 tapd.attachments.download 工具已注册**

输入：`列出可用的 MCP 工具`

Expected: 工具列表里出现 `tapd.attachments.download`。

- [ ] **Step 4: 写到 PR 描述**

---

### Task 34: 端到端 smoke — uninstall plugin

**Files:** （仅手动验证）

- [ ] **Step 1: 输入 /plugin uninstall tapd-server-cli**

Expected: plugin 被移除。

- [ ] **Step 2: 验证 /mcp 不再有 tapd**

输入 `/mcp`。
Expected: 列表里不再有 `tapd`。

- [ ] **Step 3: 退出 Claude Code，恢复备份**

```bash
mv ~/.claude.json.bak.smoke ~/.claude.json 2>/dev/null || true
```

- [ ] **Step 4: 写到 PR 描述**

---

### Task 35: npm version patch 触发版本同步钩子

**Files:** （npm 命令自动处理 git）

> **注意**：这一步会真正修改版本号、create commit + tag。**只在 PR-1 + PR-2 + PR-3 都已合并到 main 之后做**。

- [ ] **Step 1: 切到 main 分支并拉最新**

```bash
git checkout main
git pull origin main
```

- [ ] **Step 2: 跑 npm version patch**

```bash
npm version patch
```

Expected：
- `package.json.version` 从 `0.2.0` 变 `0.2.1`
- `scripts/sync-plugin-version.mjs` 被自动调用，更新 `plugin.json` / `marketplace.json`
- 自动 `git add` 并 commit `v0.2.1`
- 自动打 tag `v0.2.1`

- [ ] **Step 3: 验���三处 version 一致**

```bash
node -p "
const p = require('./package.json').version;
const pl = require('./.claude-plugin/plugin.json').version;
const m = require('./.claude-plugin/marketplace.json').plugins[0].version;
[p, pl, m]
"
```
Expected: `[ '0.2.1', '0.2.1', '0.2.1' ]`

---

### Task 36: 推 tag 触发 release CI

- [ ] **Step 1: push 主分支与 tag**

```bash
git push --follow-tags
```

- [ ] **Step 2: 等 CI 跑完**

打开 GitHub Actions 页面，等 `release` workflow 跑完。

Expected: 所有步骤绿，含新增的：
- `Verify plugin version sync` ✓
- `Verify npm package excludes plugin files` ✓
- `npm publish (with provenance)` ✓
- `Create GitHub Release` ✓

- [ ] **Step 3: 写到 PR 描述（CI 截图）**

---

### Task 37: 验证 npm 发布产物干净

**Files:** （仅本地验证）

- [ ] **Step 1: 在新临时目录拉发布的 npm 包**

```bash
mkdir -p /tmp/verify-publish
cd /tmp/verify-publish
npm pack tapd-server-cli@latest
```

- [ ] **Step 2: 解压看内容**

```bash
tar -tzf tapd-server-cli-*.tgz | grep -E "\.claude-plugin|\.mcp\.json|^package/commands/"
```
Expected: **空输出**（plugin 文件未被打包）。

```bash
tar -tzf tapd-server-cli-*.tgz | head -20
```
Expected: 仅含 `package/dist/`、`package/README.md`、`package/LICENSE`、`package/package.json`。

- [ ] **Step 3: 写到 PR 描述**

---

### Task 38: 异机/异目录验证 marketplace add

**Files:** （仅手动验证）

- [ ] **Step 1: 在另一台机器或不同目录跑 marketplace add**

```bash
cd /tmp  # 任何不是 tapd-server-cli 仓库根的目录
claude
```

进入 Claude Code，输入：

```text
> /plugin marketplace add wanggan768q/tapd-server-cli
> /plugin install tapd-server-cli@tapd-server-cli
```

Expected: Claude Code 从 GitHub 拉取仓库，识别 `marketplace.json` 与 `plugin.json`，弹窗收 PAT。

- [ ] **Step 2: 验证 /mcp**

输入 `/mcp`。
Expected: `tapd ✓ Connected`。

- [ ] **Step 3: 调 tapd.whoami 验证**

Expected: 返回 PAT 身份。

- [ ] **Step 4: 写到 PR 描述（最终验证截图）**

---

### PR-3 完成标志

- [ ] Task 25-38 全打勾
- [ ] `git log --oneline` 显示 1 个 README commit + 1 个版本 commit + 1 个 tag
- [ ] GitHub Actions release workflow 绿
- [ ] npm 包发布成功（`npm view tapd-server-cli@latest version` 返回新版号）
- [ ] 异机 `/plugin marketplace add` 验证通过

---

## Self-Review 结果

### Spec coverage check（对照 specs/claude-code-plugin/spec.md 的 6 个 Requirement）

| Requirement | 实施任务 |
|---|---|
| 仓库提供 Claude Code plugin manifest | Task 1, 10b, 23（静态校验） |
| 仓库提供 marketplace manifest 让自身被发现 | Task 2, 23, 38（异机验证） |
| bundled MCP server 通过 npx 拉起，PAT 走 user_config 占位符注入 | Task 3, 23, 31-32（smoke） |
| plugin 提供 slash 命令包装 | Task 4, 33（smoke） |
| plugin 文件不进入 npm publish | Task 5, 9, 37（异机验证） |
| 与现行 npx install 路径并存且明确优先级 | Task 25-29（README 改动） |

### Spec coverage check（对照 specs/installer-cli/spec.md 的 2 个新 Requirement）

| Requirement | 实施任务 |
|---|---|
| claude-code 与 codex 安装路径优先调官方 CLI | Task 11-22（双 CLI + flow 集成 + 测试） |
| install 提示文案明确区分 ~/.claude.json 与 ~/.claude/settings.json | Task 27, 28（README 红字 + 故障排查） |

### Placeholder scan

无 TBD/TODO/FIXME；无"appropriate error handling"等模糊措辞；所有代码步骤都给出完整代码或精确文件路径行号。

### Type consistency

- `ClaudeCliProbe.addJson(name, json, scope)` 在 Task 11/12/21 三处签名一致 ✓
- `CodexCliProbe.addStdio(name, command, args, env)` 在 Task 16/17 一致 ✓
- `preferClaudeCliInstall` 与 `preferCodexCliInstall` 返回 `{ used: 'cli' | 'fallback', stderr? }` 在所有调用点一致 ✓
- Plugin name `tapd-server-cli`、MCP server key `tapd` 全计划保持解耦一致 ✓

### Plan vs. Implementation Reconciliation

- Deviation 1（Task 9 / PR-1 review）：`Verify npm package excludes plugin files` 没按原计划字面位置放在 `Verify plugin version sync` 后，而是修正为放到 `npm run build` 之后、`npm publish` 之前；同时失败时会把 grep 命中的具体行用 `sed 's/^/::error::  /'` 回显到 GitHub Actions UI。此计划已按实际实现更新。
- Deviation 2（Task 10 verification + follow-up commit `d0bccf1`）：新增 Task 10b，记录 `.claude-plugin/plugin.json` 的 `keywords` 预格式化为多行数组，以匹配 `scripts/sync-plugin-version.mjs` 的 `JSON.stringify(obj, null, 2)` 输出，避免 `npm version` 产生无谓格式 diff。
- **Deviation 3**: Plan's Task 12 literal implementation code block originally had `preferClaudeCliInstall` calling `probe.addJson()` directly without top-level try/catch. Plan's Task 11 test case 4 (probe throws → fallback + redacted stderr) required catching that throw. The two literal code blocks contradicted each other. Implementer correctly added top-level try/catch in `preferClaudeCliInstall` (and applied the same pattern proactively to codex-cli.ts). Plan Task 12 code block has now been updated to reflect the actual implementation.

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-05-28-tapd-claude-code-plugin.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 每个 task 派 fresh subagent，task 间复审，快迭代。适合本计划的 38 个 task，因为 task 之间有清晰边界、可验证。

**2. Inline Execution** — 在当前会话执行 tasks，使用 executing-plans 批处理 + checkpoint。适合更紧凑、希望全程可见的场景。

Which approach?
