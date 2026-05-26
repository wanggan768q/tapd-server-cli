## 1. 项目初始化

- [x] 1.1 创建 `package.json`，声明 `"type": "module"`、`engines.node >= 20`、bin 入口 `tapd-mcp`
- [x] 1.2 安装依赖：`@modelcontextprotocol/sdk`、`undici`、`zod`、`pino`（脱敏日志）、`p-limit`、`commander`（CLI 参数）
- [x] 1.3 安装 devDependencies：`typescript`、`tsx`、`vitest`、`@types/node`、`eslint`、`prettier`
- [x] 1.4 创建 `tsconfig.json`（ES2022 target、moduleResolution=Bundler、strict、noUncheckedIndexedAccess）
- [x] 1.5 创建 `.gitignore`（`node_modules/`、`dist/`、`.env`、`*.log`）
- [x] 1.6 创建 `.env.example`，列出 design D11 的全部环境变量
- [x] 1.7 创建 `scripts/probe-api.sh`，把本阶段成功的 curl 探测固化为可重放脚本
- [x] 1.8 配置 ESLint + Prettier（基础规则、import order）

## 2. 配置加载与日志（mcp-server-runtime）

- [x] 2.1 实现 `src/config.ts`：用 zod schema 校验所有环境变量与 CLI 参数，缺失 `TAPD_TOKEN` 时 exit 78
- [x] 2.2 实现 CLI 参数解析：支持 `--token`、`--api-base`、`--http-port`
- [x] 2.3 实现 `src/runtime/logger.ts`：pino + 自定义 redact 路径，对令牌做"前 4+***+后 4"脱敏
- [x] 2.4 验证日志样例：单元测试断言完整 PAT 不出现在 stderr 输出中

## 3. 鉴权层（tapd-auth）

- [x] 3.1 实现 `src/auth/token.ts`：按优先级 CLI > env > 用户文件读取令牌，对配置文件强制权限 600 检查
- [x] 3.2 实现脱敏工具函数 `maskToken(pat)`
- [x] 3.3 实现 `src/auth/identity.ts`：封装 `GET /users/info`，返回 `{user_id, user_name, current_company_id, token_preview}`
- [x] 3.4 单元测试：来源优先级、文件权限拒绝、脱敏正确性

## 4. HTTP 客户端（tapd-api-client）

- [x] 4.1 实现 `src/api/client.ts`：基于 undici `Dispatcher`，注入 `Authorization: Bearer <PAT>`、默认超时、keep-alive
- [x] 4.2 实现 `src/api/errors.ts`：响应包络解析 + status→MCP 错误类型映射（401/403/404/422/429/5xx）
- [x] 4.3 实现 `p-limit` 全局并发控制（默认 8，由 `TAPD_CONCURRENCY` 覆盖）
- [x] 4.4 实现指数退避重试：429 ≤3 次、5xx ≤2 次、其它不重试；base=500ms cap=4s
- [x] 4.5 实现 `src/api/paging.ts`：通用 `page`/`limit` 透传，不做自动跨页聚合
- [x] 4.6 单元测试：响应解析、错误映射各分支、重试逻辑、超时

## 5. 权限内省（tapd-permission-introspection）

- [x] 5.1 实现 `src/permissions/snapshot.ts`：权限快照对象（workspaces + 资源能力矩阵 + snapshot_at）
- [x] 5.2 实现 `src/permissions/workspaces.ts`：调用 `/workspaces/user_participant_projects` 加载白名单（含 id/name/category）
- [x] 5.3 实现 `src/permissions/probe.ts`：读权限懒探针 + TTL 缓存；写权限失败短缓存（1h）
- [x] 5.4 实现刷新机制：手动 `refresh` 后清空缓存并重新拉取 workspace
- [x] 5.5 单元测试：缓存 TTL、写失败短缓存、刷新清空

## 6. 资源工具实现（tapd-resources）— 按资源逐个

- [x] 6.1 实现 `stories`：list / get / create / update（参数 schema 包含 workspace_id enum）
- [x] 6.2 实现 `bugs`：list / get / create / update
- [x] 6.3 实现 `tasks`：list / get / create / update
- [x] 6.4 实现 `iterations`：list / get / create / update
- [x] 6.5 实现 `releases`：list / get / create / update
- [x] 6.6 实现 `timesheets`：list / create
- [x] 6.7 实现 `comments`：list / create
- [x] 6.8 实现 `attachments`：list / get（含二进制下载语义）
- [x] 6.9 实现 `workflows`：get_states / transitions
- [x] 6.10 实现 `users`：list / get
- [x] 6.11 实现 `categories` / `modules` / `custom-fields`：list / get
- [x] 6.12 为所有写工具的 `description` 前缀加 `[写操作]`
- [x] 6.13 实现 `fields` 投影参数：在所有 list/get 工具上统一支持

## 7. 元工具与工具注册（tapd-resources / tapd-permission-introspection）

- [x] 7.1 实现 `src/tools/meta.ts`：`tapd.whoami` / `tapd.list_workspaces` / `tapd.list_capabilities` / `tapd.refresh_permissions`
- [x] 7.2 实现 `src/tools/register.ts`：根据权限快照动态注册资源工具，workspace_id 参数 enum 收紧
- [x] 7.3 实现 `notifications/tools/list_changed` 通知：启动完成 + 手动刷新 + 探针新增能力时触发
- [x] 7.4 单元测试：在不同快照下注册的工具集差异、enum 收紧

## 8. MCP Server 装配（mcp-server-runtime）

- [x] 8.1 实现 `src/runtime/server.ts`：装配 MCP Server 实例，挂载元工具与资源工具
- [x] 8.2 实现 `src/runtime/transports.ts`：stdio 传输（默认）+ streamable HTTP（`TAPD_MCP_HTTP_PORT` 启用）
- [x] 8.3 实现启动顺序：配置 → 鉴权 → workspace 白名单 → 注册工具 → 绑定传输
- [x] 8.4 实现优雅停止：SIGINT/SIGTERM 5 秒内拒绝新请求并退出
- [x] 8.5 实现 HTTP 模式下的 `GET /healthz`
- [x] 8.6 实现 `src/index.ts` 进程入口

## 9. 测试

- [x] 9.1 集成测试：用真实 PAT 调用 `/users/info`、`/workspaces/user_participant_projects` 验证启动链路
- [x] 9.2 集成测试：对 GSTM 项目（61376769）跑 `tapd.stories.list`、`tapd.bugs.list`、`tapd.iterations.list` 的 read 路径
- [x] 9.3 集成测试：对 workspace_id=99999999 触发 404，验证错误归一化为 `not_found`
- [ ] 9.4 兼容性烟测：用 Claude Code、Cursor、Claude Desktop、OpenCode、Codex 各连接一次（stdio 模式），跑 `tapd.whoami` + `tapd.stories.list` — 需人工在各客户端中验证，README 已附配置示例
- [x] 9.5 加入 vitest 配置 + `npm test` 脚本；CI 中通过 Secret 注入 `TAPD_TOKEN`

## 10. 文档与发布准备

- [x] 10.1 编写 README：安装、获取 PAT 的步骤、`npx tapd-mcp` 启动、MCP 客户端配置示例
- [x] 10.2 编写"工具一览"文档：列出所有 `tapd.<resource>.<action>` 及参数说明
- [x] 10.3 编写"权限故障排查"文档：401 / 403 / 404 各对应什么操作、如何刷新权限
- [x] 10.4 添加 `LICENSE`（默认 MIT，待用户确认）
- [x] 10.5 配置 `npm publish` 前置检查（`prepublishOnly` 跑 build + test）
- [x] 10.6 在 README 中列出明确警告：禁止把 `TAPD_TOKEN` 提交到 git
