## Context

`init-tapd-mcp-server` 已归档，main specs 包含 `tapd-auth` / `tapd-api-client` / `tapd-resources` / `tapd-permission-introspection` / `mcp-server-runtime` 五个能力。本变更新增第六个能力 `tapd-web-client`，并扩展前者中的三个。

**关键事实**（来自上一阶段 design + 实测）：

- TAPD 网页下载 URL 模式：`https://www.tapd.cn/{workspace_id}/attachments/download/{attachment_id}/{type}`
- `type` 与 attachment 元数据中的 `type` 字段一致（bug / story / task / iteration 等）
- 此 URL 使用浏览器 cookie 鉴权；用 Bearer PAT 请求会返回 2 字节空响应或重定向到登录页 HTML
- 已知失效响应特征：HTTP 200 + `Content-Length: 2` 或 body 含 `<title>登录-TAPD</title>`

## Goals / Non-Goals

**Goals：**

1. 在 PAT 不具备 `attachments::get_attachment_download_url` scope 时，通过浏览器 cookie 提供附件下载兜底能力。
2. 不破坏现有 PAT 鉴权链路：OpenAPI 客户端、所有现有工具继续走 PAT，不受 cookie 配置影响。
3. cookie 是可选配置；未配置时下载工具不注册，对用户无任何副作用。
4. cookie 凭据等同 PAT 等级保护：脱敏、不落盘、内存保存。
5. cookie 过期时给出明确可执行的错误提示。

**Non-Goals：**

- 自动续期 cookie（不监听浏览器，不模拟登录）。
- cookie 与 PAT 互替（两个客户端独立，互不知道对方存在）。
- 网页路径上的其它接口（首版仅附件下载；后续若有刚需再扩）。
- 富 OAuth / SAML 流程。
- 文件预览（仅原始字节下载）。

## Decisions

### D1. 双客户端架构

新增 `src/api/web-client.ts`（`TapdWebClient` 接口），与 `TapdHttpClient` 并列。OpenAPI 工具和元工具继续用 `TapdHttpClient`；下载工具用 `TapdWebClient`。

**Why**：两个客户端的请求约定、鉴权头、错误形状完全不同。强行复用 client 抽象会引入 `if (mode === 'web') ...` 分支，得不偿失。

**Alternatives**：在 `TapdHttpClient` 上加 `mode: 'api' | 'web'` flag —— 否决，污染 99% 的请求路径。

### D2. cookie 形态：完整 header 字符串

`TAPD_WEB_COOKIE` 接受形如 `name1=v1; name2=v2; ...` 的整段字符串。MCP server **不解析**、**不规范化**、**直接原样塞进 `Cookie` 请求头**。

**Why**：浏览器 F12 复制 cookie 的最自然格式就是这样；解析后再重组会丢失边缘情况（值含 `=`、URL 编码、双引号包裹）。

**Alternatives**：要求 JSON 对象 —— 用户体验差，复制粘贴两步合成一步。

### D3. cookie 失效检测启发式

请求结束后，把响应 body 头 256 字节 + `Content-Length` 一并判断：

- `Content-Length ≤ 2` 且 `content-type` 含 `text/html` → 失效
- body 含 `<title>登录-TAPD</title>` → 失效
- body 起始字节是 `<!DOCTYPE html>` 且 URL path 含 `attachments/download` → 失效（正常附件不会返回 HTML）

任一命中 → 抛 `TapdApiError(kind: 'unauthenticated', info: 'cookie 已失效，请刷新 TAPD_WEB_COOKIE')`。

### D4. 二进制响应承载方式

两种返回模式，由调用方选：

- `save_to` 参数（绝对路径）：把字节流写到该文件，返回 `{ path, content_type, bytes, sha256 }`。
- 未传 `save_to`：返回 `{ filename, content_type, bytes, base64 }`。base64 上限 5 MB；超过则要求改用 `save_to`，错误信息直接告知该限制。

**Why**：MCP 协议本身没有原生二进制响应承载（content 字段最常用的是 text）。本地 stdio 客户端最自然是落盘，远程 HTTP 客户端则需要 base64。让调用方选最合适的形态。

### D5. 工具命名与注册条件

| 工具名 | 注册条件 | 说明 |
|---|---|---|
| `tapd.attachments.get_download_url` | 始终注册 | 仅返回 URL 字符串，不调网络，不需要 cookie |
| `tapd.attachments.download` | 仅当 `TAPD_WEB_COOKIE` 已配置 | 实际下载字节 |

`tapd.list_capabilities` 输出中要包含这两个工具的能力开关状态，便于诊断。

### D6. 配置加载与启动顺序变更

`AppConfig` 增加：

```ts
webCookie: string | undefined;
webBase: string; // 默认 https://www.tapd.cn
```

启动顺序在「注册工具」之前增加可选「web client 装配」步骤：

```
config → identity → workspaces → [if webCookie] webClient → register tools (含 cookie 条件) → transport
```

`webClient` 装配过程不发起网络验证（cookie 是否有效要等真正调用时才知道）—— 启动期不"探针" cookie，避免：
- 每次启动都发一次网页请求 → 触发 TAPD 风控
- cookie 短暂网络抖动导致整个服务不启动

### D7. 脱敏要求扩展到 cookie

`createLogger` 已对 `token` 路径做 redact。本变更扩展 redact path：

```ts
paths: [
  ...existing,
  'cookie',
  'webCookie',
  'TAPD_WEB_COOKIE',
  'headers.cookie',
  'headers.Cookie',
  '*.headers.cookie',
  '*.headers.Cookie',
],
```

cookie 长度通常 200+ 字符，不沿用 PAT 的"前 4 + *** + 后 4"展示形态；直接 redact 为 `***`，避免任何字符泄漏。

### D8. 错误归类

`web-client` 复用 `TapdApiError`，但 `kind` 含义对网页路径稍作适配：

| HTTP 状态 / 响应特征 | kind | 提示 |
|---|---|---|
| 200 + 正常二进制 | （成功） | 透传 |
| 200 + 登录页 HTML / 2 字节空响应 | `unauthenticated` | cookie 已失效，请刷新 TAPD_WEB_COOKIE |
| 403 | `permission_denied` | 当前 cookie 用户对该 workspace 无访问权限 |
| 404 | `not_found` | 附件不存在或当前 cookie 用户无权访问 |
| 5xx | `internal` | 重试 ≤ 2 次（与 PAT 客户端同策略） |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| cookie 过期频繁打断使用 | 错误提示明确 + README 写清 cookie 提取步骤；提供 `tapd.list_capabilities` 用于诊断 cookie 装配状态 |
| TAPD 网页路由变更 | URL 模式集中在 `web-client.ts` 一处常量，变更影响域可控；spec 中记录 URL 模式版本 |
| 失效检测启发式漏判（如未来登录页改 title） | 多重特征叠加（content-length + content-type + body 前缀 + URL 路径）；启发式做"宁可误判失效"也不做"宁可放过" |
| cookie 中含敏感非鉴权字段被日志泄漏 | redact 整段 cookie 为 `***`；不展示首尾字符 |
| 用户误把 cookie 提交到 git | README 警告 + `.env` 已在 `.gitignore` 中 |
| 与 PAT 客户端并发抢限速 | webClient 用独立 `p-limit`，默认并发 4（低于 PAT 的 8） |

## Migration Plan

- 全部新增，无 API 破坏性变更。
- 已部署的实例升级后，未设置 `TAPD_WEB_COOKIE` 时行为 100% 与旧版一致。
- 回滚：删除 cookie 环境变量并降级版本即可。

## Open Questions

1. **是否要把网页路径扩展到其他资源**（如富文本评论拉取）？首版不做，等具体用例再决定。
2. **是否支持 cookie 文件路径** (`TAPD_WEB_COOKIE_FILE`)？暂不实现；与 `TAPD_TOKEN` 的文件路径模式对齐，可在后续追加。
3. **当 cookie 与 PAT 都缺**时是否要硬阻止启动？目前不阻止 —— PAT 是核心必需，cookie 是可选增强。
