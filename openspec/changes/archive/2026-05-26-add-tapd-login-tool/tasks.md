## 1. Cookie 持久化模块

- [x] 1.1 新增 `src/auth/cookie-store.ts`：导出 `CookieStore` 接口与 `createCookieStore({ baseDir? })` 工厂；默认 `baseDir = path.join(homedir(), '.config', 'tapd-mcp')`
- [x] 1.2 `load()`：env `TAPD_WEB_COOKIE` 非空 → `{value, source: 'env'}`；否则读文件（POSIX 校验 mode 600 否则警告 + 返回 undefined）→ `{value, source: 'file'}`；都没有 → undefined
- [x] 1.3 `save(value)`：写到 `<baseDir>/cookie.tmp` 再 rename 到 `<baseDir>/cookie`；POSIX 平台 chmod 600；返回 `{path}`
- [x] 1.4 `clear()`：删除 cookie 文件（如存在）；返回 `{path, existed}`
- [x] 1.5 `filePath()`：返回完整文件路径
- [x] 1.6 单元测试：env-优先 / 文件存在但权限不安全 / 原子写覆盖旧文件 / clear 幂等

## 2. 浏览器登录模块

- [x] 2.1 新增 `src/auth/browser-login.ts`：导出 `launchAndGrabCookie(options)` 函数
- [x] 2.2 把 `scripts/grab-cookie.mjs` 中找 Chrome / spawn / CDP / cookie 轮询逻辑迁入
- [x] 2.3 支持 `abortSignal`：收到 abort 时关 CDP + SIGTERM Chrome + 清理 user-data-dir
- [x] 2.4 支持 `timeoutMs`：超时返回明确错误（不是 abort）
- [x] 2.5 支持 `domainSuffix` 和 `sessionCookieName` 可配置（默认 `tapd.cn` / `t_i_token`）
- [x] 2.6 接受可选 `logger`（pino Logger），记录关键步骤但 redact cookie
- [x] 2.7 单元测试：用 mock 的 `child_process.spawn` 和 fake CDP 服务器；超时与 abort 路径
- [x] 2.8 重构 `scripts/grab-cookie.mjs`：改为薄壳，调 `dist/auth/browser-login.js` 的 `launchAndGrabCookie`，仍然负责写 `~/.claude.json`

## 3. 资源工具注册改造（支持热加载）

- [x] 3.1 `src/tools/attachments-download.ts` 重构：把 download 工具的注册提取为可重复调用的内部函数 `registerDownloadTool(server, webClient, deps)`
- [x] 3.2 新增 `AttachmentRegistry` 类（或工厂）：内部维护 `currentWebClient` 与 download 工具的注册状态，暴露 `arm(client)` / `disarm()` / `isArmed()` / `currentTools(): string[]`
- [x] 3.3 `disarm()`：删除 `(server as any)._registeredTools['tapd.attachments.download']` 并发 `sendToolListChanged`
- [x] 3.4 `arm()`：注册 download 工具（如果未注册）+ 发 `sendToolListChanged`
- [x] 3.5 调用方迁移：`server.ts` 改用 `AttachmentRegistry`；初始 `webClient` 存在则 arm，否则不动
- [x] 3.6 单元测试：arm → disarm → arm 来回切换；disarm 后 `_registeredTools` 中无该 key

## 4. tapd.login / tapd.logout 工具

- [x] 4.1 新增 `src/tools/login.ts`：导出 `registerLoginTools(server, deps)`
- [x] 4.2 deps 包含 `cookieStore` / `attachmentRegistry` / `webBase` / `fileBase` / `webConcurrency` / `timeoutMs` / `httpPortConfigured: boolean` / `loggerFactory` / `createWebClient: (cookie) => TapdWebClient`
- [x] 4.3 `tapd.login` schema：`{ timeout_minutes?: number }`（1..10，默认 5）
- [x] 4.4 `tapd.login` 实现：
  - guard `httpPortConfigured` → 抛 `invalid_argument`
  - 调 `launchAndGrabCookie({ timeoutMs })`
  - 失败时返回明确错误（找不到 Chrome / 超时 / 用户中止）
  - 成功后 `cookieStore.save(cookie)` 持久化
  - 创建新 `TapdWebClient`；旧的若存在则关闭
  - `attachmentRegistry.arm(newClient)`
  - 返回 `{status, cookie_chars, cookie_count, cookie_file, web_client, tools_added, env_cookie_warning}`
- [x] 4.5 `tapd.logout` schema：`{}`
- [x] 4.6 `tapd.logout` 实现：`attachmentRegistry.disarm()` + `cookieStore.clear()` + 返回 `{status, cookie_file_existed, tools_removed}`
- [x] 4.7 description 明确写"仅用户明确请求时调用，不要在 unauthenticated 错误后自动重试"
- [x] 4.8 单元测试：HTTP 模式 guard / 成功路径 / 找不到 Chrome / 超时 / logout 后 disarm

## 5. 启动流程改造

- [x] 5.1 `src/runtime/server.ts`：构造 `cookieStore` → `await cookieStore.load()` → 用得到的 cookie 装配 `webClient`（替代直接读 `config.webCookie`）
- [x] 5.2 `AttachmentRegistry` 装配并按 cookie 状态 arm
- [x] 5.3 注册 `tapd.login` / `tapd.logout`（始终注册）
- [x] 5.4 `ServerBundle` 增加 `cookieStore` / `attachmentRegistry` 字段
- [x] 5.5 `close()` 同时释放 attachmentRegistry 内的 webClient
- [x] 5.6 启动日志增加 `cookie_source: 'env' | 'file' | 'none'`

## 6. 元工具扩展

- [x] 6.1 `src/tools/meta.ts`：`MetaToolDeps` 增加 `cookieSource: 'env' | 'file' | 'none'` 和 `attachmentRegistry`（取代静态 `attachmentTools` / `webClientEnabled`）
- [x] 6.2 `tapd.list_capabilities` 输出 `web_client.cookie_source`、动态读 `attachmentRegistry.currentTools()`
- [x] 6.3 单元测试：三个 source 都被正确输出

## 7. 文档

- [x] 7.1 README「附件下载」章节重写：把 `tapd.login` 列为推荐路径，`grab-cookie.mjs` 降级为备选
- [x] 7.2 README 增加 `tapd.login` / `tapd.logout` 工具说明
- [x] 7.3 README 故障排查表增加 "找不到 Chrome" / "HTTP 模式不支持 login" / "env 与 file 同时存在的优先级" 三项
- [x] 7.4 README 安全章节明确：cookie 文件路径与权限
- [x] 7.5 `.env.example` 补充注释：现在 cookie 主要由 `tapd.login` 自动管理，env 是可选覆盖

## 8. 验证与归档

- [x] 8.1 跑全部单测 + typecheck + build
- [ ] 8.2 端到端：本地 stdio 模式启动 server → MCP initialize → 调用 `tapd.login` → 看 tools/list_changed 触发 → 调用 `tapd.attachments.download` 真实下载已知附件（1161376769001048737）
- [ ] 8.3 端到端：调用 `tapd.logout` → 看 tools/list_changed 触发 → 确认 `tapd.attachments.download` 已下线
- [ ] 8.4 端到端：HTTP 模式启动（`TAPD_MCP_HTTP_PORT=8787`）→ 调 `tapd.login` 必须返回拒绝错误
- [x] 8.5 `openspec validate add-tapd-login-tool --strict`
- [ ] 8.6 `openspec archive add-tapd-login-tool`
