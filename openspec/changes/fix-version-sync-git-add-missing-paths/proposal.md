## Why

v0.2.1 发版后，npm 上 `tapd-server-cli@0.2.1` 的 tarball 实测 `dist/runtime/version.js` 仍是 `VERSION = '0.2.0'`——比 npm 包元数据落后一个 patch。`tapd.update` MCP 工具就此误报 `current=0.2.0 / latest=0.2.1`，让 plugin 用户以为没装上新版（`current` 来自编译时内联的 `src/runtime/version.ts.VERSION`，是 PR #12 的设计契约）。

根因：`scripts/sync-plugin-version.mjs` 同步 4 个文件——`.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` / `.mcp.json` / `src/runtime/version.ts`——但 `package.json.scripts.version` 钩子只 `git add` 了前 2 个：

```
"version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json"
```

`npm version <bump>` 流程：bump package.json → 跑 `version` 钩子 → 自动 commit + tag。脚本写好的 `version.ts` / `.mcp.json` 因为没被 `git add`，**没进 npm version 的自动 commit**——HEAD 上这两个文件永远停在前一版本。

CI 从 tag commit 拉代码 build dist，于是 `dist/runtime/version.js` 也跟着停在前一版本。`.mcp.json` 这次没出问题纯粹因为 v0.2.1 的 minor 范围 `~0.2.0` 没变（args[1] 字面字符串无 diff）；下次跨 minor 时同样会漂移。

发现路径：onboarding 流程切回 main 分支时 `git status` 显示 `M src/runtime/version.ts`——sync 脚本在某次本地操作中 reapply 后留下脏状态，对比 HEAD 暴露了 0.2.0 → 0.2.1 的 unstaged diff。

## What Changes

- 修 `package.json.scripts.version` 钩子的 `git add` 列表，补全 sync 脚本写的全部 4 个文件（`src/runtime/version.ts` + `.mcp.json`）。
- 加测试守卫：`test/unit/plugin-manifest.test.ts` 现有"三处 version 同步"用例扩到 4 处（`src/runtime/version.ts.VERSION === package.json.version`），防止将来漂移。
- 顺手在脚本头部 JSDoc 写明"4 个文件"明示契约（注释已有"唯一真相来源"，但没罗列具体路径）。
- 发 v0.2.2 hotfix 把 npm 上的 dist 真带 `VERSION = '0.2.1'` 实际值（v0.2.2 时机正好——bump 走一次修好的钩子，自然把 version.ts 一起 commit）。CHANGELOG `[0.2.2]` 段记录此 bug + fix。
- `.mcp.json` 钩子修复无副作用：v0.2.1 → v0.2.2 仍在 `~0.2.0` minor 范围内，args[1] 字面无变化，`git add .mcp.json` 视为 no-op；但下次跨 minor 时此守卫真生效。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities

- `claude-code-plugin`: 新增 spec scenario "npm version 钩子同步 4 处 version 字段"——既有 spec 含三处 version 一致性 Requirement，本次扩到 4 处并显式断言 hook 会 `git add` 全部 sync 脚本写过的文件。
- `installer-cli`: 不变（本 hotfix 不动 install 流程）。

## Impact

**代码**

- `package.json`: `scripts.version` 一行改动——`git add` 列表从 2 个文件扩到 4 个。
- `scripts/sync-plugin-version.mjs`: 顶部 JSDoc 补"4 个被同步的文件"清单（仅注释，无行为变化）。
- `test/unit/plugin-manifest.test.ts`: 现有 `version sync` 用例从断言 3 处扩到 4 处。
- `openspec/changes/add-claude-code-plugin/specs/claude-code-plugin/spec.md`: ADD 一条 scenario 在"plugin.json.version 与 package.json.version 一致" Requirement 下方，覆盖 `version.ts.VERSION` 同步契约。

**发版**

- v0.2.2 hotfix（patch bump）。`.mcp.json` 锁的 `~0.2.0` 范围接受 0.2.2，plugin 用户下次启用 plugin 时 npx 自动拉到修好的版本。
- CHANGELOG `[0.2.2]` 段记录："Fixed: npm version 钩子漏同步 src/runtime/version.ts 与 .mcp.json，导致 dist 内 VERSION 落后元数据一个 patch；tapd.update 工具误报 current 落后于 latest。"

**API**

- `tapd.update` 工具 `current` 字段语义不变；本次修复让该字段在 v0.2.2 起真实反映已安装版本。
- 0.2.1 的现存 plugin 用户**仍会**报 `current=0.2.0`——这是发布瞬间凝固的 dist。除非升级到 0.2.2，否则误报继续。CHANGELOG / `tapd.update` slash 命令文档应提示这一点。

**不影响**

- `npx install claude-code/codex` 路径、`tapd.login` / `tapd.logout` / `tapd.attachments.*` 等运行时工具、release.yml CI 校验逻辑（CI 三处 version 一致性校验仍能跑过——sync 脚本输出与本次 hook fix 是互补关系）。
