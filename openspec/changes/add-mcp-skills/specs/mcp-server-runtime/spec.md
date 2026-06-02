## MODIFIED Requirements

### Requirement: 启动顺序

系统 MUST 按以下顺序完成启动：
1) 加载并验证配置；
2) 校验令牌（`/users/info`）；
3) 拉取 workspace 白名单（`/workspaces/user_participant_projects`）；
4) **可选**：通过 `CookieStore.load()` 解析 cookie 来源（env > 文件 > 无）；若得到非空值则装配 `TapdWebClient`（MUST NOT 发起网络验证）并通过 `AttachmentRegistry.arm()` 注册 `tapd.attachments.download`；
5) 注册元工具与资源工具，**始终包含** `tapd.login` 与 `tapd.logout`（不依赖 cookie 状态）；
6) 绑定 MCP 传输；
7) **新增**：在 stdio 握手就绪后**异步**写 `~/.tapd/cache.json`（identity 来自步骤 2，workspaces 来自步骤 3）。写入失败 MUST 仅 warn 日志，MUST NOT 影响 server 可用性。

任何 1-3 或 5-6 步骤失败 MUST 中止后续步骤；步骤 4 内部不允许失败（不发请求 → 没有可失败的事）；步骤 7 失败 MUST NOT 影响 1-6 的成功。

#### Scenario: 令牌验证失败终止

- **WHEN** 步骤 2 返回 401
- **THEN** 系统 MUST 不进入步骤 3 及之后，并以非零退出码终止

#### Scenario: 未设置 cookie 时跳过装配

- **WHEN** `CookieStore.load()` 返回 undefined
- **THEN** 步骤 4 MUST 跳过 `TapdWebClient` 装配
- **AND** 步骤 5 注册的工具集 MUST 包含 `tapd.login` 与 `tapd.logout`
- **AND** MUST NOT 包含 `tapd.attachments.download`

#### Scenario: 从文件加载 cookie

- **WHEN** `TAPD_WEB_COOKIE` 未设置但 `~/.config/tapd-mcp/cookie` 存在且权限合规
- **THEN** 步骤 4 MUST 装配 `TapdWebClient` 使用文件 cookie
- **AND** 启动日志 MUST 包含 `cookie_source: 'file'`

#### Scenario: env 优先于文件

- **WHEN** `TAPD_WEB_COOKIE` 与 cookie 文件同时存在
- **THEN** 步骤 4 MUST 使用 env 值装配
- **AND** 启动日志 MUST 包含 `cookie_source: 'env'`

#### Scenario: 步骤 7 异步写 cache.json

- **WHEN** 步骤 6 完成、stdio 握手就绪
- **THEN** 系统 MUST 异步执行 cache.json 写入，不阻塞首个 MCP 请求处理
- **AND** 写入内容 MUST 至少包含 `schemaVersion`、`writtenAt`、`identity`、`workspaces` 字段

#### Scenario: cache.json 写入失败仅 warn

- **WHEN** 步骤 7 写文件时遇到磁盘只读 / 路径不可写 / 序列化失败
- **THEN** 系统 MUST 不抛错中止
- **AND** stderr 日志 MUST 包含一条 `level:"warn"` + `msg:"cache_write_failed"` 条目（含原因）
- **AND** server MUST 继续正常处理 MCP 请求

#### Scenario: knownUsers 增量写入

- **WHEN** 模型通过 skill 调用 `tapd_users_list` 解析得到一个新的 user 名/ID 映射
- **THEN** server 端 MUST 把该 user 写入 `~/.tapd/cache.json:knownUsers`，并以 `tapdUserId` 去重
- **AND** 写入 MUST 是原子的（tmp 文件 + rename）
- **AND** 写入失败 MUST 仅 warn 日志，不影响该工具调用的返回结果
