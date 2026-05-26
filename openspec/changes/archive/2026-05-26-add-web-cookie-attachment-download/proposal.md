## Why

OpenAPI 路径下的附件下载 (`api.tapd.cn/attachments/get_attachment_download_url`)
要求 PAT 拥有 `attachments::get_attachment_download_url` scope，
**非 TAPD 管理员的用户无法自助开通该 scope**。但 TAPD 网页端
(`www.tapd.cn/{ws}/attachments/download/{id}/{type}`) 通过浏览器登录态
（session cookie）可以下载，**用户已经登录 → 用户已经有这个能力**。

让 MCP server "借用"用户已经获得的浏览器 session cookie，
通过 cookie 鉴权调网页路径下载附件，是不要求管理员介入、
不要账号密码、不绕 SSO 的最低成本方案。

> 已经否决的备选：
> - **账号密码模拟登录**：触发 SSO/二次验证、账号风控、ToS 风险，撤销代价大；
> - **`@tencent/tapd-node-sdk`**：经多路验证不存在；公开生态没有 TAPD OpenAPI 的 NodeJS SDK；
> - **`@tapd/tplugin-cli`**：是插件脚手架，不是数据 API 客户端，无附件下载能力。

## What Changes

- 新增配置项 `TAPD_WEB_COOKIE`（必填以启用此能力）与 `TAPD_WEB_BASE`（默认 `https://www.tapd.cn`）。
- 新增 HTTP 客户端模块 `tapd-web-client`：与 OpenAPI 客户端**完全独立**，
  使用 cookie 鉴权调 `www.tapd.cn` 域，专门用于附件二进制下载等
  非 OpenAPI 接口。
- 在 `tapd-resources` 的 `attachments` 资源上新增两个动作：
  - `tapd.attachments.download` —— 用 web client 下载附件二进制；
    在 stdio 模式下要求 `save_to`（写到本地文件返回路径），
    HTTP 模式下默认返回 base64 内嵌内容（限大小，超过则强制 `save_to`）。
  - `tapd.attachments.get_download_url` —— 仅返回构造好的 URL，不调网络，**不需要 cookie**。
- 仅当 `TAPD_WEB_COOKIE` 配置时才注册 `tapd.attachments.download`；
  未配置时此工具对客户端不可见，避免误导。
- 检测 cookie 失效（响应是登录页 HTML 或 2 字节空响应）→ 返回
  `unauthenticated` 错误，提示「TAPD_WEB_COOKIE 已过期，请刷新」。
- 日志同时对 PAT 与 cookie 做脱敏（cookie 是凭据，等同于 PAT 处理）。
- README 增加 cookie 提取步骤与过期影响说明。

## Capabilities

### New Capabilities

- `tapd-web-client`：基于 session cookie 的 `www.tapd.cn` 域 HTTP 客户端；专门服务于 OpenAPI 不能覆盖或 PAT 权限不足的接口（首版仅附件下载）。

### Modified Capabilities

- `tapd-resources`：在 `attachments` 资源上新增 `download` 与 `get_download_url` 两个动作。
- `mcp-server-runtime`：启动顺序在「注册工具」之前增加可选的「web client 装配」步骤（仅当 `TAPD_WEB_COOKIE` 已配置）；新增配置项校验。
- `tapd-auth`：脱敏要求扩展到 cookie；不可落盘要求扩展到 cookie。

## Impact

- **依赖**：无新增（继续用 `undici`）。
- **配置面**：新增 2 个环境变量（`TAPD_WEB_COOKIE`、`TAPD_WEB_BASE`）。
- **安全**：cookie 视同 PAT 同级凭据 — 内存保存、日志脱敏、不落盘。
- **运维**：cookie 会过期（通常几小时到几天），用户需重新提取；本变更**不**做自动刷新。
- **与现有功能兼容**：未设置 cookie 时行为不变；已注册的 OpenAPI 工具不受影响。
- **风险**：
  - cookie 过期检测启发式（HTML 含 `<title>登录-TAPD</title>` 或响应 ≤ 2 字节）— 边缘情况可能漏判；
  - 同一用户在多浏览器登录可能轮换 cookie，单 MCP 进程的缓存 cookie 不受影响（直接 401 后报错重新粘贴）；
  - TAPD 改网页路由会破坏此能力 — 实测时把 URL 模式记录在 spec 中。
