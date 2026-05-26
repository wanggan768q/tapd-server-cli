## ADDED Requirements

### Requirement: TAPD 登录工具
系统 SHALL 注册 MCP 工具 `tapd.login`，弹出隔离浏览器窗口让用户完成 TAPD 登录，自动抓取浏览器 cookie，持久化到 server 自有目录并热加载 `TapdWebClient` 与 `tapd.attachments.download` 工具，使新 cookie 立即生效，**无需重启 MCP 客户端或 server 进程**。

该工具 MUST 仅在 stdio 传输模式下可用；MUST 接受可选 `timeout_minutes` 参数（1..10，默认 5）；description MUST 明确告知 AI "仅在用户明确表达登录意图时调用，不要在 `unauthenticated` 错误后自动重试"。

#### Scenario: stdio 模式下成功登录
- **WHEN** server 以 stdio 模式运行，且用户在 MCP 客户端中调用 `tapd.login`
- **THEN** 工具 MUST spawn 一个隔离浏览器进程打开 TAPD 登录页
- **AND** 用户登录完成后 MUST 自动抓取 `.tapd.cn` 域全部 cookie 拼成 `name1=v1; name2=v2; ...` 形式
- **AND** MUST 通过 `cookie-store` 持久化到 `~/.config/tapd-mcp/cookie`（POSIX mode 600）
- **AND** MUST 装配新的 `TapdWebClient` 并通过 `AttachmentRegistry` 注册 `tapd.attachments.download`
- **AND** MUST 发送 `tools/list_changed` 通知客户端
- **AND** MUST 返回包含 `status: "ok"`、`cookie_count`、`cookie_file` 路径与 `tools_added: ["tapd.attachments.download"]` 的结构化结果

#### Scenario: HTTP 模式下拒绝调用
- **WHEN** server 启动时 `TAPD_MCP_HTTP_PORT` 已配置
- **AND** 客户端调用 `tapd.login`
- **THEN** 工具 MUST 立即返回 `invalid_argument` 错误，提示信息 MUST 包含 "stdio 传输" 与回退路径（env 变量或 `grab-cookie.mjs`）

#### Scenario: 未找到本机 Chrome 或 Edge
- **WHEN** 用户调用 `tapd.login` 但在常见路径（含 `LOCALAPPDATA`、Edge 备选）均未找到浏览器
- **THEN** 工具 MUST 返回 `invalid_argument` 错误
- **AND** 错误信息 MUST 包含 "请安装 Chrome / Edge 或回退到 TAPD_WEB_COOKIE / grab-cookie.mjs"

#### Scenario: 超时未登录
- **WHEN** 用户未在 `timeout_minutes`（默认 5）内完成登录或浏览器未出现 `t_i_token` cookie
- **THEN** 工具 MUST 终止 CDP 会话、SIGTERM 浏览器、清理临时 user-data-dir
- **AND** MUST 返回 `unauthenticated` 错误，提示 "超时未检测到 TAPD 登录态"

#### Scenario: env 与文件 cookie 共存
- **WHEN** `TAPD_WEB_COOKIE` 环境变量已设置且用户调用 `tapd.login`
- **THEN** 工具 MUST 完成登录并写入文件
- **AND** 返回结构 `env_cookie_warning` MUST 是非空字符串，明确说明 "env `TAPD_WEB_COOKIE` 仍存在，进程下次重启会优先使用 env 值"

### Requirement: TAPD 登出工具
系统 SHALL 注册 MCP 工具 `tapd.logout`，删除 server 自有目录中的 cookie 文件并销毁 `TapdWebClient`、注销 `tapd.attachments.download` 工具，使依赖 cookie 的能力立即对客户端不可见。

#### Scenario: 调用 tapd.logout
- **WHEN** MCP 客户端调用 `tapd.logout`
- **THEN** 系统 MUST 通过 `AttachmentRegistry.disarm()` 从 `_registeredTools` 中删除 `tapd.attachments.download`
- **AND** MUST 调用 `cookieStore.clear()` 删除 cookie 文件（如存在）
- **AND** MUST 发送 `tools/list_changed`
- **AND** MUST 返回 `{status: "ok", cookie_file_existed: <bool>, tools_removed: ["tapd.attachments.download"]}`

#### Scenario: 未登录状态下调用 logout
- **WHEN** cookie 文件不存在且 `tapd.attachments.download` 未注册
- **AND** 客户端调用 `tapd.logout`
- **THEN** 工具 MUST 返回 `status: "ok"`、`cookie_file_existed: false`、`tools_removed: []`（幂等）

### Requirement: Cookie 持久化路径
系统 SHALL 提供 `CookieStore` 模块负责 cookie 的加载、持久化与删除，文件默认位于 `~/.config/tapd-mcp/cookie`。

#### Scenario: 加载优先级
- **WHEN** server 启动
- **THEN** `CookieStore.load()` MUST 按顺序检查 `TAPD_WEB_COOKIE` 环境变量、`~/.config/tapd-mcp/cookie` 文件，返回首个非空源对应 `{value, source: 'env' | 'file'}`，否则返回 undefined

#### Scenario: 文件权限不安全
- **WHEN** POSIX 平台上 `~/.config/tapd-mcp/cookie` 存在但 mode 不是 600
- **THEN** `CookieStore.load()` MUST 返回 undefined（视同未配置）并在日志中输出 warn 级提示 "cookie 文件权限不安全，请 chmod 600"

#### Scenario: 原子写
- **WHEN** `CookieStore.save(value)` 被调用
- **THEN** 实现 MUST 先写 `<path>.tmp`，POSIX 平台 MUST 立即 chmod 600，然后 rename 到目标文件
- **AND** MUST NOT 留下任何已打开的文件句柄

## MODIFIED Requirements

### Requirement: 令牌不落盘
系统 MUST NOT 将 PAT 令牌写入服务自身的任何文件、缓存或持久存储；只允许在内存中保存且生命周期不超过进程。

对于 `TAPD_WEB_COOKIE` 凭据，**允许**持久化到 server 自有目录 `~/.config/tapd-mcp/cookie`（POSIX 平台 mode 600，Windows 平台依赖用户 profile 私有目录隔离），由 `CookieStore` 统一管理；不允许写入除该路径外的任何文件。

#### Scenario: PAT 不落盘
- **WHEN** 进程因任何原因终止
- **THEN** PAT 的所有副本 MUST 随之释放，无任何 PAT 临时文件残留

#### Scenario: Cookie 持久化到指定路径
- **WHEN** `tapd.login` 完成 cookie 抓取
- **THEN** cookie MUST 仅写入 `~/.config/tapd-mcp/cookie`，MUST NOT 写入 `~/.claude.json` 或其它任何位置（`scripts/grab-cookie.mjs` 是用户主动选择的兼容入口，不在此约束内）
- **AND** POSIX 平台上文件 mode MUST 是 600
