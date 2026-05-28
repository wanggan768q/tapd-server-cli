## Why

新用户按 README 安装 `tapd-server-cli` 后，常常出现"装了但 Claude Code 里看不到 MCP server"的现象。根因是：

1. **认知偏差**：用户找 `~/.claude/settings.json`，但 Claude Code 的 MCP 配置实际存在 `~/.claude.json`（家目录下，不是 `.claude/` 子目录）。`settings.json` 只放 permissions / hooks / env / UI 行为，**不是** MCP 配置文件。
2. **绕过官方 CLI**：现行 `npx tapd-server-cli install claude-code` 直接手写 `~/.claude.json` 顶层 `mcpServers.tapd`。新版 Claude Code（v2.1.150）推荐用 `claude mcp add-json` 写入，由 CLI 决定 scope 持久化位置；手写顶层在某些场景下不被识别。
3. **缺少 in-Claude 安装路径**：现行流程要求用户 (a) 终端跑 install (b) 手输 PAT (c) 重启 Claude Code (d) 再跑 `/mcp__tapd__setup`——4 步任何一步出错都"看起来装了但其实没装上"。

Claude Code 提供 plugin 机制（`/plugin marketplace add` + `/plugin install`），plugin manifest 的 `userConfig.tapd_token: { sensitive: true }` 能让 PAT 进系统 keychain（不落盘），`.mcp.json` 的 `${user_config.tapd_token}` 能把 PAT 注入到 bundled MCP server 的 env，**实现"在 Claude Code 内一行命令装好、自动收 PAT、立即可用"**。

Codex 也提供了对称的 `codex mcp add` CLI 命令，能让 npm 用户的安装路径同样稳定。

## What Changes

### B0 — 把仓库做成 Claude Code plugin（最高价值）

- 新增 `.claude-plugin/plugin.json`：plugin manifest，含 `userConfig.tapd_token` (sensitive=true) 与 `mcpServers: "./.mcp.json"` 引用。
- 新增 `.claude-plugin/marketplace.json`：让 `/plugin marketplace add wanggan768q/tapd-server-cli` 能发现本仓库为 plugin marketplace。
- 新增 `.mcp.json`：`mcpServers.tapd` 走 `npx -y tapd-server-cli`，env.TAPD_TOKEN = `${user_config.tapd_token}`，env.TAPD_LOG_LEVEL = `"info"`。
- 新增 `commands/login.md` + `commands/logout.md`：thin wrapper slash 命令 `/tapd-server-cli:login` / `/tapd-server-cli:logout`，对话型口吻提示 Claude 调 `tapd.login` / `tapd.logout` MCP 工具。
- 新增 `.npmignore`：显式排除 `.claude-plugin/` `.codex-plugin/` `.mcp.json` `commands/` `skills/` `openspec/` `docs/`，与 `package.json.files` 白名单形成双保险，确保 plugin 文件不进 npm publish。

### B1 — `npx install claude-code` / `install codex` 优先调官方 CLI

- 新增 `src/installer/claude-cli.ts`：`ClaudeCliProbe` 接口 + `preferClaudeCliInstall()` 高阶函数。检测 `claude --version` 可用 → 调 `claude mcp add-json tapd '<json>' --scope user`；不可用或失败 → 返回 fallback 标记。
- 新增 `src/installer/codex-cli.ts`：对称接口 + `preferCodexCliInstall()`。调用 `codex mcp add tapd --env TAPD_TOKEN=… --env TAPD_LOG_LEVEL=info -- npx -y tapd-server-cli`。
- 修改 `src/installer/flow.ts`：在 `claude-code` / `codex` 这两家的循环里，先尝试 CLI 优先路径；成功则跳过 `adapter.write`、记录 outcome=`wrote`；fallback 则继续走现行手写文件路径（向后兼容老用户）。
- 安全要点：CLI 调用走 `spawnSync.args` 数组，不经 shell expansion，PAT 不进 shell history；stderr 必须脱敏不含 PAT；5 秒超时防挂死。
- 测试：新增 `test/unit/claude-cli.test.ts` + `test/unit/codex-cli.test.ts` 各 4 个 TDD 用例（不可用 / happy / 失败 / spawn 抛错时不泄漏 PAT），增量 2 个集成用例覆盖 `flow.ts` 的 CLI 分支。

### B3 — README 重排 + 澄清

- 顶部新增「在 Claude Code 中安装」节，plugin 路径置顶（1-2-3 步骤清晰）。
- 把现行 npx install 节降为「在其它客户端中安装」。
- 第 186 行附近加红字：`⚠️ Claude Code 的 MCP 配置在 ~/.claude.json（家目录），不是 ~/.claude/settings.json`。
- 故障排查表新增两行：(a) `/mcp 看不到 tapd → 检查 ~/.claude.json 而不是 ~/.claude/settings.json`；(b) `已通过 npx install claude-code 装过，又装 plugin 但 /mcp 仍只看到一份 tapd → 按官方优先级 user scope 会屏蔽 plugin，须先 npx tapd-server-cli uninstall claude-code`。
- 卸载节同步加「Claude Code 用户走 `/plugin uninstall tapd-server-cli`」，并写明 npx → plugin 迁移路径。

### 版本同步与发版 CI

- `plugin.json.version` / `marketplace.json.plugins[0].version` 与 `package.json.version` **强制同步**：`.github/workflows/release.yml` 加校验步骤，三者不一致直接 fail。
- 新增 `scripts/sync-plugin-version.mjs` 在 `npm version` 钩子里自动同步，并 `git add` 让 `npm version` 的自动 commit 一起带上。
- CI 加 `npm pack --dry-run` 校验：输出含 `.claude-plugin/` 或 `.mcp.json` 等 plugin 文件 → 直接 fail。

## Capabilities

### New Capabilities

- `claude-code-plugin`：把仓库注册为 Claude Code plugin marketplace 的能力。涵盖 plugin manifest、marketplace manifest、bundled MCP server 配置、slash commands 包装、版本同步约束、与 `package.json` 发布流程的隔离。

### Modified Capabilities

- `installer-cli`：新增「Claude Code / Codex 安装路径优先调官方 CLI」要求；保留现行手写文件路径作为 fallback，向后兼容。

## Impact

**代码**

- 新增：`.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`、`.mcp.json`、`commands/login.md`、`commands/logout.md`、`.npmignore`。
- 新增：`src/installer/claude-cli.ts`、`src/installer/codex-cli.ts`、`scripts/sync-plugin-version.mjs`。
- 修改：`src/installer/flow.ts`（claude-code / codex 分支前置 CLI 优先逻辑）、`README.md`、`package.json`（增加 `version` 钩子脚本）、`.github/workflows/release.yml`（加版本同步与 npm pack 校验）。
- 新增测试：`test/unit/claude-cli.test.ts`、`test/unit/codex-cli.test.ts`、`test/unit/plugin-manifest.test.ts`，并在 `installer-flow.test.ts` 增量 2 个集成用例。

**依赖**

无新增 npm 依赖。`spawnSync` 走 Node.js 内置 `child_process`。

**API**

- `tapd-server-cli install claude-code` 行为变化：检测到 `claude` CLI 时优先调 `claude mcp add-json --scope user`，否则保持现行手写 `~/.claude.json` 的行为。**向后兼容**——配置最终落地的位置一致（user scope）。
- `tapd-server-cli install codex` 行为变化：同上对称改为优先 `codex mcp add`，否则保持现行手写 `~/.codex/config.toml`。
- 新增 plugin 安装路径：用户在 Claude Code 内可通过 `/plugin marketplace add wanggan768q/tapd-server-cli` + `/plugin install tapd-server-cli@tapd-server-cli` 安装，PAT 进系统 keychain。

**文档**

- README 顶部新增「在 Claude Code 中安装（推荐）」节。
- README 现行 npx install 节降级为「在其它客户端中安装」。
- 故障排查表新增 `~/.claude.json` vs `~/.claude/settings.json` 澄清。
- CLAUDE.md（项目本地规则）不需变动。

**不影响**

- `src/api/`、`src/auth/`、`src/resources/`、`src/runtime/`、`src/tools/`、`src/prompts/`、`src/permissions/` —— MCP server 运行时一切照旧。
- 现行 `tapd.login` / `tapd.logout` / `tapd.attachments.download` 的 cookie 持久化与热加载逻辑不动。
- OpenCode / Cursor 两家的 install 路径不动（这两家不支持 in-app plugin 安装）。
