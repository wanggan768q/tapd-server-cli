# Design — add-claude-code-plugin

## Context

仓库 `tapd-server-cli` v0.2.0 已发布到 npm，提供 stdio MCP server + 4 家客户端 install 子命令。新用户按 README 安装后，常常出现"装了但 Claude Code 里看不到 MCP server"的现象（详见 proposal.md「Why」）。

调查发现：

1. Claude Code v2.1.150 的 MCP 配置在 `~/.claude.json`（家目录顶层 `mcpServers`），**不是** `~/.claude/settings.json`。这是 Claude Code 官方文档（https://code.claude.com/docs/en/mcp）明确说明的。
2. Claude Code 提供 plugin marketplace 机制（`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`），plugin 可以 bundle MCP server 并通过 `userConfig` 在安装时弹窗收 secret，进系统 keychain。
3. Codex 提供对称的 plugin 体系（`.codex-plugin/plugin.json`）以及 `codex mcp add` CLI 命令；OpenCode 不提供 in-app 安装入口。

## Goals / Non-Goals

### Goals

- 在 Claude Code 内提供"一行命令安装、自动收 PAT、立即可用"的体验。
- 老的 `npx tapd-server-cli install claude-code` 路径保持向后兼容，但优先调官方 CLI（`claude mcp add-json --scope user`），让配置落地位置与新版 Claude Code 期望一致。
- Codex 用户走 `npx tapd-server-cli install codex` 时同样优先调 `codex mcp add`，提升稳定性。
- README 顶部把 plugin 路径置顶，澄清 `~/.claude.json` 与 `~/.claude/settings.json` 的区别。

### Non-Goals

- **本轮不做 Codex plugin（`.codex-plugin/`）**。仅在 B1 里通过 `codex mcp add` 改进 npm install 路径。Codex plugin 留作后续独立 OpenSpec change。
- 不改 server 运行时（`src/api/`、`src/resources/`、`src/runtime/` 等）。所有改动在 packaging 层。
- 不改 OpenCode / Cursor 的 install 路径（这两家无对等 in-app 机制）。
- 不引入新 npm 依赖。CLI 调用走 Node.js 内置 `child_process.spawnSync`。
- 不做"安装后健康检查"（B2 推后到下一轮）。

## Decisions

### D1：Plugin name = "tapd-server-cli"

- 与 npm 包名同名，便于识别。
- Slash 命令变 `/tapd-server-cli:login` `/tapd-server-cli:logout`（14 字符前缀，靠 Tab 自动补全缓解）。
- MCP server key 仍叫 `tapd`（短，便于 Claude 调工具时引用 `tapd.stories.list`）。Plugin name 与 MCP server key 解耦，规范允许。

### D2：方案 A — npx 拉起 server，不 bundle dist

- `.mcp.json.command = "npx"`、`args = ["-y", "tapd-server-cli"]`。
- 优点：单源真相（plugin 用户与 npm 用户共享同一份 server 代码）、release 流程不变。
- 缺点：首次启动 npx 拉包慢（< 3 秒），缓存后秒起。
- 决策：接受首次冷启动延迟，换取单源真相。

### D3：TAPD_TOKEN 走 `userConfig.tapd_token` (sensitive=true)

- 安装时弹窗必填，PAT 进系统 keychain（macOS/Windows）/ `~/.claude/.credentials.json`（Linux fallback）。
- `.mcp.json` 的 `env.TAPD_TOKEN` 用 `${user_config.tapd_token}` 引用。
- **不**额外暴露 `TAPD_LOG_LEVEL` / `TAPD_API_BASE` 等高级配置——YAGNI；高级用户可 fork 走 `claude --plugin-dir` 测试。

### D4：B1 — claude-code 与 codex 两家 CLI 优先

- 新增 `src/installer/claude-cli.ts` + `src/installer/codex-cli.ts`，对称 `Probe` 接口便于注入 mock。
- `flow.ts` 在两家循环里前置 CLI 探测：可用且成功 → 跳过 `adapter.write`；不可用或失败 → 落 fallback 走现行手写文件路径。
- **向后兼容**：fallback 路径完全等价于现行行为，老用户无感知。

### D5：Slash 命令双轨

- Plugin 提供 `commands/login.md` `commands/logout.md` thin wrapper（对话型口吻：「请调用 MCP 工具 `tapd.login` 完成…」）。
- 同时保留现行 MCP server 的 `setup` prompt 自动渲染为 `/mcp__tapd__setup`。
- 两条入口并存，提升发现性。

### D6：marketplace.json 单 plugin 形态

- 仓库根作为 marketplace，仅含一个 plugin（自身）。
- `source: "./"` 指向仓库根，因为同仓库形态决定 marketplace 与 plugin 都在仓库根。
- 用户输入：`/plugin marketplace add wanggan768q/tapd-server-cli` + `/plugin install tapd-server-cli@tapd-server-cli`。

### D7：版本同步强制

- `plugin.json.version` / `marketplace.json.plugins[0].version` 与 `package.json.version` 三者强制一致。
- `npm version` 钩子（`scripts/sync-plugin-version.mjs`）自动同步并 `git add`。
- release CI 加校验，三者不一致直接 fail。

### D8：npm 发布隔离 — 白名单 + .npmignore 双保险

- `package.json.files` 已是 `["dist", "README.md", "LICENSE"]` 白名单，理论上 plugin 文件不会被打包。
- 仍新增 `.npmignore` 显式排除 `.claude-plugin/` `.mcp.json` `commands/` 等，作为第二道防线。
- CI 加 `npm pack --dry-run` 校验，发现 plugin 文件落入包内直接 fail。

## Risks / Trade-offs

| 风险 | 严重度 | 缓解 |
|---|---|---|
| Claude Code plugin manifest schema 演进，将来字段语义变化 | 中 | 跟随官方文档版本；CI 跑 `claude plugin validate ./` |
| `npx -y tapd-server-cli` 首次拉包慢（3-5 秒） | 低 | 接受，缓存后秒起；`/mcp` 启动时 Claude Code 会显示 pending 状态 |
| 用户已通过 `npx install claude-code` 装过，再装 plugin → ~/.claude.json 与 plugin scope 出现两条 `tapd` 配置 | 中 | README 卸载节明确说明「先 `npx tapd-server-cli uninstall claude-code` 再 `/plugin install`」；按 Claude Code 官方优先级（local > project > user > plugin > claude.ai），用户已写入 `~/.claude.json` 顶层 `mcpServers.tapd`（user scope）会**屏蔽** plugin 提供的同名 server，必须先卸载 user scope 那条才能让 plugin 生效。这条信息会写进 README 卸载节与故障排查表。 |
| `plugin.json.version` 与 `package.json.version` 漂移导致 plugin 用户拉到错误版本 server | 高 | `scripts/sync-plugin-version.mjs` + release CI 双检查 |
| Plugin 文件意外进入 npm 包 → npm 用户安装时占用磁盘 | 中 | files 白名单 + .npmignore + CI `npm pack --dry-run` 三重防护 |
| Claude CLI / Codex CLI 在某些环境下 spawn 失败但 stderr 含 PAT | 高（安全） | 测试用例显式覆盖 spawn 抛错路径，验证 PAT 不出现在错误回显 |

## Migration

### 老用户（已通过 `npx tapd-server-cli install claude-code` 装过）

升级路径有两种：

**路径 A（保持现状）**：什么都不做。本次改进对老用户透明，下次跑 `npx install claude-code` 会自动走 `claude mcp add-json` 优先路径，配置位置不变。

**路径 B（迁移到 plugin）**：
1. `npx tapd-server-cli uninstall claude-code`（清掉 `~/.claude.json` 顶层 `mcpServers.tapd`）
2. 在 Claude Code 内 `/plugin marketplace add wanggan768q/tapd-server-cli`
3. `/plugin install tapd-server-cli@tapd-server-cli`，弹窗输入 PAT
4. 重启 Claude Code

README 卸载节加这两条迁移路径。

### 新用户

直接走 plugin 路径（README 顶部第 1 节）。

## Test Plan

### 单元测试

| 文件 | 用例 |
|---|---|
| `test/unit/claude-cli.test.ts` | (1) `isAvailable=false → fallback`；(2) `addJson ok → cli`；(3) `addJson fail → fallback + stderr`；(4) `spawn 抛错 → fallback + stderr 不含 PAT` |
| `test/unit/codex-cli.test.ts` | 与 claude-cli 对称的 4 个用例 |
| `test/unit/installer-flow.test.ts` 增量 | (1) `claude-code` 走 CLI 时 `adapter.write` 不被调；(2) `codex` 同 |
| `test/unit/plugin-manifest.test.ts` | (1) `plugin.json` 是合法 JSON 且 `name === "tapd-server-cli"`；(2) `marketplace.json.plugins[0].version === plugin.json.version === package.json.version`；(3) `.mcp.json` 的 `env.TAPD_TOKEN === "${user_config.tapd_token}"` |

### 集成测试（手动 smoke）

| 步骤 | 期望输出 |
|---|---|
| `npm pack --dry-run` | 输出**不**含 `.claude-plugin/` `.mcp.json` `commands/` |
| `claude plugin validate ./` | 通过（无 error） |
| `claude --plugin-dir ./` | 加载本仓库为 plugin 成功 |
| `/plugin install tapd-server-cli@tapd-server-cli`（在 `--plugin-dir` 模式或 marketplace add 后） | 弹窗收 PAT，写入 keychain |
| `/mcp` | `tapd ✓ Connected` |
| 调 `tapd.whoami` | 返回当前 PAT 身份 |
| `/tapd-server-cli:login` | 弹浏览器抓 cookie，附件下载工具热加载 |

### 安全验证

- `test/unit/claude-cli.test.ts` 用例 4 显式断言 `result.stderr` **不**含 PAT 字符串。
- `test/unit/codex-cli.test.ts` 同。
- 手动验证：在 PowerShell / bash 跑 `npx install claude-code`，跑完后查 shell history（`history` / `Get-History`），PAT 不应出现。

### 验收标准（DoD）

- [ ] 所有单元测试绿。
- [ ] `claude plugin validate ./` 通过。
- [ ] `npm pack --dry-run` 不含 plugin 文件。
- [ ] 手动 smoke 全部通过（`/mcp` 显示 `tapd ✓ Connected`，`tapd.whoami` 返回身份）。
- [ ] README 顶部「在 Claude Code 中安装」节存在；故障排查表含 `~/.claude.json` vs `~/.claude/settings.json` 澄清。
- [ ] release CI 加版本同步与 npm pack 校验步骤；故意改不一致版本号能 trigger fail。
