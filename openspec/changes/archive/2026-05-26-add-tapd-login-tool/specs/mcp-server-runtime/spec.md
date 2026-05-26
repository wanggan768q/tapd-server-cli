## MODIFIED Requirements

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

## ADDED Requirements

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

