# installer-cli Specification

## ADDED Requirements

### Requirement: claude-code 与 codex 安装路径优先调官方 CLI

当目标客户端为 `claude-code` 或 `codex` 且对应 CLI 在 PATH 中可执行时，install 流程 MUST 优先调用官方 CLI（`claude mcp add-json --scope user` 或 `codex mcp add`）写入配置；CLI 不可用、超时或调用失败时 MUST 回退到现行手写文件路径，不打断流程。

CLI 调用 MUST 满足：

- 通过 `child_process.spawnSync` 的 `args` 数组传参，不经 shell expansion，PAT 不进入 shell history
- 5000 毫秒（5 秒）`spawnSync.timeout` 超时；超时由 Node 用 `SIGTERM` 终止子进程
- stderr 输出 MUST NOT 包含 PAT 明文（即便 spawn 抛错，错误回显也要脱敏）

#### Scenario: claude CLI 可用时优先调用 claude mcp add-json

- **WHEN** install 流程处理 `claude-code` 客户端
- **AND** `claude --version` 在 PATH 中可执行（exit code 0）
- **THEN** 流程调用 `claude mcp add-json tapd '<json>' --scope user`
- **AND** `<json>` 中 `env.TAPD_TOKEN` 等于用户提供的 PAT
- **AND** 调用成功（exit code 0）后跳过 `adapter.write`，记录 outcome=`wrote`
- **AND** 输出汇总行包含 `通过 claude CLI 注册到 user scope`

#### Scenario: claude CLI 不可用时回退手写文件

- **WHEN** install 流程处理 `claude-code` 客户端
- **AND** `claude --version` 在 PATH 中不可执行（spawnError 或 exit code 非 0）
- **THEN** 流程回退到现行 `adapter.read` → `merge` → `write` 路径
- **AND** 写入 `~/.claude.json` 顶层 `mcpServers.tapd`
- **AND** 输出提示 `(claude CLI 不可用，回退手写)`，但不视为失败

#### Scenario: codex CLI 可用时优先调用 codex mcp add

- **WHEN** install 流程处理 `codex` 客户端
- **AND** `codex --version` 在 PATH 中可执行
- **THEN** 流程调用 `codex mcp add tapd --env TAPD_TOKEN=<pat> --env TAPD_LOG_LEVEL=info -- npx -y tapd-server-cli`
- **AND** 调用成功后跳过 `adapter.write`，记录 outcome=`wrote`

#### Scenario: codex CLI 不可用时回退手写 TOML

- **WHEN** install 流程处理 `codex` 客户端
- **AND** `codex --version` 在 PATH 中不可执行
- **THEN** 流程回退到现行手写 `~/.codex/config.toml` 的 `[mcp_servers.tapd]` 节路径
- **AND** 不视为失败

#### Scenario: CLI 调用失败时 stderr 不包含 PAT

- **WHEN** install 流程调用 `claude mcp add-json` 或 `codex mcp add`
- **AND** spawn 抛 `EACCES` / 进程返回非 0 退出码 / 超时
- **THEN** 流程捕获 stderr 但 **MUST NOT** 包含原始 PAT 明文
- **AND** 流程把脱敏后的 stderr 写入汇总错误信息
- **AND** 流程回退到手写文件路径
- **AND** 老用户的体验等价于现行行为（无感知）

#### Scenario: CLI 调用超时

- **WHEN** install 流程调用 `claude mcp add-json` 或 `codex mcp add`
- **AND** CLI 进程在 5 秒内未返回
- **THEN** spawnSync 因超时被 kill
- **AND** 流程把超时记为 fallback 触发，不视为致命错误
- **AND** 走手写文件路径

### Requirement: install 提示文案明确区分 ~/.claude.json 与 ~/.claude/settings.json

为了消除新用户的认知偏差，install 子命令的输出文案 MUST 在涉及 Claude Code 配置文件路径时使用完整绝对路径 `~/.claude.json`，并且 README 与故障排查表 MUST 显式说明该文件与 `~/.claude/settings.json` 的区别。

#### Scenario: install 输出汇总打印完整路径

- **WHEN** install 完成 `claude-code` 写入
- **THEN** 汇总行打印形如 `✔ claude-code  ~/.claude.json` 或 `✔ claude-code  <via claude mcp add-json --scope user>`
- **AND** 不出现歧义路径如 `~/.claude/`（不带文件名）

#### Scenario: README 故障排查表澄清两文件区别

- **WHEN** 用户阅读 README 故障排查表
- **THEN** 表中含一行 `/mcp 看不到 tapd → 检查 ~/.claude.json（不是 ~/.claude/settings.json）`
- **AND** README「高级：手动配置 MCP 客户端」节附近有红字说明 `~/.claude.json` 是 MCP 配置文件、`~/.claude/settings.json` 是 settings 文件
