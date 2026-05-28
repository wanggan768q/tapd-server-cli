# Proposal: 内置 `/tapd:update` 升级命令 + `.mcp.json` 锁版本

## Why

PR #1 review 留下两个 follow-up：

1. **#2 `.mcp.json` 没锁版本** — `args: ["-y", "tapd-server-cli"]` 默认拉 npm latest，server 发任何更新（包括 breaking）所有 plugin 用户立刻被波及，没有任何中��环节让用户感知。
2. **server 升级体验断裂** — 无论 plugin 用户、npx 用户、还是 Codex / OpenCode / Cursor 用户，都没有统一的"我现在装的是哪一版"以及"怎么升级"的入口；用户只能 `npm view tapd-server-cli` 然后自己拼安装命令。

把两件事打包成一个交付：

- `.mcp.json` 锁 minor 范围 `tapd-server-cli@~0.2.0`，把 breaking 拦在 user 主动升级动作之外
- 新增 MCP 工具 `tapd.update` 一次拿到当前版本 / 最新版本 / 用户安装路径 / 应执行的升级命令
- 新增 slash 命令 `/tapd-server-cli:update` 让用户在 Claude Code 里一句话触发"对比当前版本 + 给我具体升级指令"

## What Changes

### B0：`.mcp.json` 锁版本范围

- **MODIFIED**：`.mcp.json` 的 `args` 从 `["-y", "tapd-server-cli"]` 改为 `["-y", "tapd-server-cli@~0.2.0"]`
- 同步：`scripts/sync-plugin-version.mjs` 在 `npm version` 钩子里把 `.mcp.json` 也纳入同步（让 `0.2.x` ↔ `~0.2.0` 总是一致）

### B1：新 MCP 工具 `tapd.update`

- **NEW**：`src/tools/update.ts`，注册名 `tapd.update`，无入参
- 实现要点：
  - 当前版本：直接 import `package.json.version`（编译时内联，不依赖运行时 fs）
  - 最新版本：调 `npm view tapd-server-cli version` 用 `spawnSync({ shell: false, timeout: 5000 })`；失败降级返回 `latest: null, fetch_error: <reason>`
  - 安装路径检测：
    - 检测 `process.env.CLAUDE_PLUGIN_ROOT` 或 `process.argv[1]` 路径里包含 `.claude/plugins/` → `installed_via: 'plugin'`
    - 否则 `installed_via: 'npx'`（无法精确区分 npx-claude / npx-codex / npx-cursor，由 Claude 根据上下文继续追问）
  - 升级指令：根据 `installed_via` + 当前 `comparison`（`up-to-date` / `update-available` / `unknown`）返回针对性的 shell 命令
- 注册到 `src/tools/register.ts`，添加进 `tapd.list_capabilities` 的 `meta_tools` 数组
- 不依赖网络可用：所有调用方都在 try/catch 内，断网时只是 `latest: null`，工具仍返成功

### B2：新 slash 命令 `commands/update.md`

- **NEW**：`commands/update.md`，按 `commands/login.md` 体例
- 在 `.claude-plugin/plugin.json` 的 commands 列表追加注册（如果该 manifest 显式列出 commands）

### B3：文档与故障排查

- README 「升级」节扩展：把"通过 `/tapd-server-cli:update` 命令检查升级"作为推荐路径置顶，npx 手动升级降级为兜底
- 故障排查表新增「`tapd.update` 报 `latest: null`」一行

## Impact

- **新增 capability**：`update-command`（详见 `specs/update-command/spec.md`，6 个 Requirement）
- **修改 capability**：`claude-code-plugin`（详见 `specs/claude-code-plugin/spec.md`，2 个 MODIFIED Requirement —— `.mcp.json` 锁版本 + 注册 update 命令）
- **零外部依赖新增**：`npm view` 是 npm CLI 内置子命令，不引入新 npm 包
- **向后兼容**：`tapd.update` 是新增工具，不影响现有工具；`.mcp.json` 锁版本只影响"用户首次 `/plugin install` 之后"的 server 启动，已装的版本不会因锁版本被回滚
- **风险**：
  - 网络受限场景下 `npm view` 调用会 5s 超时——这是设计内行为，工具仍返成功只是 `latest: null`
  - 锁 minor 后，0.3.0 必须通过 plugin marketplace update 才能拿到——用户感知到"plugin 升级 = 显式动作"是 by-design
