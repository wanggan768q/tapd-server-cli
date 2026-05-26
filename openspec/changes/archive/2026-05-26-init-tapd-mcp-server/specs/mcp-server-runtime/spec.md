## ADDED Requirements

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
`TAPD_TOKEN`（必需）、`TAPD_API_BASE`（默认 `https://api.tapd.cn`）、`TAPD_CONCURRENCY`（默认 8）、`TAPD_TIMEOUT_MS`（默认 30000）、`TAPD_LOG_LEVEL`（默认 `info`）、`TAPD_PERMISSION_TTL_SEC`（默认 600）、`TAPD_MCP_HTTP_PORT`（默认未设置）。

#### Scenario: 缺少必需配置
- **WHEN** `TAPD_TOKEN` 未通过任何来源提供
- **THEN** 服务 MUST 以退出码 78 退出并打印获取令牌的指引

#### Scenario: 非法日志级别
- **WHEN** `TAPD_LOG_LEVEL=verbose` 等不在允许集合内
- **THEN** 服务 MUST 退出并提示允许的取值（trace/debug/info/warn/error）

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
4) 注册元工具与资源工具；
5) 绑定 MCP 传输。
任何前序步骤失败 MUST 中止后续步骤。

#### Scenario: 令牌验证失败终止
- **WHEN** 步骤 2 返回 401
- **THEN** 系统 MUST 不进入步骤 3 及之后，并以非零退出码终止

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
