## Context

本项目从空仓库起步实现 TAPD MCP Server。proposal.md 已定义五个能力：
`tapd-auth` / `tapd-api-client` / `tapd-resources` /
`tapd-permission-introspection` / `mcp-server-runtime`。

**PAT 探测实验结论**（已用真实令牌验证 `https://api.tapd.cn`）：

| 维度 | 结论 |
|---|---|
| 鉴权头 | `Authorization: Bearer <PAT>` |
| 身份接口 | `GET /users/info` → `{id, name, email, current_company_id}` |
| 权限元接口 | `GET /workspaces/user_participant_projects` → 当前令牌可访问的 workspace 列表（含 category=organization\|project） |
| 业务接口示例 | `GET /stories`、`/bugs`、`/iterations`，参数 `workspace_id`、`limit` |
| 响应包络 | 成功 `{status:1, data, info:"success"}`；失败 `{status:<code>, data:"", info:"<msg>", meta:{request_id}}` |
| 权限边界 | 无权访问的 workspace 返回 **404 "workspace X not existed"**（不区分"不存在"与"无权限"） |

利益相关者：当前为单个开发者（项目 owner），未来可能扩展至团队。

约束：
- 必须遵守 `CLAUDE.md` 本地规则：涉及 TAPD 接口语义时以官方文档为准。
- 令牌不得明文落盘或写入日志。
- TAPD 文档为 SPA，自动化爬取困难；接口语义需结合探测 + 文档人工校对。

## Goals / Non-Goals

**Goals：**

1. 提供一个可被 Claude Code / Cursor / Claude Desktop / OpenCode / Codex 集成的 MCP Server，零配置启动（仅需 `TAPD_TOKEN`）。
2. 覆盖 TAPD 官方文档列出的全部资源模块的读写接口，并以一致的 MCP 工具命名暴露。
3. **基于令牌实际权限按需注册工具**：仅暴露令牌可调用的工具，避免客户端面对一堆 403/404。
4. 提供令牌内省工具（`tapd.whoami` / `tapd.list_workspaces` / `tapd.list_capabilities` / `tapd.refresh_permissions`），便于排查权限问题。
5. 统一错误归一化与可读错误提示。
6. 单进程、单令牌：服务实例与令牌一一绑定。

**Non-Goals（首版不做）：**

- 多租户 / 多令牌共享一个进程。
- 应用 ID + 应用秘钥（Basic Auth）模式 —— 仅支持 PAT。
- TAPD Webhook 接收端（仅消费 TAPD REST API）。
- 持久化缓存（数据库）—— 仅内存缓存权限快照。
- 写入操作的 dry-run / 预览能力。
- 富文本字段（HTML description）的渲染或转换 —— 透传原始字符串。

## Decisions

### D1. 技术栈：Node.js (>= 20) + TypeScript

**Why：**

- TAPD 官方提供 Node.js SDK（虽然首版不直接依赖），表明 Node 生态在该领域成熟。
- `@modelcontextprotocol/sdk` 的 TypeScript 实现最完整，参考实现最多。
- 单文件分发友好（pkg/esbuild），便于个人开发者 `npx tapd-mcp` 启动。

**Alternatives 考虑过：**

- Python：MCP SDK 也成熟，但分发体验（venv / pyproject）对最终用户更重。
- Go：分发极佳但 MCP 生态相对薄、迭代成本高。

### D2. MCP SDK：`@modelcontextprotocol/sdk`（官方）

**Why：** 官方维护、文档最全、跨编辑器兼容性最好。

**Alternatives：** 社区轻量 fork（如 `fastmcp`） —— 暂不采用，避免锁定。

### D3. HTTP 客户端：`undici`

**Why：**
- Node 原生级性能与 keep-alive。
- 内建 `Dispatcher` 抽象，便于注入重试 / 限流 / 日志中间件。
- 比 axios 体积小、ESM 友好。

**Alternatives：** 原生 fetch（Node 20+）—— 缺乏精细 keep-alive 与拦截器控制。

### D4. 鉴权策略：Bearer Token，单一来源

- 启动时按以下优先级读取令牌：`--token <pat>` CLI 参数 > 环境变量 `TAPD_TOKEN` > 用户级配置文件 `~/.config/tapd-mcp/token`（仅当文件权限 600）。
- 令牌仅保存在内存。
- 启动时立即调用 `/users/info` 验证；失败则进程立刻退出（exit code 78 EX_CONFIG），错误指引明确。
- 日志中对令牌严格脱敏：`b572***1f73`（前 4 + *** + 后 4）。

### D5. 权限探测分两层

**Layer 1：Workspace 白名单（启动时一次）**

- 调用 `/users/info` + `/workspaces/user_participant_projects`。
- 把可访问的 workspace（id + name + category）缓存在内存。
- 所有需要 `workspace_id` 参数的工具，参数 schema 的 `enum` 字段动态设为白名单 → MCP 客户端 UI 直接渲染下拉。

**Layer 2：资源/操作能力探针（按需 + 缓存）**

- 每个资源类型（stories/bugs/iterations/...）维护一个能力矩阵：`{ read: boolean, write: boolean | unknown }`。
- **读权限**：第一次访问时用 `?limit=1` 探针调用；结果缓存 TTL=10 分钟。
- **写权限**：不主动探针（不能误创建数据）。改为：
  - 默认按 `unknown` 注册写工具；
  - 调用失败（status=403 或类似）时，把该资源 + 工作空间标记为 `write=false`，缓存 1 小时；
  - 提供 `tapd.refresh_permissions` 工具手动清缓存。
- 由于 TAPD 把"无权限"和"不存在"都映射为 404 "not existed"，启动时只信任 `user_participant_projects` 返回的清单作为权限边界。

### D6. 工具注册策略

- **常驻元工具**（永远注册，与令牌权限无关）：
  - `tapd.whoami`
  - `tapd.list_workspaces`
  - `tapd.list_capabilities`（返回当前注册的工具集 + 权限快照时间戳）
  - `tapd.refresh_permissions`
- **资源工具**：在 MCP `tools/list` 阶段动态过滤；客户端调用 `tools/list` 时返回的工具集恰好等于"令牌能用的工具"。
- **更新通知**：调用 `tapd.refresh_permissions` 后，通过 MCP 的 `notifications/tools/list_changed` 通知客户端刷新。

### D7. 错误归一化

把 TAPD 响应统一映射为 MCP 工具的结构化错误：

| TAPD `status` | HTTP code | MCP 错误类型 | 客户端提示 |
|---|---|---|---|
| 1 | 200 | （成功） | data 透传 |
| 401 | 401 | `unauthenticated` | "TAPD 令牌无效或已过期，请检查 TAPD_TOKEN" |
| 403 | 403 | `permission_denied` | "当前令牌没有访问 {资源} 的权限" |
| 404 | 404 | `not_found` | "资源不存在或当前令牌无权访问"（注意：404 不区分两者） |
| 422 | 422 | `invalid_argument` | 透传 `info` 字段 |
| 429 | 429 | `rate_limited` | 携带 `retry_after`（如响应头有），客户端可重试 |
| 5xx | 5xx | `internal` | "TAPD 服务暂时不可用 (request_id={...})" |

请求 ID（`meta.request_id`）始终带在错误中以便排查。

### D8. 限流与重试

- 默认全局并发 = 8（保守），可通过 `TAPD_CONCURRENCY` 覆盖。
- 429 触发指数退避重试（最多 3 次，base=500ms，cap=4s）。
- 5xx 重试 2 次；4xx（除 429 外）不重试。

### D9. 资源建模：分组工具命名

避免一个 MCP 进程注册上百个零散工具，按资源分组并采用动作命名：

```
tapd.stories.list         tapd.stories.get        tapd.stories.create      tapd.stories.update
tapd.bugs.list            tapd.bugs.get           tapd.bugs.create         tapd.bugs.update
tapd.iterations.list      tapd.iterations.get     ...
tapd.tasks.list           ...
tapd.timesheets.list      tapd.timesheets.create  ...
tapd.releases.list        tapd.releases.get       ...
tapd.comments.list        tapd.comments.create    ...
tapd.attachments.list     tapd.attachments.get
tapd.workflows.get_states tapd.workflows.transitions
tapd.users.list           tapd.users.get          ← 注意与 tapd.whoami 区分
```

具体清单在 specs 阶段对照 TAPD 文档逐资源落实。

### D10. 目录结构

```
tapd-mcp-server-gstm/
├─ src/
│  ├─ index.ts                     # 进程入口
│  ├─ config.ts                    # 配置加载（token、并发、log level）
│  ├─ runtime/
│  │   ├─ server.ts                # MCP Server 装配
│  │   ├─ transports.ts            # stdio + (可选) streamable HTTP
│  │   └─ logger.ts                # 脱敏日志
│  ├─ auth/
│  │   ├─ token.ts                 # PAT 读取 + 脱敏
│  │   └─ identity.ts              # /users/info 封装
│  ├─ api/
│  │   ├─ client.ts                # undici 封装：鉴权、超时、重试、限流
│  │   ├─ errors.ts                # TAPD → MCP 错误映射
│  │   └─ paging.ts                # 通用分页
│  ├─ permissions/
│  │   ├─ workspaces.ts            # workspace 白名单
│  │   ├─ probe.ts                 # 资源能力探针 + 缓存
│  │   └─ snapshot.ts              # 权限快照对象
│  ├─ resources/
│  │   ├─ stories.ts
│  │   ├─ bugs.ts
│  │   ├─ iterations.ts
│  │   ├─ tasks.ts
│  │   ├─ timesheets.ts
│  │   ├─ releases.ts
│  │   ├─ comments.ts
│  │   ├─ attachments.ts
│  │   ├─ workflows.ts
│  │   └─ users.ts
│  └─ tools/
│      ├─ register.ts              # 按权限快照动态注册
│      └─ meta.ts                  # whoami / list_workspaces / ...
├─ test/
│  ├─ unit/                        # 错误映射、分页、脱敏
│  └─ integration/                 # 用真实 PAT 跑（CI 中通过 secret 注入）
├─ scripts/
│  └─ probe-api.sh                 # 手工探测脚本（沿用本阶段成果）
├─ package.json
├─ tsconfig.json
├─ .env.example
└─ README.md
```

### D11. 配置项

| 名称 | 默认 | 说明 |
|---|---|---|
| `TAPD_TOKEN` | （必需） | 个人访问令牌 |
| `TAPD_API_BASE` | `https://api.tapd.cn` | 允许覆盖（私有部署） |
| `TAPD_CONCURRENCY` | 8 | 全局并发 |
| `TAPD_TIMEOUT_MS` | 30000 | 单请求超时 |
| `TAPD_LOG_LEVEL` | `info` | trace/debug/info/warn/error |
| `TAPD_PERMISSION_TTL_SEC` | 600 | 权限探针缓存 TTL |
| `TAPD_MCP_HTTP_PORT` | （未设置则禁用 HTTP） | 启用 streamable HTTP 传输 |

### D12. 测试策略

- **单元测试**（不依赖网络）：错误映射、分页、脱敏、参数 schema 生成。
- **集成测试**（依赖 PAT）：固定打 `/users/info`、`/workspaces/user_participant_projects`、`/stories?limit=1`、错误路径（无效 workspace_id），断言响应包络。
- 集成测试在 CI 中使用 GitHub Secrets 注入 `TAPD_TOKEN`；本地通过 `.env`。
- 不写 mock TAPD —— TAPD 响应字段繁杂（200+ custom_field），mock 容易与真实分歧；改用真实 + 录制（VCR 模式）作为可选回归层。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| TAPD 把"不存在"和"无权限"都映射为 404，无法精准判断权限 | 以 `/workspaces/user_participant_projects` 返回的清单为单一权限源；workspace 参数用 enum 限定，从源头避免 404 |
| 写操作无法预探针，可能在调用瞬间才发现无权限 | 设计 `permission_denied` 错误的友好提示；缓存失败结果 1 小时；提供 `refresh_permissions` 手动清缓存 |
| 工具数量随资源增加可能让 MCP 客户端 UI 杂乱 | 按资源分组命名（`tapd.<resource>.<action>`）；同时 `tapd.list_capabilities` 提供"目录视图" |
| TAPD 文档为 SPA，自动化获取困难，部分接口语义可能不完整 | 在 specs 阶段对照真实接口响应字段固化；CLAUDE.md 已强制"以官方文档为准" |
| TAPD 自定义字段多（custom_field_1..200），全量透传可能产生噪音 | 默认透传；提供 `fields` 参数让调用方按需投影；list 工具默认裁剪到核心字段 |
| 个人令牌泄露风险 | 脱敏日志；不持久化；启动校验后立即丢弃明文中间变量；README 强制配置 `.gitignore` 模板 |
| TAPD 速率限制策略未公开 | 默认低并发 + 指数退避；后续根据真实拒绝情况调整 |
| Node 20+ 要求可能阻挡部分老环境 | 在 README + `engines` 字段显式声明；提供 `npx` 直接拉起的入口 |

## Migration Plan

- 首版无既有部署，无迁移问题。
- 后续若引入应用 Basic Auth：在 `auth/` 增加二级策略，对外保持工具命名稳定。
- 版本号采用 SemVer；工具命名稳定性视为公开 API（破坏性更名需 major 版本）。
- 回滚：服务无状态，重新发布前一版本即可。

## Open Questions

1. **写权限探针是否做轻量 dry-run？** 当前结论"不做"，等首版上线后看 403 实际比例再决定。
2. **是否支持私有化部署 TAPD 的非标准域名？** 已在 D11 留 `TAPD_API_BASE` 钩子，未来通过 issue 验证。
3. **是否需要在 `tapd.list_capabilities` 中给出可读的工具分组树？** 倾向"是"，但优先级排在首版之后。
4. **附件上传/下载的字节流如何在 MCP 工具语义里表达？** 需对照 MCP 规范的 `resources/binary content` 章节；specs 阶段进一步明确。
5. **是否要给 stories/bugs 等长列表查询提供"自动翻页聚合"工具？** 默认透传单页；自动翻页放二期。
