## ADDED Requirements

### Requirement: 资源覆盖范围
系统 SHALL 为 TAPD 官方 API 文档中列出的全部资源模块提供 MCP 工具封装，至少包括：stories（需求）、bugs（缺陷）、tasks（任务）、iterations（迭代）、releases（发布计划）、timesheets（工时）、comments（评论）、attachments（附件）、workflows（工作流/状态）、users（成员）、categories、modules、custom-fields。

#### Scenario: 工具完整性自检
- **WHEN** 启动后调用 `tapd.list_capabilities`
- **THEN** 返回的工具组 MUST 覆盖以上列出的每个资源模块（受令牌权限限制时可隐藏其中部分）

### Requirement: 工具命名约定
每个资源工具的名称 MUST 形如 `tapd.<resource>.<action>`，其中 `<resource>` 为复数 kebab-case 资源名，`<action>` 取 `list` / `get` / `create` / `update` / `delete` / `count` 等具名动作。

#### Scenario: stories 列表
- **WHEN** 注册需求列表查询工具
- **THEN** 其名称 MUST 是 `tapd.stories.list`

#### Scenario: 创建评论
- **WHEN** 注册创建评论工具
- **THEN** 其名称 MUST 是 `tapd.comments.create`

### Requirement: workspace_id 参数约束
所有需要 `workspace_id` 的资源工具，其 `workspace_id` 参数 schema MUST 在启动后被动态收紧为"当前令牌可访问的 workspace 白名单"的枚举值。

#### Scenario: 仅暴露白名单 workspace
- **WHEN** 当前令牌可访问 workspace 47384552 与 61376769
- **THEN** `tapd.stories.list` 的 `workspace_id` 参数 schema MUST 仅接受这两个值之一

#### Scenario: 调用未在白名单中的 workspace_id
- **WHEN** 客户端尝试传入 `workspace_id=99999999`
- **THEN** 工具 MUST 在请求前直接拒绝，返回 `invalid_argument` 错误并提示可选 workspace 列表

### Requirement: 字段透传与可选投影
资源 list/get 工具 MUST 默认返回 TAPD 原始字段（含 `custom_field_*`）。系统 SHALL 提供可选参数 `fields`（字符串数组），允许调用方按需投影返回字段。

#### Scenario: 默认全量返回
- **WHEN** 调用 `tapd.stories.list` 且未传 `fields`
- **THEN** 返回项 MUST 与 TAPD 原始 JSON 字段一致

#### Scenario: 投影
- **WHEN** 调用 `tapd.stories.list` 传 `fields=["id","name","status"]`
- **THEN** 返回项 MUST 只包含这三个字段（其它字段被过滤）

### Requirement: 写操作幂等性提示
对所有可能产生副作用的 `create` / `update` / `delete` 工具，工具描述（MCP `tool.description`）MUST 显式标注"写操作"以便 MCP 客户端做二次确认。

#### Scenario: 创建需求工具描述
- **WHEN** MCP 客户端调用 `tools/list`
- **THEN** `tapd.stories.create` 的 description MUST 以 "[写操作] " 前缀开头

### Requirement: 错误透传可读化
资源工具 MUST 在出错时附带 TAPD 返回的 `info` 字段与 `request_id`，并附加可读的中文建议（如"令牌可能缺少访问该项目的权限"）。

#### Scenario: 422 错误提示
- **WHEN** 调用 `tapd.bugs.create` 缺少必填字段
- **THEN** 错误 MUST 包含 TAPD 原文 `info`、`request_id` 与"请检查必填字段"的建议
