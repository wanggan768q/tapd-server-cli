## MODIFIED Requirements

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
