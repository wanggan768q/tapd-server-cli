# tapd-web-client Specification

## Purpose
TBD - created by archiving change add-web-cookie-attachment-download. Update Purpose after archive.
## Requirements
### Requirement: 网页域 HTTP 客户端独立装配
系统 SHALL 在存在可用 cookie 时装配一个独立的 `TapdWebClient`，与 PAT 用的 `TapdHttpClient` 完全隔离（独立的 base URL、连接池、并发限制、错误形状）。Cookie 来源由 `CookieStore` 提供（优先 env，其次文件，否则不装配）。

`TapdWebClient` MUST 支持在 server 运行期内被替换（hot reload）：旧实例被 `close()` 释放，新实例由 `AttachmentRegistry.arm(newClient)` 装配并立即通过 `tools/list_changed` 通知客户端，无需重启 server 进程。

#### Scenario: 启动时无可用 cookie
- **WHEN** 环境变量与 cookie 文件都未提供 cookie
- **THEN** 系统 MUST NOT 装配 `TapdWebClient`
- **AND** `tapd.attachments.download` 工具 MUST NOT 注册
- **AND** `tapd.login` 与 `tapd.logout` 元工具 MUST 仍然注册（用户可通过登录工具开通能力）

#### Scenario: 启动时从文件加载 cookie
- **WHEN** `TAPD_WEB_COOKIE` 未设置但 `~/.config/tapd-mcp/cookie`（mode 600）存在
- **THEN** 系统 MUST 装配 `TapdWebClient` 使用文件 cookie，并注册 `tapd.attachments.download`

#### Scenario: 运行期热加载新 cookie
- **WHEN** server 当前未装配 `TapdWebClient`，用户调用 `tapd.login` 完成登录
- **THEN** 系统 MUST 装配一个新的 `TapdWebClient` 实例
- **AND** MUST 通过 `AttachmentRegistry.arm()` 注册 `tapd.attachments.download`
- **AND** MUST 立即发送 `tools/list_changed` 通知

#### Scenario: 运行期替换已装配的 cookie
- **WHEN** server 已装配 `TapdWebClient`，用户再次调用 `tapd.login`
- **THEN** 系统 MUST 关闭旧的 `TapdWebClient`（释放连接池）
- **AND** MUST 装配新的实例使用新 cookie
- **AND** `tapd.attachments.download` 工具的内部 webClient 引用 MUST 切换到新实例

#### Scenario: 运行期登出
- **WHEN** server 已装配 `TapdWebClient`，用户调用 `tapd.logout`
- **THEN** 系统 MUST 通过 `AttachmentRegistry.disarm()` 从 `_registeredTools` 中删除 `tapd.attachments.download`
- **AND** MUST 关闭旧的 `TapdWebClient`
- **AND** MUST 发送 `tools/list_changed`
- **AND** 后续调用 `tapd.attachments.download` MUST 返回 method not found（工具已不存在）

### Requirement: Cookie 注入与原样透传
`TapdWebClient` SHALL 在每次请求的 `Cookie` 头中原样写入 `TAPD_WEB_COOKIE` 的值；MUST NOT 解析、规范化或拆分单个 cookie 条目。

#### Scenario: 原样透传
- **WHEN** `TAPD_WEB_COOKIE='a=1; b="x=y"; c=%20'`
- **THEN** 请求头 `Cookie` 字段值 MUST 等于 `a=1; b="x=y"; c=%20`，无任何转义或重排

### Requirement: Cookie 失效检测
`TapdWebClient` MUST 把以下响应模式识别为 cookie 失效，并抛出 `TapdApiError(kind: 'unauthenticated', info 包含 "TAPD_WEB_COOKIE 已失效")`：

1. HTTP 200 + `Content-Length ≤ 2` + `content-type` 含 `text/html`；
2. 响应体起始 256 字节内含 `<title>登录-TAPD</title>`；
3. 请求 URL 路径含 `attachments/download` 且响应体起始为 `<!DOCTYPE html>`。

#### Scenario: 2 字节空响应被识别为失效
- **WHEN** 请求附件返回 `Content-Length: 2` 与 `Content-Type: text/html`
- **THEN** 客户端 MUST 抛 `unauthenticated`，提示包含 "TAPD_WEB_COOKIE 已失效"

#### Scenario: 登录页 HTML 被识别为失效
- **WHEN** 响应体起始含 `<title>登录-TAPD</title>`
- **THEN** 客户端 MUST 抛 `unauthenticated`

### Requirement: Cookie 凭据保护
系统 SHALL 把 `TAPD_WEB_COOKIE` 视同 PAT 同级凭据：MUST NOT 写入磁盘/缓存，MUST 在日志中完全 redact（不展示前后缀字符），生命周期不超过进程。

#### Scenario: debug 日志含请求头
- **WHEN** 日志级别为 debug 并记录到一次 web 请求
- **THEN** 日志条目中 `Cookie` 头字段值 MUST 完全被替换为 `***`，不得包含原 cookie 任何字符

### Requirement: 失败重试策略
`TapdWebClient` MUST 对 5xx 响应使用指数退避重试上限 2 次（与 PAT 客户端策略一致）；MUST NOT 自动重试 4xx（含 cookie 失效）。

#### Scenario: 5xx 重试后成功
- **WHEN** 第 1 次返回 502，第 2 次返回 200
- **THEN** 客户端 MUST 返回成功结果，且重试间至少等待 500ms

#### Scenario: cookie 失效不重试
- **WHEN** 触发失效检测
- **THEN** 客户端 MUST 立即抛 `unauthenticated`，不发起额外请求

### Requirement: 独立并发上限
`TapdWebClient` SHALL 使用独立的并发上限（默认 4，可由 `TAPD_WEB_CONCURRENCY` 覆盖），不与 PAT 客户端共享。

#### Scenario: web 并发不影响 PAT 并发
- **WHEN** web client 已有 4 个在途请求
- **THEN** 新发起的 PAT OpenAPI 请求 MUST 不被 web 队列阻塞

