# Spec delta: `claude-code-plugin` capability（本 change 引入的修改）

## MODIFIED Requirements

### Requirement: `.mcp.json` 必须锁定到 minor 范围以避免静默 breaking

**之前**：`mcpServers.tapd.args` 为 `["-y", "tapd-server-cli"]`，server 总是拉 npm latest，跨 minor 的 breaking 会静默波及所有 plugin 用户。

**之后**：`mcpServers.tapd.args` 锁定到 `["-y", "tapd-server-cli@~<major>.<minor>.0"]`，patch 自动跟、minor/major 必须显式 `/plugin marketplace update` 才能拿到。

#### Scenario: `.mcp.json` args 始终带 ~minor 范围

- **Given** 仓库已发布版本号为 `X.Y.Z`
- **When** 读取 `.mcp.json`
- **Then** `mcpServers.tapd.args[1]` 等于字符串 `tapd-server-cli@~X.Y.0`

#### Scenario: `npm version` 钩子同步更新 `.mcp.json`

- **Given** 当前 `.mcp.json` args[1] 为 `tapd-server-cli@~0.2.0`
- **When** 跑 `npm version 0.3.0`
- **Then** `.mcp.json` args[1] 自动更新为 `tapd-server-cli@~0.3.0`
- **And** 同步动作通过 `scripts/sync-plugin-version.mjs` 在 `version` 生命周期钩子完成

#### Scenario: CI 校验 `.mcp.json` 与 package.json 同步

- **Given** 在 release workflow 的 `Verify plugin version sync` step
- **When** 校验运行
- **Then** 解析 `.mcp.json` args[1] 中 `~` 后的版本
- **And** 该版本的 major.minor 必须等于 `package.json.version` 的 major.minor
- **若不一致** workflow 必须 exit 1

### Requirement: plugin 必须注册 `update` slash 命令

**之前**：`.claude-plugin/` 与 `commands/` 提供 `login` / `logout` 两个 slash 命令。

**之后**：增加 `update` slash 命令（详见 `update-command` capability spec），与 `login` / `logout` 一起作为本 plugin 对 Claude Code 暴露的官方命令面。

#### Scenario: `commands/update.md` 与 login / logout 同级存在

- **When** 列出 `commands/` 目录
- **Then** 同时存在 `login.md`、`logout.md`、`update.md` 三个文件
- **And** 都含合规 YAML frontmatter
