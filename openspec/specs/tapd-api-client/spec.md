# tapd-api-client Specification

## Purpose
TBD - created by archiving change init-tapd-mcp-server. Update Purpose after archive.
## Requirements
### Requirement: 基地址与鉴权头
HTTP 客户端 SHALL 默认以 `https://api.tapd.cn` 为基地址，并对所有出站请求注入头 `Authorization: Bearer <PAT>`。基地址 MUST 可通过环境变量 `TAPD_API_BASE` 覆盖。

#### Scenario: 默认基地址
- **WHEN** 未设置 `TAPD_API_BASE`
- **THEN** 客户端 MUST 使用 `https://api.tapd.cn`

#### Scenario: 覆盖基地址
- **WHEN** 设置 `TAPD_API_BASE=https://tapd.internal.example.com`
- **THEN** 客户端 MUST 用该地址拼接全部请求 URL

### Requirement: 响应包络解析
客户端 SHALL 把 TAPD 响应 `{status, data, info, meta}` 包络拆解为统一结构：成功时返回 `data`；非成功时抛出携带 `tapdStatus`、`info`、`requestId` 字段的结构化错误对象。

#### Scenario: 成功响应
- **WHEN** TAPD 返回 HTTP 200 + `{status:1, data:[...], info:"success"}`
- **THEN** 客户端 MUST 返回 `data` 字段，不暴露包络细节

#### Scenario: 业务错误响应
- **WHEN** TAPD 返回 `{status:422, info:"company_id is required.", meta:{request_id:"abc"}}`
- **THEN** 客户端 MUST 抛出结构化错误，包含 `tapdStatus=422`、`info="company_id is required."`、`requestId="abc"`

### Requirement: 错误归一化映射
客户端 SHALL 将 TAPD 状态码映射为 MCP 工具的结构化错误类型：401→unauthenticated、403→permission_denied、404→not_found、422→invalid_argument、429→rate_limited、5xx→internal。

#### Scenario: 401 映射
- **WHEN** TAPD 返回 status=401
- **THEN** 客户端 MUST 抛出类型为 `unauthenticated`、提示包含"令牌无效或已过期"的错误

#### Scenario: 404 提示语义模糊
- **WHEN** TAPD 返回 status=404 与 info="workspace X not existed"
- **THEN** 客户端 MUST 抛出类型为 `not_found`、提示明确告知"资源不存在或当前令牌无权访问"，并保留 `requestId`

### Requirement: 限流与重试
客户端 SHALL 对 429 与 5xx 实施指数退避重试。429 重试上限 3 次，5xx 上限 2 次，退避基线 500ms，封顶 4s。4xx（除 429 外）MUST NOT 自动重试。

#### Scenario: 429 后退避重试
- **WHEN** 接收到首个 429 响应
- **THEN** 客户端 MUST 等待 ≥500ms 后重试，最多 3 次；最后一次仍 429 则向上层抛 `rate_limited`

#### Scenario: 422 不重试
- **WHEN** 接收到 422
- **THEN** 客户端 MUST 立即抛错，不重试

### Requirement: 全局并发与超时
客户端 SHALL 限制全局并发请求数（默认 8，可由 `TAPD_CONCURRENCY` 覆盖），并对单请求设置默认超时 30 秒（可由 `TAPD_TIMEOUT_MS` 覆盖）。

#### Scenario: 超出并发上限的请求被排队
- **WHEN** 同时发起 16 个请求且 `TAPD_CONCURRENCY=8`
- **THEN** 客户端 MUST 让其中 8 个排队等待，前面任意一个完成后再发起后续

#### Scenario: 超时
- **WHEN** 单请求 30s 内未收到响应
- **THEN** 客户端 MUST 取消该请求并抛 `internal` 错误，错误信息包含超时提示

### Requirement: 分页统一接口
客户端 SHALL 为 TAPD 列表接口提供统一的分页参数（`page`、`limit`），并将 TAPD 返回数组原样向上层透传；客户端 MUST NOT 在首版自动跨页聚合。

#### Scenario: 透传单页
- **WHEN** 上层传入 `page=2, limit=50`
- **THEN** 客户端 MUST 把这两个参数追加到 query 并返回 TAPD 单页结果

