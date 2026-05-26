## Why

TAPD（腾讯敏捷协作平台）是团队主要的需求/缺陷/迭代/工时管理系统，
但目前 AI 助手（Claude / Cursor 等）无法直接读写 TAPD 数据，
需要人工在 Web 端反复切换上下文。为打通"AI ↔ TAPD"链路，
本项目实现一个 MCP（Model Context Protocol）Server，
将 TAPD 开放 API 暴露为可被任意 MCP 客户端调用的工具集，
并采用**个人访问令牌**（personal access token）作为零配置的鉴权方式
——使个人开发者无需注册 TAPD 应用即可使用。

## What Changes

- 新增 TAPD MCP Server，以 stdio + streamable HTTP 方式启动，可被 Claude Code / Claude Desktop / Cursor 等 MCP 客户端集成。
- 通过个人访问令牌读取/写入 TAPD：令牌经环境变量 `TAPD_TOKEN`（或启动参数）注入，不在代码或日志中明文持久化。
- 覆盖 TAPD 官方 API 文档中**全部资源模块**的接口，包括但不限于：
  - 工作空间 / 项目 / 成员
  - 需求（stories）
  - 缺陷（bugs）
  - 任务（tasks）
  - 迭代（iterations）
  - 发布计划（releases）
  - 工时（timesheets / efforts）
  - 评论（comments）
  - 自定义字段 / 工作流 / 状态
  - 附件
  - 测试用例 / 测试计划（如文档涵盖）
  - Webhook 元数据查询
- **令牌权限自检与按需暴露**：服务启动或首次工具调用前，
  通过元接口探测当前令牌可访问的项目、模块与操作（读/写），
  仅向 MCP 客户端**暴露当前令牌确实可调用**的工具，
  对无权限的接口直接隐藏，避免客户端反复触发 403。
- 提供 `tapd.whoami` / `tapd.list_workspaces` / `tapd.list_capabilities`
  等内省工具，便于用户/客户端确认权限范围。
- 错误归一化：将 TAPD API 的 HTTP/业务错误统一映射为 MCP 工具的结构化错误，
  附带可读建议（如"令牌缺少 bug#read 权限"）。
- 文档与示例：提供 README、配置示例、典型使用案例（如"基于 PR 标题反查 TAPD 需求"）。

## Capabilities

### New Capabilities

- `tapd-auth`：个人访问令牌的加载、校验、生命周期管理；包含令牌权限探测、缓存与失效处理。
- `tapd-api-client`：对 TAPD 开放 API 的底层 HTTP 封装，统一处理鉴权头、请求签名（如需要）、分页、限流、重试与错误码。
- `tapd-resources`：将 TAPD 各资源模块（项目、需求、缺陷、任务、迭代、工时、评论、附件等）建模为可调用的 MCP 工具，每个资源支持文档中定义的所有读写操作。
- `tapd-permission-introspection`：基于当前令牌动态探测可访问的项目与操作集合；据此决定向 MCP 客户端注册哪些工具，并对调用结果做权限友好的错误提示。
- `mcp-server-runtime`：MCP Server 的进程入口、传输层（stdio / HTTP）、工具注册表、配置加载与日志。

### Modified Capabilities

- 无（首次提案，无既有 spec）。

## Impact

- **新建仓库**：当前工程除 `.git` 与 `CLAUDE.md` 外为空，本变更将引入完整的源码结构、依赖清单、配置示例与 CI 基线。
- **依赖**：将引入官方/社区 MCP SDK（具体语言与版本在 design.md 中决定）、HTTP 客户端、日志、可选的请求缓存层。
- **外部系统**：服务对 `https://api.tapd.cn`（及/或 `https://apiv2.tapd.tencent.com`）的出站调用；不持久化任何用户数据，仅在内存中缓存令牌权限快照。
- **安全**：个人访问令牌不会写入磁盘/日志；提供令牌脱敏与最小权限示例。
- **风险**：
  - TAPD 公开文档未明确 PAT 与 Basic Auth 的差异，需在 design 阶段实测确认鉴权格式与权限自检接口的可用性；若无标准 introspection 接口，将以"探针调用 + 结果缓存"方案兜底。
  - TAPD API 各资源字段差异较大，全量覆盖将带来较大的工具数量，需在 design 中考虑分组与按需加载策略。
