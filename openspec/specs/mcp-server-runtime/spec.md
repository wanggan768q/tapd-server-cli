# mcp-server-runtime Specification

## Purpose
TBD - created by archiving change init-tapd-mcp-server. Update Purpose after archive.
## Requirements
### Requirement: 进程入口与传输模式
系统 SHALL 提供一个可执行入口（`npx tapd-mcp` 或同等命令），默认以 MCP stdio 传输运行；当设置 `TAPD_MCP_HTTP_PORT` 时 MUST 额外/替代启用 MCP streamable HTTP 传输。

#### Scenario: 默认 stdio
- **WHEN** 未设置 `TAPD_MCP_HTTP_PORT`
- **THEN** 进程 MUST 在 stdio 上监听 MCP 协议消息，stderr 输出日志

#### Scenario: 启用 HTTP 传输
- **WHEN** 设置 `TAPD_MCP_HTTP_PORT=8787`
- **THEN** 进程 MUST 在 `0.0.0.0:8787` 上提供 MCP streamable HTTP 端点

### Requirement: 配置项与默认值
系统 SHALL 至少识别以下环境变量并应用文档化默认值：
`TAPD_TOKEN`（必需）、`TAPD_API_BASE`（默认 `https://api.tapd.cn`）、`TAPD_CONCURRENCY`（默认 8）、`TAPD_TIMEOUT_MS`（默认 30000）、`TAPD_LOG_LEVEL`（默认 `info`）、`TAPD_PERMISSION_TTL_SEC`（默认 600）、`TAPD_MCP_HTTP_PORT`（默认未设置）、`TAPD_WEB_COOKIE`（默认未设置；优先级最高的 cookie 来源）、`TAPD_WEB_BASE`（默认 `https://www.tapd.cn`）、`TAPD_FILE_BASE`（默认 `https://file.tapd.cn`）、`TAPD_WEB_CONCURRENCY`（默认 4）。

cookie 文件路径固定为 `~/.config/tapd-mcp/cookie`（由 `CookieStore` 管理，不通过 env 配置）。

#### Scenario: 缺少必需配置
- **WHEN** `TAPD_TOKEN` 未通过任何来源提供
- **THEN** 服务 MUST 以退出码 78 退出并打印获取令牌的指引

#### Scenario: 非法日志级别
- **WHEN** `TAPD_LOG_LEVEL=verbose` 等不在允许集合内
- **THEN** 服务 MUST 退出并提示允许的取值（trace/debug/info/warn/error）

#### Scenario: 既无 env 也无 cookie 文件仍能启动
- **WHEN** 仅设置 `TAPD_TOKEN`，未设置 `TAPD_WEB_COOKIE`，cookie 文件不存在
- **THEN** 服务 MUST 正常启动，工具列表 MUST 包含 `tapd.login`，MUST NOT 包含 `tapd.attachments.download`

#### Scenario: 非法 TAPD_WEB_BASE
- **WHEN** `TAPD_WEB_BASE` 不是合法 URL
- **THEN** 服务 MUST 以退出码 78 退出并报错指出原因

### Requirement: 结构化脱敏日志
系统 SHALL 以单行 JSON 形式输出日志到 stderr，包含 `ts`、`level`、`msg`、`requestId?`、`durationMs?`。日志 MUST NOT 输出完整令牌或令牌相邻字符；所有 PAT 引用必须脱敏（前 4 + `***` + 后 4）。

#### Scenario: 一次成功的 API 调用日志
- **WHEN** 客户端命中一次 `GET /stories?workspace_id=...`
- **THEN** stderr 日志条目 MUST 包含 `level:"info"`、`msg:"tapd_request"`、`durationMs`、`requestId`，但不包含任何令牌字符

#### Scenario: 鉴权失败日志
- **WHEN** TAPD 返回 401
- **THEN** 日志 MUST 含 `level:"warn"`、`msg:"unauthenticated"`，并仍只显示脱敏令牌

### Requirement: 启动顺序
系统 MUST 按以下顺序完成启动：
1) 加载并验证配置；
2) 校验令牌（`/users/info`）；
3) 拉取 workspace 白名单（`/workspaces/user_participant_projects`）；
4) **可选**：通过 `CookieStore.load()` 解析 cookie 来源（env > 文件 > 无）；若得到非空值则装配 `TapdWebClient`（MUST NOT 发起网络验证）并通过 `AttachmentRegistry.arm()` 注册 `tapd.attachments.download`；
5) 注册元工具与资源工具，**始终包含** `tapd.login` 与 `tapd.logout`（不依赖 cookie 状态）；
6) 绑定 MCP 传输。

任何 1-3 或 5-6 步骤失败 MUST 中止后续步骤；步骤 4 内部不允许失败（不发请求 → 没有可失败的事）。

#### Scenario: 令牌验证失败终止
- **WHEN** 步骤 2 返回 401
- **THEN** 系统 MUST 不进入步骤 3 及之后，并以非零退出码终止

#### Scenario: 未设置 cookie 时跳过装配
- **WHEN** `CookieStore.load()` 返回 undefined
- **THEN** 步骤 4 MUST 跳过 `TapdWebClient` 装配
- **AND** 步骤 5 注册的工具集 MUST 包含 `tapd.login` 与 `tapd.logout`
- **AND** MUST NOT 包含 `tapd.attachments.download`

#### Scenario: 从文件加载 cookie
- **WHEN** `TAPD_WEB_COOKIE` 未设置但 `~/.config/tapd-mcp/cookie` 存在且权限合规
- **THEN** 步骤 4 MUST 装配 `TapdWebClient` 使用文件 cookie
- **AND** 启动日志 MUST 包含 `cookie_source: 'file'`

#### Scenario: env 优先于文件
- **WHEN** `TAPD_WEB_COOKIE` 与 cookie 文件同时存在
- **THEN** 步骤 4 MUST 使用 env 值装配
- **AND** 启动日志 MUST 包含 `cookie_source: 'env'`

### Requirement: 优雅停止
系统 SHALL 在收到 SIGINT/SIGTERM 后于 5 秒内：1) 拒绝新的 MCP 请求；2) 等待进行中的请求完成（或在剩余时间结束时强制取消）；3) 退出进程。

#### Scenario: 收到 SIGINT
- **WHEN** 进程收到 SIGINT
- **THEN** 系统 MUST 在不超过 5 秒内完成清理并退出，退出码为 0（若正常完成）或 130（若强制取消）

### Requirement: 健康检查（仅 HTTP 模式）
当启用 streamable HTTP 传输时，系统 SHALL 暴露 `GET /healthz` 端点，返回 `{ status:"ok", uptime_sec, snapshot_at }`。

#### Scenario: HTTP 模式下 healthz
- **WHEN** 启用 HTTP 传输且服务就绪
- **THEN** `GET /healthz` MUST 返回 HTTP 200 与上述字段

### Requirement: 工具能力诊断
系统 SHALL 通过 `tapd.list_capabilities` 工具暴露当前 web client 的装配状态与 cookie 来源，便于排查 cookie 是从 env 还是文件加载。

#### Scenario: 未装配 cookie
- **WHEN** 调用 `tapd.list_capabilities`，server 未装配 webClient
- **THEN** 返回的 `web_client` 字段 MUST 形如 `{enabled: false, cookie_source: 'none', base, file_base}`
- **AND** `attachment_tools` MUST 是包含 `tapd.attachments.get_download_url` 但不含 `tapd.attachments.download` 的列表

#### Scenario: 从 env 装配
- **WHEN** 调用 `tapd.list_capabilities`，cookie 来自 `TAPD_WEB_COOKIE`
- **THEN** 返回 `web_client.cookie_source` MUST 是 `'env'`
- **AND** `web_client.enabled` MUST 是 true

#### Scenario: 从文件装配
- **WHEN** 调用 `tapd.list_capabilities`，cookie 来自 `~/.config/tapd-mcp/cookie`
- **THEN** 返回 `web_client.cookie_source` MUST 是 `'file'`

### Requirement: MCP Prompt 注册
系统 SHALL 通过 `McpServer.registerPrompt` 注册名为 `setup` 的 MCP prompt，作为新用户安装后零记忆的首次设置 / 状态诊断入口。该 prompt MUST 在 server 启动期注册，MUST NOT 依赖 PAT 或 cookie 状态。

#### Scenario: prompt 在启动后可被列出
- **WHEN** MCP 客户端在 server 启动后发送 `prompts/list` 请求
- **THEN** 响应 MUST 包含名为 `setup` 的条目
- **AND** 该条目 MUST 携带非空的 `title` 与 `description`

#### Scenario: 客户端 prompts/get 拿到引导内容
- **WHEN** MCP 客户端发送 `prompts/get` 请求 `name: "setup"`
- **THEN** 响应 `messages` MUST 是长度为 1 的数组
- **AND** `messages[0].role` MUST 是 `"user"`
- **AND** `messages[0].content.type` MUST 是 `"text"`
- **AND** `messages[0].content.text` MUST 同时包含字符串 `tapd.whoami`、`tapd.list_capabilities`、`tapd.login`

#### Scenario: 在 cookie 未配置状态下调用
- **WHEN** server 启动时无可用 cookie，客户端调用 `setup` prompt
- **THEN** prompt MUST 仍正常返回（prompt 注册不依赖 cookie 状态）
- **AND** 返回文本 MUST 显式引导 AI 调用 `tapd.login` 完成登录

#### Scenario: 在已登录状态下重复调用
- **WHEN** server 已装配 webClient（cookie 来自 env 或文件），客户端再次调用 `setup` prompt
- **THEN** prompt MUST 仍正常返回相同文本
- **AND** 文本 MUST 包含让 AI 通过 `tapd.list_capabilities` 检查当前状态后再决定是否触发登录的指引（避免在已登录状态下擅自重新弹浏览器）

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

