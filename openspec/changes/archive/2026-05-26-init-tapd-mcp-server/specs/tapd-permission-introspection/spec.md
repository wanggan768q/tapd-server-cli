## ADDED Requirements

### Requirement: 启动时 workspace 白名单加载
系统 SHALL 在启动阶段调用 `GET /workspaces/user_participant_projects` 加载当前令牌可访问的全部 workspace（含 id、name、category=organization|project），并将该清单作为权限决策的单一可信来源。

#### Scenario: 拉取成功
- **WHEN** `/workspaces/user_participant_projects` 返回包含 workspace 47384552、61376769
- **THEN** 系统 MUST 将这两个条目缓存进权限快照并据此动态裁剪工具参数 enum

#### Scenario: 拉取失败
- **WHEN** 调用 `/workspaces/user_participant_projects` 返回非 status=1
- **THEN** 服务 MUST 退出（exit code 78），错误信息提示"无法获取令牌可访问的 workspace 列表"

### Requirement: 资源读权限懒探针
对每个 (resource, workspace_id) 组合，系统 SHALL 在该资源工具首次被调用前用 `?limit=1` 探针调用确认读权限；探针结果缓存 TTL 默认 600 秒（由 `TAPD_PERMISSION_TTL_SEC` 覆盖）。

#### Scenario: 首次调用前探针
- **WHEN** 客户端首次调用 `tapd.bugs.list` 且 (bugs, workspace_id) 尚无探针缓存
- **THEN** 系统 MUST 先发一次 `GET /bugs?workspace_id=...&limit=1`；探针成功后才放行真实调用

#### Scenario: 探针结果缓存
- **WHEN** 同一 (resource, workspace_id) 在 TTL 内被再次访问
- **THEN** 系统 MUST 直接使用缓存的允许/拒绝结论，不重新探针

### Requirement: 写权限按需失效缓存
系统 MUST NOT 对写操作主动探针。当 `create`/`update`/`delete` 工具调用返回 403 或语义等价的拒绝时，系统 SHALL 把 (resource, workspace_id, write) 标记为不可用并缓存 3600 秒。

#### Scenario: 写失败后短期不可用
- **WHEN** `tapd.bugs.create` 在 workspace 61376769 上调用返回 403
- **THEN** 后续 1 小时内对该 (resource, workspace_id) 的写工具 MUST 在请求前直接拒绝，提示"该令牌在此 workspace 不具备写 bugs 的权限"

### Requirement: 工具注册随权限快照更新
系统 SHALL 在权限快照变化（启动加载 / 手动刷新 / 探针结果新增）后，通过 MCP `notifications/tools/list_changed` 通知客户端，使其可重新拉取 `tools/list`。

#### Scenario: 启动后首次完成快照
- **WHEN** 启动加载 + 元工具就绪
- **THEN** 系统 MUST 立即发送一次 `tools/list_changed`，让客户端获得带 enum 的 workspace_id 参数

### Requirement: 元工具：列出可访问 workspace
系统 SHALL 注册 `tapd.list_workspaces` 工具，返回当前权限快照中的 workspace（id、name、category），并标注每条记录的快照时间。

#### Scenario: 调用 tapd.list_workspaces
- **WHEN** MCP 客户端调用 `tapd.list_workspaces`
- **THEN** 返回数组 MUST 与 `/workspaces/user_participant_projects` 的当前内存快照一致

### Requirement: 元工具：列出已注册能力
系统 SHALL 注册 `tapd.list_capabilities` 工具，返回当前已对客户端可见的工具列表、按资源分组、并标注每个工具的权限来源（白名单/探针/写失败缓存）。

#### Scenario: 调用 tapd.list_capabilities
- **WHEN** 客户端调用该工具
- **THEN** 返回结构 MUST 至少包含 `tools: Array<{name, resource, action, allowed_workspaces}>`、`snapshot_at: ISO8601`

### Requirement: 元工具：手动刷新权限
系统 SHALL 注册 `tapd.refresh_permissions` 工具，调用后立即清空读探针缓存与写失败缓存，并重新拉取 workspace 白名单。

#### Scenario: 手动刷新
- **WHEN** 客户端调用 `tapd.refresh_permissions`
- **THEN** 系统 MUST 重新调用 `/workspaces/user_participant_projects` 并发送 `tools/list_changed` 通知
