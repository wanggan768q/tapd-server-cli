## MODIFIED Requirements

### Requirement: 配置项与默认值
系统 SHALL 至少识别以下环境变量并应用文档化默认值：
`TAPD_TOKEN`（必需）、`TAPD_API_BASE`（默认 `https://api.tapd.cn`）、`TAPD_CONCURRENCY`（默认 8）、`TAPD_TIMEOUT_MS`（默认 30000）、`TAPD_LOG_LEVEL`（默认 `info`）、`TAPD_PERMISSION_TTL_SEC`（默认 600）、`TAPD_MCP_HTTP_PORT`（默认未设置）、`TAPD_WEB_COOKIE`（默认未设置；设置后启用网页客户端）、`TAPD_WEB_BASE`（默认 `https://www.tapd.cn`）、`TAPD_WEB_CONCURRENCY`（默认 4）。

#### Scenario: 缺少必需配置
- **WHEN** `TAPD_TOKEN` 未通过任何来源提供
- **THEN** 服务 MUST 以退出码 78 退出并打印获取令牌的指引

#### Scenario: 非法日志级别
- **WHEN** `TAPD_LOG_LEVEL=verbose` 等不在允许集合内
- **THEN** 服务 MUST 退出并提示允许的取值（trace/debug/info/warn/error）

#### Scenario: 单独设置 TAPD_WEB_COOKIE 即生效
- **WHEN** 仅设置 `TAPD_TOKEN` 与 `TAPD_WEB_COOKIE`，其它 web 配置使用默认值
- **THEN** 服务 MUST 装配 web 客户端，并以默认 base `https://www.tapd.cn` 与默认并发 4 工作

#### Scenario: 非法 TAPD_WEB_BASE
- **WHEN** `TAPD_WEB_BASE` 不是合法 URL
- **THEN** 服务 MUST 以退出码 78 退出并报错指出原因

### Requirement: 启动顺序
系统 MUST 按以下顺序完成启动：
1) 加载并验证配置；
2) 校验令牌（`/users/info`）；
3) 拉取 workspace 白名单（`/workspaces/user_participant_projects`）；
4) **可选**：当 `TAPD_WEB_COOKIE` 已配置时，装配 `TapdWebClient`（MUST NOT 发起网络验证）；
5) 注册元工具与资源工具（资源工具中的 `tapd.attachments.download` 仅在步骤 4 发生时注册）；
6) 绑定 MCP 传输。
任何 1-3 或 5-6 步骤失败 MUST 中止后续步骤；步骤 4 内部不允许失败（不发请求 → 没有可失败的事）。

#### Scenario: 令牌验证失败终止
- **WHEN** 步骤 2 返回 401
- **THEN** 系统 MUST 不进入步骤 3 及之后，并以非零退出码终止

#### Scenario: 未设置 cookie 时跳过步骤 4
- **WHEN** `TAPD_WEB_COOKIE` 未设置
- **THEN** 步骤 4 MUST 被跳过，且步骤 5 注册的工具集 MUST NOT 包含 `tapd.attachments.download`
