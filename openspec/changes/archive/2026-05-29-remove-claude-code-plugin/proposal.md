## Why

v0.2.0 → v0.2.2 三个 patch 引入了 Claude Code plugin 体系（`.claude-plugin/plugin.json` + `marketplace.json` + `.mcp.json` + `tapd.update` 工具 + version 多处同步基建），承诺让用户在 Claude Code 内通过 `/plugin marketplace add wanggan768q/tapd-server-cli` + `/plugin install` 一行装好。

实际跑下来这条路径**没真正通**：

- **网络层**：Claude Code 默认走 SSH 22 克隆 GitHub repo，国内网络环境下 GFW 直接断流（实测 SSH 22 `Software caused connection abort`）。HTTPS URL 形式可绕但用户不知道、且需要查文档
- **维护层**：plugin 体系拖了一系列的"半个工程"——4 处 version 同步（plugin.json / marketplace.json / .mcp.json / src/runtime/version.ts），同步靠 `scripts/sync-plugin-version.mjs`；同步靠 `npm version` 钩子的 `git add` 列表；钩子漏 add 直接产生 v0.2.1 的发版 bug（`tapd.update` 报 `current=0.2.0` 误导用户）；CI 加版本一致性校验、加 npm pack 排除校验；测试加 4 处一致性 + 元测试；加 `tapd.update` MCP 工具来给 plugin 用户算 current/latest 升级建议；加 `commands/update.md` slash 命令；plugin name `tapd-server-cli` 让 slash 命令变成 `/tapd-server-cli:login` 14 字符前缀
- **用户验证层**：issue #10 至今没人完成 GUI 8 项手工 smoke——marketplace add 网络受限 + plugin install 弹窗 + `/mcp` Connected + `tapd.whoami` + `/tapd-server-cli:login` + `/update` + `/plugin uninstall` 任一卡住都没真做完

结论：plugin 路径的 ROI 没有兑现。**回归到"npm 包 + npx install"为唯一推荐路径**——但保留 plugin 时代有价值的 UX 资产（slash 命令的体验），把它们搬到不依赖 plugin 的承接路径：

- `commands/login.md` `logout.md` `update.md` 这些用户教过 Claude 的 slash 命令保留，但通过 user-scope `~/.claude/commands/tapd-server-cli/` 拷贝机制提供（由独立 change `install-claude-code-user-scope-commands` 实施）
- `tapd.update` MCP 工具的"算 current/latest 给升级建议"语义保留，搬成 `npx tapd-server-cli update` CLI 子命令（由独立 change `add-cli-subcommands-login-logout-update` 实施）

本 change 只负责**删**：拆掉所有不再需要的 plugin 基建。

## What Changes

- **删 plugin manifest**：
  - `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`，删空目录 `.claude-plugin/`
  - `.mcp.json`（被 plugin.json `mcpServers: "./.mcp.json"` 引用，孤儿后无意义）
- **删 tapd.update MCP 工具**：
  - `src/tools/update.ts`、`src/runtime/version.ts`（仅 update 工具用）
  - `commands/update.md`（slash 命令 `/tapd-server-cli:update` 的 plugin 资产；CLI 子命令版本由 `add-cli-subcommands-login-logout-update` change 重新建立）
  - `test/unit/update-logic.test.ts`、`test/unit/update-tool.test.ts`
  - `src/runtime/server.ts` 的 `registerUpdateTool` import / 调用
  - `src/tools/meta.ts` 中 `'tapd.update'` 元数据
- **删 version 同步基建**：
  - `scripts/sync-plugin-version.mjs`（4 处 version 同步用，plugin 删了就没多处要 sync）
  - `package.json.scripts.version` 钩子（删整个字段，不是缩减）
  - `test/unit/plugin-manifest.test.ts` 整个文件（4 处一致性 + args[1] 范围 + sync-targets 元测试都没意义了）
- **删 CI 同步校验**：
  - `.github/workflows/release.yml` 的 `Verify plugin version sync` step（保留 `Verify npm package excludes plugin files` step——commands/ openspec/ docs/ 仍要排除）
- **不动**：
  - `src/installer/{adapters/claude-code,adapters/codex,adapters/cursor,adapters/opencode,flow,claude-cli,codex-cli,redact}.ts` 整套 npx install 路径
  - `src/tools/login.ts` `src/tools/attachments-download.ts` `src/auth/*` 等运行时 server 代码
  - `commands/login.md` `commands/logout.md`（保留作为 `install-claude-code-user-scope-commands` change 的拷贝模板）
  - npm 包的运行时行为——`npx tapd-server-cli install <client>` 的语义零变化

## Capabilities

### New Capabilities
（无）

### Modified Capabilities

- `claude-code-plugin`：本次 archive 时把整个 capability 标 REMOVED——这是 v0.2.2 archive 时刚落地的 capability，本 change 撤回。`openspec archive` 时会把 `openspec/specs/claude-code-plugin/spec.md` 整个删除（如果该 capability 没有别的 change 在引用）

## Impact

**代码**

| 文件 | 操作 |
|---|---|
| `.claude-plugin/plugin.json` | DELETE |
| `.claude-plugin/marketplace.json` | DELETE |
| `.claude-plugin/`（空目录） | rmdir |
| `.mcp.json` | DELETE |
| `commands/update.md` | DELETE |
| `src/tools/update.ts` | DELETE |
| `src/runtime/version.ts` | DELETE |
| `test/unit/update-logic.test.ts` | DELETE |
| `test/unit/update-tool.test.ts` | DELETE |
| `test/unit/plugin-manifest.test.ts` | DELETE |
| `scripts/sync-plugin-version.mjs` | DELETE |
| `src/runtime/server.ts` | EDIT 删 update 工具 import + 调用 |
| `src/tools/meta.ts` | EDIT 删 `tapd.update` 元数据 |
| `package.json` | EDIT 删 `scripts.version` 钩子 |
| `.github/workflows/release.yml` | EDIT 删 `Verify plugin version sync` step |
| `.npmignore` | EDIT 调整（plugin 排除项不再需要、commands/ 反而要进 npm 包——后者由 `install-claude-code-user-scope-commands` change 处理） |
| `README.md` | EDIT 删"在 Claude Code 中安装（推荐）"节 + 所有 `/plugin marketplace` `/tapd-server-cli:update` 引用；npx install 节抬到唯一推荐路径 |
| `CHANGELOG.md` | EDIT 写 `[0.3.0]` 段（与 `install-claude-code-user-scope-commands` 和 `add-cli-subcommands-login-logout-update` 共享一段） |

**API**

- **Breaking**：`tapd.update` MCP 工具消失。任何依赖此工具调用的客户端（实际只有 plugin 用户的 `/tapd-server-cli:update` slash 命令）会报 `unknown tool`。本撤回的等价替代由 `npx tapd-server-cli update` CLI 子命令承接（独立 change）
- **Breaking**：`/plugin marketplace add wanggan768q/tapd-server-cli` 不再有效（marketplace.json 不存在）。已注册过此 marketplace 的 Claude Code 客户端会在 reload 时报 marketplace 不可用
- **Breaking**：`/plugin install tapd-server-cli@tapd-server-cli` 不再有效。已 install 过的 plugin 用户 `/plugin update` 会发现 marketplace 失效，需手动 `/plugin uninstall` 后改走 `npx install` 路径

**发版**

- v0.3.0（minor bump）。0.x 阶段 minor bump 接受 breaking。
- `.mcp.json` 锁的 `~0.2.0` 范围 plugin 用户**不会自动升到 0.3.0**——这是 by-design 的安全网（minor 不自动跨）。这些用户保留在 0.2.x 直到手动升级
- v0.3.0 包内不带 plugin 文件（commands/ 由独立 change 加进来，本 change 不动 npm 发布白名单）

**文档**

- 大幅重写 README——本 change 仅删除 plugin 相关内容；npx install 节作为唯一推荐路径在 `install-claude-code-user-scope-commands` 与 `add-cli-subcommands-login-logout-update` 落地后才完整体现
- CHANGELOG `[0.3.0]` 段记录三件事的合并撤回理由 + 用户迁移路径

**不影响**

- npm 包的 server 运行时
- `tapd.login` `tapd.logout` `tapd.whoami` `tapd.list_workspaces` `tapd.attachments.*` 等所有现有 MCP 工具
- npx install 路径（claude-code / codex / opencode / cursor 四家适配器全部保留）
- 现有 OpenSpec capabilities（`installer-cli` / `mcp-server-runtime` / `tapd-api-client` / `tapd-auth` / `tapd-resources` / `tapd-permission-introspection` / `tapd-web-client`）一个不动
