## ADDED Requirements

### Requirement: CLI install 子命令
系统 SHALL 通过 CLI 入口提供 `install <client>` 子命令，用于把 MCP server 的 `mcpServers.tapd` 条目自动写入指定 MCP 客户端的配置文件。

`<client>` 首发 MUST 接受以下取值：`claude-code` / `codex` / `opencode` / `cursor`。

#### Scenario: 列出支持的客户端
- **WHEN** 用户执行 `tapd-server-cli install --help`
- **THEN** 输出 MUST 列出当前支持的 `<client>` 取值集合
- **AND** MUST 标注配置文件路径与备份策略

#### Scenario: 未识别的 client 取值
- **WHEN** 用户执行 `tapd-server-cli install xyz`
- **THEN** 命令 MUST 以非零退出码退出
- **AND** stderr MUST 给出可用客户端清单

#### Scenario: 默认子命令仍是启动 server
- **WHEN** 用户不带子命令直接执行 `tapd-server-cli`
- **THEN** 进程 MUST 进入 MCP server 启动流程（与改造前行为一致）
- **AND** `--http-port` / `--api-base` / `--token` 等 CLI flag MUST 仍可用

### Requirement: install 子命令幂等且可备份
`install <client>` 在写入客户端配置前 MUST 自动备份原文件（如存在）到 `<path>.bak.<timestamp>`，且对同一组输入 MUST 是幂等的（再次运行不破坏配置）。

#### Scenario: 目标配置文件不存在
- **WHEN** `~/.claude.json` 不存在，用户执行 `install claude-code`
- **THEN** 系统 MUST 创建该文件
- **AND** MUST NOT 创建任何 `.bak.*` 备份

#### Scenario: 目标配置文件已存在且无 tapd 条目
- **WHEN** `~/.claude.json` 存在，但 `mcpServers.tapd` 不存在
- **THEN** 系统 MUST 先创建 `~/.claude.json.bak.<timestamp>` 备份
- **AND** MUST 在原配置上合并 `mcpServers.tapd` 条目，保留其它键不变

#### Scenario: 目标配置文件已存在且 tapd 条目与预期完全一致
- **WHEN** `mcpServers.tapd` 已经与本次将要写入的内容完全相同
- **THEN** 系统 MUST NOT 写入文件
- **AND** MUST NOT 创建备份
- **AND** stdout MUST 输出 "已是最新配置，无需变更"

#### Scenario: 目标配置文件已存在且 tapd 条目内容不同
- **WHEN** `mcpServers.tapd` 已存在但与预期内容不一致
- **THEN** 系统 MUST 创建 `.bak.<timestamp>` 备份
- **AND** MUST 覆盖 tapd 条目为新内容
- **AND** stdout MUST 输出变更摘要（旧 command/args/env keys vs 新）

#### Scenario: --dry-run
- **WHEN** 用户执行 `install claude-code --dry-run`
- **THEN** 系统 MUST NOT 写入任何文件
- **AND** MUST NOT 创建备份
- **AND** stdout MUST 输出目标路径与将要写入的 JSON / TOML 片段

### Requirement: 多客户端适配器
系统 SHALL 通过 `ClientAdapter` 抽象封装每家客户端的配置文件路径与 schema 差异。首发 MUST 实现 `claude-code` / `codex` / `opencode` / `cursor` 四个适配器。

#### Scenario: claude-code 适配器写入路径
- **WHEN** 调用 `install claude-code`
- **THEN** 系统 MUST 写入 `<homedir>/.claude.json`
- **AND** tapd 条目 MUST 位于顶层 `mcpServers.tapd` 路径（用户级全局），不写入 `projects[].mcpServers.tapd`

#### Scenario: codex 适配器写入 TOML
- **WHEN** 调用 `install codex`
- **THEN** 系统 MUST 写入 `<homedir>/.codex/config.toml`
- **AND** 写入位置 MUST 是 `[mcp_servers.tapd]` 节
- **AND** TOML 解析 MUST 保留已有的其它节与注释（在解析器能力范围内）

#### Scenario: opencode 适配器写入 JSON
- **WHEN** 调用 `install opencode`
- **THEN** 系统 MUST 写入 `<homedir>/.config/opencode/mcp.json`
- **AND** 目录不存在时 MUST 自动 `mkdir -p`

#### Scenario: cursor 适配器写入 JSON
- **WHEN** 调用 `install cursor`
- **THEN** 系统 MUST 写入 `<homedir>/.cursor/mcp.json`
