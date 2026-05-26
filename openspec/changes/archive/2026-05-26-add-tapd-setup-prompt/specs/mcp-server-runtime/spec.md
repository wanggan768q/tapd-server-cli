## ADDED Requirements

### Requirement: MCP Prompt 注册
系统 SHALL 通过 `McpServer.registerPrompt` 注册名为 `setup` 的 MCP prompt，作为新用户安装后零记忆的首次设置 / 状态诊断入口。该 prompt MUST 在 server 启动期注册，MUST NOT 依赖 PAT 或 cookie 状态。

#### Scenario: prompt 在启动后可被列出
- **WHEN** MCP 客户端在 server 启动后发送 `prompts/list` 请求
- **THEN** 响应 MUST 包含名为 `setup` 的条目
- **AND** 该条目 MUST 携带非空的 `title` 与 `description`

#### Scenario: 客户端 prompts/get 拿到引导内容
- **WHEN** MCP 客户端发送 `prompts/get` 请求 `name: "setup"`
- **THEN** 响应 `messages` MUST 是长度为 1 的数组
- **AND** `messages[0].role` MUST 是 `"user"`
- **AND** `messages[0].content.type` MUST 是 `"text"`
- **AND** `messages[0].content.text` MUST 同时包含字符串 `tapd.whoami`、`tapd.list_capabilities`、`tapd.login`

#### Scenario: 在 cookie 未配置状态下调用
- **WHEN** server 启动时无可用 cookie，客户端调用 `setup` prompt
- **THEN** prompt MUST 仍正常返回（prompt 注册不依赖 cookie 状态）
- **AND** 返回文本 MUST 显式引导 AI 调用 `tapd.login` 完成登录

#### Scenario: 在已登录状态下重复调用
- **WHEN** server 已装配 webClient（cookie 来自 env 或文件），客户端再次调用 `setup` prompt
- **THEN** prompt MUST 仍正常返回相同文本
- **AND** 文本 MUST 包含让 AI 通过 `tapd.list_capabilities` 检查当前状态后再决定是否触发登录的指引（避免在已登录状态下擅自重新弹浏览器）
