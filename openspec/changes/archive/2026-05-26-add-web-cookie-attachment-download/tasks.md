## 1. 配置层扩展

- [x] 1.1 在 `src/config.ts` 增加 `webCookie: string | undefined`、`webBase: string`、`webConcurrency: number` 字段及对应 env 解析（`TAPD_WEB_COOKIE` / `TAPD_WEB_BASE` / `TAPD_WEB_CONCURRENCY`）
- [x] 1.2 校验 `TAPD_WEB_BASE` 为合法 URL；非法时报 ConfigError
- [x] 1.3 `.env.example` 增加这三个变量与注释

## 2. 日志脱敏扩展

- [x] 2.1 `src/runtime/logger.ts` 的 redact paths 增加 cookie 相关路径（`cookie`、`webCookie`、`TAPD_WEB_COOKIE`、`headers.cookie`、`headers.Cookie`、嵌套通配）
- [x] 2.2 cookie redact 的 censor 直接返回 `***`，不沿用 PAT 的前后缀展示
- [x] 2.3 单测断言完整 cookie 串与 `Cookie:` 头都不出现在 stderr

## 3. Web HTTP 客户端

- [x] 3.1 新建 `src/api/web-client.ts`：导出 `TapdWebClient` 接口与 `createTapdWebClient`
- [x] 3.2 用独立 undici Agent + 独立 p-limit 实现，不复用 `TapdHttpClient`
- [x] 3.3 cookie 注入到 `Cookie` 请求头，原样透传不做规范化
- [x] 3.4 实现失效检测启发式：`Content-Length ≤ 2` + html mime / `<title>登录-TAPD</title>` / download URL 收到 `<!DOCTYPE html>`
- [x] 3.5 复用 `TapdApiError`，失效场景 kind=unauthenticated 并附 "TAPD_WEB_COOKIE 已失效" 提示
- [x] 3.6 5xx 重试 ≤ 2 次（指数退避），4xx 不重试
- [x] 3.7 暴露 `downloadBinary(path, query)` 方法：返回 `{ bytes: Uint8Array, contentType: string, filename?: string }`
- [x] 3.8 单元测试：注入 fake httpRequest 覆盖正常下载、2 字节失效、登录页失效、5xx 重试、cookie 头脱敏

## 4. 资源工具扩展

- [x] 4.1 在 `src/resources/definitions.ts` 给 `attachments` 添加 `get_download_url` 与 `download` 两个 action 描述（后者标 `webOnly: true`）
- [x] 4.2 `src/tools/register.ts` 增加注册分支：`get_download_url` 始终注册；`download` 仅当 `webClient` 已装配时注册
- [x] 4.3 实现 `tapd.attachments.get_download_url`：纯构造 URL 字符串，不调网络
- [x] 4.4 实现 `tapd.attachments.download`：参数 `workspace_id`、`attachment_id`、`type`（默认 bug）、可选 `save_to`、可选 `max_inline_mb`
- [x] 4.5 落盘模式返回 `{path, content_type, bytes, sha256}`；inline 模式返回 `{filename, content_type, bytes, base64}`
- [x] 4.6 > 5 MB 默认强制 `save_to`；超限错误用 `invalid_argument`，错误文案明确给出 fix 步骤
- [x] 4.7 单元测试：URL 构造、落盘成功、inline base64、超限错误、cookie 失效错误透传

## 5. 元工具扩展

- [x] 5.1 `src/tools/meta.ts` 的 `tapd.list_capabilities` 输出增加 `web_client: { enabled, base }`
- [x] 5.2 单元测试覆盖两种状态（enabled true/false）

## 6. 启动顺序

- [x] 6.1 `src/runtime/server.ts`：在 `registerResourceTools` 之前根据 `config.webCookie` 决定是否调用 `createTapdWebClient`
- [x] 6.2 `ServerBundle` 增加 `webClient?: TapdWebClient`；`close()` 一并释放
- [x] 6.3 把 `webClient` 沿调用栈注入到 register/meta 函数

## 7. 集成测试

- [x] 7.1 集成测试：用真实 cookie 下载已知 attachment（1161376769001048737）到临时目录，断言文件大小 > 1 KB 且非登录页 HTML
- [x] 7.2 集成测试：用伪造失效 cookie 调用 download，断言抛 `unauthenticated`
- [x] 7.3 集成测试：调用 `tapd.attachments.get_download_url` 不需要 cookie 即可返回 URL

## 8. 文档

- [x] 8.1 README 增加「附件下载（cookie 模式）」一节：cookie 提取步骤、配置示例、过期处理
- [x] 8.2 README 故障排查表增加 cookie 失效条目
- [x] 8.3 README 安全章节增加 cookie 等同凭据的提示
- [x] 8.4 `.env.example` 注释清晰说明 cookie 可选

## 9. 验证与归档

- [x] 9.1 跑全部单测 + 集成测试 + typecheck + build
- [x] 9.2 端到端：启动 MCP server（HTTP 模式），用 MCP initialize + tools/list 确认两个新工具按规则注册
- [x] 9.3 端到端：调用 `tapd.attachments.download` 真实下载 1161376769001048737 的 .log
- [x] 9.4 `openspec validate add-web-cookie-attachment-download --strict`
- [x] 9.5 `openspec archive add-web-cookie-attachment-download`
