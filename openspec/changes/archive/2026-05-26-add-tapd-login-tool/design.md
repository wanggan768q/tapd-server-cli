## Context

`add-web-cookie-attachment-download` 把 cookie 当 env 变量 inject，
适合服务化部署但对桌面用户体验差。`scripts/grab-cookie.mjs` 提供了自动
抓取流程，但它**在 MCP server 之外**跑、**直接动客户端 `~/.claude.json`**，
两个边界都不干净：

- 不动客户端配置 → 不需要重启 Claude Code 让新 cookie 生效。
- 在 MCP server 内完成 cookie 获取 → 用户体验降到"说一句话"的程度。

本变更把 cookie 获取流程"内置"为 MCP 工具，cookie 落到 MCP server 自己的
状态文件，运行期热加载 `TapdWebClient`。

## Goals / Non-Goals

**Goals：**

1. 用户在 MCP 客户端里说"登录 TAPD"，AI 调 `tapd.login` → 浏览器弹出 →
   用户登录 → AI 立刻能用 `tapd.attachments.download`，**不需要重启任何东西**。
2. cookie 持久化到 MCP server 自有目录，下次启动自动加载。
3. 不破坏旧路径：env `TAPD_WEB_COOKIE` 和 `grab-cookie.mjs` 都继续工作。
4. 拒绝在不适合的传输模式（远程 HTTP）下调用 — 防止远程客户端意外触发本地浏览器。
5. tool description 明确指引 AI 行为：仅用户明确要求时调用，不要在
   `unauthenticated` 错误后擅自重试。

**Non-Goals：**

- 不实现 cookie 自动刷新 / 续期（cookie 仍可能过期，要用户重新调 `tapd.login`）。
- 不监听浏览器登出事件（用户在浏览器登出后，下次下载时才会触发 unauthenticated）。
- 不做 OAuth / SAML / 账号密码模拟。
- 不在 HTTP 远程模式下做"返回登录 URL 让用户在自己浏览器登录"的复杂流程
  （那是另一个用例，暂不做）。
- 不支持 macOS / Linux 桌面以外的环境（CI / 容器 / 远程 SSH 都直接拒绝）。

## Decisions

### D1. cookie 来源优先级与持久化路径

cookie 来源由 server 启动时按优先级合并，**首个非空源胜出**：

1. `process.env.TAPD_WEB_COOKIE`
2. `~/.config/tapd-mcp/cookie` 文件（POSIX 平台要求 mode 600，否则拒绝读取）
3. 无 cookie → 不装配 `TapdWebClient`

`tapd.login` 工具完成后**只写文件**，不动 env；如果当前 env 已设置 cookie，
工具会成功写入文件并把内存 cookie 替换为新值 **但记一条 warn 日志**
"env `TAPD_WEB_COOKIE` 仍然存在，进程重启后会优先使用 env 值而非新文件"，
让用户知道两个源共存的优先级。

**Why**：env 路径继续是 ops / docker 的标准方案；文件路径服务桌面交互场景。
两者共存且优先级明确 → 不出意外。

### D2. 持久化模块 `cookie-store`

新增 `src/auth/cookie-store.ts`，导出：

```ts
export interface CookieStore {
  /** 读 cookie：env > file > undefined */
  load(): Promise<{ value: string; source: 'env' | 'file' } | undefined>;
  /** 写 cookie 到文件（atomic write + chmod 600）；不动 env */
  save(value: string): Promise<{ path: string }>;
  /** 删除 cookie 文件（如果存在） */
  clear(): Promise<{ path: string; existed: boolean }>;
  /** 文件路径（用于日志和诊断） */
  filePath(): string;
}
```

**Why**：cookie 加载、保存、清除是同一组关联操作；集中起来才能在测试里替换
（指向 `tmpdir()` 而不是真实 `~/.config/tapd-mcp`）。

### D3. 浏览器登录模块 `browser-login`

把 `scripts/grab-cookie.mjs` 中找 Chrome、spawn、CDP 抓 cookie 的部分抽到
`src/auth/browser-login.ts`：

```ts
export interface LaunchLoginOptions {
  loginUrl: string;          // 默认 https://www.tapd.cn/cloud_logins/login
  sessionCookieName: string; // 默认 t_i_token（TAPD 登录态标识）
  timeoutMs: number;         // 默认 5 分钟
  domainSuffix: string;      // 默认 tapd.cn
  abortSignal?: AbortSignal;
  logger?: Logger;
}
export interface LaunchLoginResult {
  cookieHeader: string;      // 'name1=v1; name2=v2; ...'
  cookieCount: number;
  domain: string;            // .tapd.cn
}
export async function launchAndGrabCookie(opts: LaunchLoginOptions): Promise<LaunchLoginResult>;
```

`scripts/grab-cookie.mjs` 改造为薄壳：调 `launchAndGrabCookie` + 写
`~/.claude.json`。`tapd.login` 工具调 `launchAndGrabCookie` + 写
`cookieStore.save()`。**一套实现两个入口**。

**Why**：避免 .mjs 脚本和 .ts 工具各自实现一份找 Chrome / CDP 逻辑导致漂移；
单一可测实现源。

### D4. 工具签名

#### `tapd.login`（始终注册）

```ts
inputSchema: {
  timeout_minutes?: number;  // 1..10, 默认 5
}
```

返回结构化数据：

```json
{
  "status": "ok",
  "cookie_chars": 832,
  "cookie_count": 17,
  "cookie_file": "/Users/me/.config/tapd-mcp/cookie",
  "web_client": "armed",
  "tools_added": ["tapd.attachments.download"],
  "env_cookie_warning": null
}
```

如果 env 已有 cookie，`env_cookie_warning` 给出明确提示。

description 强约束：

> [需要本地浏览器] 弹出隔离浏览器窗口，等用户登录 TAPD 后自动抓取
> 浏览器 cookie 并装配 `tapd.attachments.download` 工具。
> **仅在用户明确表达"登录 TAPD" / "重新登录" / "刷新 cookie" 时调用。
> 不要在收到 unauthenticated 错误后自动重试调用，应先告知用户并等待确认。**

#### `tapd.logout`（始终注册）

```ts
inputSchema: {}
```

返回：

```json
{
  "status": "ok",
  "cookie_file_existed": true,
  "tools_removed": ["tapd.attachments.download"]
}
```

description：

> 删除 TAPD cookie（仅 server 端文件，不影响浏览器登录）并销毁附件下载工具。

### D5. 热加载机制

MCP SDK 通过 `_registeredTools` map 持有已注册工具，**没有公开 unregister 接口**。
我们的方案：

1. `registerAttachmentDownloadTools` 改为返回一个 `AttachmentRegistry` 对象，
   它持有：
   - 已注册工具的 handle 列表
   - 内部状态 `currentWebClient: TapdWebClient | undefined`
   - 方法 `arm(client: TapdWebClient)` 装配并注册 download 工具
   - 方法 `disarm()` 注销 download 工具并释放 client
2. **注销实现**：直接 mutate `server._registeredTools` 删除 key（与 `registerMetaTools`
   读 `_registeredTools` 同样的私有访问层级）。这是当前 SDK 唯一可行的方式；
   注释里明确标注"使用 SDK 私有 API"，并在 SDK 升级时单测会捕捉到。
3. **告知客户端**：每次 arm/disarm 调用后立即 `server.sendToolListChanged()`，
   让客户端拉新一次 tools/list。

**Why not 重启 server**：MCP server 进程是 Claude Code 的子进程，重启就要客户端
重新 spawn → 用户体验断裂。热加载是核心目标。

**Risk**：MCP SDK 改 `_registeredTools` 结构会让我们的 unregister 坏掉。
缓解：单测断言"调 logout 后 `_registeredTools['tapd.attachments.download']` 为 undefined"。

### D6. 传输模式守卫

`tapd.login` 在以下情况直接拒绝：

- `httpPort` 已设置（HTTP 模式启用）→ 服务可能在远程，spawn 本地浏览器没意义。
  错误信息：`tapd.login 仅支持 stdio 传输（本地客户端启动）。当前服务以 HTTP 模式运行，
  请在本地 stdio 模式下使用，或用 TAPD_WEB_COOKIE 环境变量手动配置。`
- 找不到 Chrome / Edge → 明确错误：`未在常见路径找到 Chrome/Edge 浏览器，
  请安装 Chrome 或手动设置 BROWSER 环境变量指向浏览器 exe，
  或回退用 scripts/grab-cookie.mjs / TAPD_WEB_COOKIE。`

**Why**：spawn 本地浏览器是桌面强假设；其它部署形态必须有清晰回退路径。

### D7. AbortSignal & 超时

`tapd.login` 在收到 SIGINT / 超时（默认 5 分钟）时：

1. 关闭 CDP WebSocket
2. SIGTERM Chrome 进程
3. `rmSync` 临时 user-data-dir
4. 返回 `invalid_argument` 或 `unauthenticated` 错误（视情况）

**Why**：用户中途退出/超时 → server 必须能完整回收资源，避免僵尸 Chrome 进程。

### D8. cookie 文件原子写

```
write(path + '.tmp', value, mode 600)
rename(path + '.tmp', path)
```

**Why**：避免并发写或部分写导致下次启动读到空/半截 cookie。

### D9. 文件权限策略

POSIX：必须 mode 600，否则 `cookieStore.load()` 拒绝读取并 warn 日志。
Windows：跳过权限检查（NTFS ACL 与 POSIX mode 模型不一致；用户级 profile 目录
本身就是用户私有）。与现有 `src/auth/token.ts` 处理 PAT 文件的策略一致。

### D10. `grab-cookie.mjs` 的位置

降级为兼容备选：

- 仍然可用（CI / 无 GUI 桌面调试 / 用户偏好 `~/.claude.json` 方案）。
- 内部改调 `dist/auth/browser-login.js` 的 `launchAndGrabCookie`，避免代码重复。
- README 把 `tapd.login` 工具提到第一推荐路径。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| MCP SDK 升级改 `_registeredTools` 结构 | 单测断言 logout 后 key 不存在；升级时立即发现 |
| 远程 HTTP 模式被误触发 spawn Chrome | 启动时 transport 模式记入 server context；工具调用前显式 guard |
| Chrome 找不到 / 路径未覆盖 | 多路径回退（含 Edge）；找不到时返回明确错误 + 回退指引 |
| cookie 文件读时被另一个 server 写 | 原子写（rename）；读时一次性 `readFile` 不留打开句柄 |
| env 与 file 同时存在导致用户困惑 | login 后明确返回 `env_cookie_warning`；list_capabilities 显示 `cookie_source` |
| AI 在 unauthenticated 后自动调 login → 用户被反复弹浏览器 | tool description 明确写"不要自动重试" |
| 长时间用户没操作 Chrome | 默认 5 分钟超时；可由参数覆盖（最长 10 分钟） |

## Migration Plan

- 兼容旧路径：env `TAPD_WEB_COOKIE` 和 `grab-cookie.mjs` 都继续工作。
- 第一次升级后，用户若已有 env 配置则**继续走 env**（无须任何动作）。
- 用户首次调 `tapd.login` 写文件后，下次进程重启会自动从文件加载（如果 env 不再设置）。
- 回滚：删除 `~/.config/tapd-mcp/cookie` + 不调 `tapd.login` 即可恢复纯 env 行为。

## Open Questions

1. **是否在 `tapd.login` 返回前主动验证一次下载**？倾向不做：
   - 触发一次下载请求 = 多一次 TAPD 风控触发面
   - 用户的下一个动作（下载附件）天然就是验证
   决定：不做主动验证。
2. **多用户同机器是否会写到同一 cookie 文件**？走 `homedir()` 自然按 OS 用户隔离，
   不引入额外维度。
3. **Windows 上 cookie 文件 ACL 加固**？POSIX 600 等价物在 Windows 上是 NTFS DACL
   只授权当前用户。**不在本变更范围**；遵循现有 PAT 文件路径模式。
