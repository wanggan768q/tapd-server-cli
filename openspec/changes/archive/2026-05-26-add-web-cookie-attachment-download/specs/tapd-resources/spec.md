## ADDED Requirements

### Requirement: 附件下载 URL 构造工具
系统 SHALL 注册 `tapd.attachments.get_download_url` 工具，根据 `workspace_id` / `attachment_id` / `type`（默认 `bug`）三个参数构造网页下载 URL `{TAPD_WEB_BASE}/{workspace_id}/attachments/download/{attachment_id}/{type}`，并原样返回；MUST NOT 发起网络请求；MUST NOT 依赖 `TAPD_WEB_COOKIE`。

#### Scenario: 构造 URL
- **WHEN** 调用 `tapd.attachments.get_download_url`，参数为 `{workspace_id: "61376769", attachment_id: "1161376769001048737", type: "bug"}`
- **THEN** 返回 MUST 包含 `url: "https://www.tapd.cn/61376769/attachments/download/1161376769001048737/bug"`

#### Scenario: 默认 type=bug
- **WHEN** 未传 `type` 参数
- **THEN** URL 末尾段 MUST 是 `bug`

### Requirement: 附件二进制下载工具
系统 SHALL 在 `TAPD_WEB_COOKIE` 已配置时注册 `tapd.attachments.download` 工具，使用 `TapdWebClient` 下载附件二进制；MUST 在 `TAPD_WEB_COOKIE` 未配置时不注册该工具。

#### Scenario: 未配置 cookie 时工具不可见
- **WHEN** 启动时 `TAPD_WEB_COOKIE` 未设置
- **THEN** MCP `tools/list` 返回 MUST NOT 包含 `tapd.attachments.download`

#### Scenario: 配置 cookie 后下载到本地
- **WHEN** `TAPD_WEB_COOKIE` 已配置，且调用 `tapd.attachments.download` 时传入 `save_to=/tmp/x.log`
- **THEN** 系统 MUST 把字节写入 `/tmp/x.log`，返回 `{path, content_type, bytes, sha256}`

#### Scenario: 未提供 save_to 时返回 base64
- **WHEN** 文件大小 ≤ 5 MB 且未传 `save_to`
- **THEN** 系统 MUST 返回 `{filename, content_type, bytes, base64}`

#### Scenario: 大文件强制 save_to
- **WHEN** 响应字节数 > 5 MB 且未传 `save_to`
- **THEN** 系统 MUST 抛 `invalid_argument`，错误信息明确说明 "文件 > 5 MB，请提供 save_to 参数"

#### Scenario: cookie 失效错误透传
- **WHEN** `TapdWebClient` 检测到 cookie 失效并抛 `unauthenticated`
- **THEN** 工具 MUST 把错误向上透传，包含可执行的刷新提示

### Requirement: 能力清单包含 cookie 装配状态
`tapd.list_capabilities` 的返回 MUST 包含字段 `web_client: { enabled: boolean, base: string }`，便于调用方判断附件下载能力是否可用。

#### Scenario: 未配置 cookie
- **WHEN** 调用 `tapd.list_capabilities` 且未设置 `TAPD_WEB_COOKIE`
- **THEN** 返回 MUST 含 `web_client.enabled === false`

#### Scenario: 已配置 cookie
- **WHEN** 已设置 `TAPD_WEB_COOKIE`
- **THEN** 返回 MUST 含 `web_client.enabled === true` 和 `web_client.base`（已脱去敏感字符的基地址）
