# tapd-auth Specification

## Purpose
TBD - created by archiving change init-tapd-mcp-server. Update Purpose after archive.
## Requirements
### Requirement: 令牌来源与优先级
系统 SHALL 按以下优先级解析 TAPD 个人访问令牌（PAT）：
1) 命令行参数 `--token`；
2) 环境变量 `TAPD_TOKEN`；
3) 用户级配置文件 `~/.config/tapd-mcp/token`（仅当该文件 mode 为 600 时读取）。

#### Scenario: 命令行参数覆盖环境变量
- **WHEN** 启动命令同时提供 `--token A` 与环境变量 `TAPD_TOKEN=B`
- **THEN** 服务 MUST 使用令牌 A

#### Scenario: 文件权限不安全时拒绝读取
- **WHEN** 仅存在配置文件且其权限不是 600（如 644）
- **THEN** 服务 MUST 退出并在 stderr 提示 "配置文件权限不安全，请 chmod 600"

#### Scenario: 完全未提供令牌
- **WHEN** 命令行、环境变量、配置文件均无令牌
- **THEN** 服务 MUST 以非零退出码（78 EX_CONFIG）终止，并在 stderr 输出清晰的获取令牌指引

### Requirement: 启动时令牌验证
服务 SHALL 在启动阶段调用 `GET /users/info` 验证令牌有效性，失败则立即终止进程。

#### Scenario: 令牌有效
- **WHEN** 令牌正确
- **THEN** 服务 MUST 缓存返回的 `user.id`、`user.name`、`user.current_company_id` 并继续启动

#### Scenario: 令牌无效
- **WHEN** `/users/info` 返回 status=401
- **THEN** 服务 MUST 以退出码 78 终止，并在 stderr 提示 "TAPD 令牌无效或已过期"

### Requirement: 令牌脱敏
系统 MUST NOT 在日志、错误信息、`tapd.whoami` 等输出中暴露完整令牌；展示形式为 "前 4 字符 + `***` + 后 4 字符"。

本要求同时适用于 `TAPD_WEB_COOKIE` 凭据，但因 cookie 通常超过 200 字符且不便提供识别性预览，cookie 在所有输出中 MUST 完全替换为 `***`，不展示任何字符片段。

#### Scenario: 在 debug 日志中输出令牌相关信息
- **WHEN** 日志级别为 debug 且记录到鉴权头
- **THEN** 输出 MUST 形如 `b572***1f73`，不得包含完整 PAT

#### Scenario: 在 debug 日志中输出 Cookie 请求头
- **WHEN** 日志级别为 debug 且 web client 发出一次请求
- **THEN** 输出中 `Cookie` 字段值 MUST 是 `***`，不得包含 cookie 任何字符

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

### Requirement: 身份内省工具
系统 SHALL 注册 MCP 工具 `tapd.whoami`，返回当前令牌对应的用户身份（id、name、email、current_company_id），令牌本身脱敏。

#### Scenario: 调用 tapd.whoami
- **WHEN** MCP 客户端调用 `tapd.whoami`
- **THEN** 返回字段必须包含 `user_id`、`user_name`、`current_company_id` 与脱敏后的 `token_preview`

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

### Requirement: install 子命令的 PAT 输入路径
`tapd-server-cli install <client>` 子命令在收集 TAPD 个人访问令牌时 MUST 优先使用交互式提示（隐藏输入），仅在非 tty 场景下回退到 `TAPD_TOKEN` 环境变量。系统 MUST NOT 接受 `--token <pat>` CLI flag，以避免 PAT 进入 shell history 与进程参数。

#### Scenario: tty 场景默认交互式
- **WHEN** `process.stdin.isTTY === true`，用户执行 `install claude-code`
- **THEN** 进程 MUST 在 stdout 提示 `TAPD 个人访问令牌（PAT）:`
- **AND** 用户输入的字符 MUST NOT 回显（muted input）
- **AND** 输入结果 MUST 通过 trim 后写入目标客户端配置的 `env.TAPD_TOKEN` 字段

#### Scenario: 非 tty 场景使用 env
- **WHEN** `process.stdin.isTTY` 为 falsy（如 `npx ... | tee`）且 `TAPD_TOKEN` 环境变量非空
- **THEN** 进程 MUST 使用 env 值作为 PAT 写入配置
- **AND** stdout MUST 打印 "从 TAPD_TOKEN 环境变量读取 PAT"

#### Scenario: 非 tty 场景且未配置 env
- **WHEN** `process.stdin.isTTY` 为 falsy 且 `TAPD_TOKEN` 环境变量为空
- **THEN** 进程 MUST 以非零退出码终止
- **AND** stderr MUST 输出指引："在非 tty 环境下请通过 TAPD_TOKEN=<pat> tapd-server-cli install <client> 提供令牌"

#### Scenario: 拒绝 --token flag
- **WHEN** 用户执行 `tapd-server-cli install claude-code --token <pat>`
- **THEN** commander MUST 把 `--token` 识别为未知参数并退出
- **AND** stderr MUST 给出说明："出于安全考虑不接受 --token，请用交互式输入或 TAPD_TOKEN env"

