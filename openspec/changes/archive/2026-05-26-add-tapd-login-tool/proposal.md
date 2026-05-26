## Why

上一版 `add-web-cookie-attachment-download` 把附件下载落地了，但 cookie
**获取**这一步交给了用户跑命令行 `node scripts/grab-cookie.mjs`，并由脚本
直接写回 `~/.claude.json`。对非技术用户体验差，且让 MCP server 之外的
脚本去越权动客户端配置文件不是好的边界。

让 cookie 获取直接在 MCP 工具里完成 —— 用户在 Claude 里说一句"登录 TAPD"，
AI 调 `tapd.login`，MCP server 自己弹出隔离 Chrome、抓 cookie、热加载
`tapd.attachments.download` 工具，**不需要重启客户端**，**不动 `~/.claude.json`**。

## What Changes

- **新增 cookie 持久化**：写到 server 自身状态文件 `~/.config/tapd-mcp/cookie`
  （POSIX mode 600），cookie 来源优先级 `env TAPD_WEB_COOKIE` > 文件 > 未配置。
- **新增工具 `tapd.login`**（始终注册）：
  - 检测本机 Chrome / Edge → spawn 隔离窗口打开 TAPD 登录页 → CDP 轮询 cookie →
    持久化 + 热加载 `TapdWebClient` + 注册 `tapd.attachments.download` →
    发送 `tools/list_changed`。
  - HTTP 远程传输模式下拒绝调用（spawn 本地浏览器毫无意义）。
  - tool description 明确写"仅在用户明确要求登录时调用，不要在 unauthenticated 错误时自动重试"。
- **新增工具 `tapd.logout`**（始终注册）：删 cookie 文件 + 销毁 `TapdWebClient` +
  从内部表注销 `tapd.attachments.download` + 发送 `tools/list_changed`。
- **`grab-cookie.mjs` 降级**：保留作为 CI / 无 GUI / 兜底入口，README 重写
  推荐路径为 `tapd.login` 工具。
- **共享浏览器登录模块**：把 `scripts/grab-cookie.mjs` 的核心逻辑抽到
  `src/auth/browser-login.ts`（可被工具和脚本共用），保持单一可测的实现源。
- **`tapd.list_capabilities`** 输出增加 `web_client.cookie_source`
  （`env` / `file` / `none`）字段，便于排查。

## Capabilities

### Modified Capabilities

- `tapd-auth`：
  - cookie 凭据**允许**写盘到 server 自有路径 `~/.config/tapd-mcp/cookie`（仅 600 权限）；
    放宽原"令牌不落盘"要求 — PAT 仍不落盘，**cookie 落盘到 server 私有目录**。
  - cookie 加载优先级：`TAPD_WEB_COOKIE` env > `~/.config/tapd-mcp/cookie` 文件 > 未配置。
  - 新增 `tapd.login` / `tapd.logout` 工具规约。
- `tapd-web-client`：
  - `TapdWebClient` 允许运行期被替换（hot reload），不再只是启动期一次性装配。
- `mcp-server-runtime`：
  - 启动顺序"步骤 4 web client 装配"接受 env 与 cookie 文件两个来源。
  - 元工具 `tapd.list_capabilities` 输出新增 `cookie_source` 字段。

## Impact

- **依赖**：无新增（继续用 `undici` 的 WebSocket 做 CDP，`spawn` 做 Chrome）。
- **配置面**：新增 cookie 文件路径 `~/.config/tapd-mcp/cookie`（自动管理，用户无需手动写）。
- **安全**：cookie 文件 POSIX 600；Windows 上文件存在用户 profile 私有目录，
  与现有 PAT 文件路径模式一致；日志脱敏不变。
- **兼容性**：env `TAPD_WEB_COOKIE` 行为不变（优先级最高）；
  `grab-cookie.mjs` 行为不变（写 `~/.claude.json`）。两种旧路径都可继续使用。
- **运维**：MCP server 在 HTTP 远程模式下 `tapd.login` 会直接拒绝 — 强制本地 stdio 才能用。
- **风险**：
  - 在没有 GUI 的环境（CI / Docker）调 `tapd.login` 会失败 — 错误信息要明确指引
    "回退用 `grab-cookie.mjs` 或手动设置 `TAPD_WEB_COOKIE`"。
  - cookie 文件被多个 MCP server 进程共享时的竞争（罕见，但需要 atomic write）。
  - Chrome / Edge 都不在常见路径 → 错误返回明确的"装 Chrome 或手动配 cookie"提示。
