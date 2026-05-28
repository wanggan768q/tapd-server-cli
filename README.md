# tapd-server-cli

为腾讯 TAPD 开发的 MCP（Model Context Protocol）Server。
通过**个人访问令牌**（personal access token, PAT）暴露 TAPD Open API，
让 Claude Code / Claude Desktop / Cursor / OpenCode / Codex 等 MCP 客户端
直接读写 TAPD 数据（需求 / 缺陷 / 迭代 / 工时 / 评论 / 附件 / 工作流 / 成员…）。

> TAPD 官方 API 文档：<https://o.tapd.tencent.com/document/api-doc/next/api/>
>
> 字段语义、参数细节以官方文档为准。

## 特性

- **个人令牌零配置**：仅 `TAPD_TOKEN` 一个环境变量即可启动，不需要注册 TAPD 应用。
- **一键安装到 MCP 客户端**：`npx tapd-server-cli install` 弹出 checkbox 多选 Claude Code / Codex / OpenCode / Cursor（也可命令行显式列出多家），自动写入对应客户端的 MCP 配置。
- **对称的卸载入口**：`npx tapd-server-cli uninstall` 同款多选界面，仅移除 `mcpServers.tapd` 节，保留同节其它 server 与文件其它字段；可加 `--purge` 一并清理本地 cookie / token 文件。
- **Slash 命令向导**：在客户端里输入 `/mcp__tapd__setup` 一键完成 PAT 验证、cookie 登录、附件下载工具装配。
- **基于令牌的权限按需暴露**：仅对令牌真正可访问的 workspace 暴露 `workspace_id` 参数枚举。
- **资源覆盖**：stories / bugs / tasks / iterations / releases / timesheets / comments / attachments / workflows / users / categories / modules / custom-fields。
- **错误归一化**：把 TAPD 的 `status` 字段统一映射为 MCP 工具的结构化错误（unauthenticated / permission_denied / not_found / invalid_argument / rate_limited / internal）。
- **限流与重试**：429 ≤3 次、5xx ≤2 次、指数退避；并发上限默认 8。
- **令牌脱敏**：日志强制脱敏（`前 4 + *** + 后 4`），令牌不落盘。
- **stdio + streamable HTTP** 双传输；HTTP 模式带 `/healthz`。

## 获取 TAPD 个人访问令牌

1. 登录 TAPD（<https://www.tapd.cn>）。
2. 进入「设置 → 个人设置 → 安全设置 → API 令牌」，按提示生成个人访问令牌。
3. 复制令牌字符串（仅显示一次），保存到安全位置。

> 注意：令牌等同于账号凭证，**不要提交到 Git，不要分享到聊天工具**。

## 在 Claude Code 中安装（推荐）

最简单的安装方式——**完全在 Claude Code 内完成**，不需要终端：

```text
> /plugin marketplace add wanggan768q/tapd-server-cli
> /plugin install tapd-server-cli@tapd-server-cli
```

弹窗会要求你输入「TAPD 个人访问令牌」（PAT），一次性输入即可：

- PAT 走系统 keychain（macOS/Windows 钥匙串、Linux 走 `~/.claude/.credentials.json`），**不会落普通配置文件**
- Plugin 启用后 MCP server 自动通过 `npx -y tapd-server-cli` 拉起，env 注入 PAT
- `/mcp` 应该立即显示 `tapd ✓ Connected`

> **注意 — 配置文件位置**：Claude Code 的 MCP 配置存在 `~/.claude.json`（家目录顶层），不是 `~/.claude/settings.json`（settings 文件不放 MCP）。如果你之前在 `settings.json` 里找过 `tapd` 配置没找到，是找错文件了——plugin 路径完全屏蔽这个困惑。

### 首次使用附件下载

附件下载需要浏览器 cookie（PAT 不够，TAPD 限制）。在 Claude Code 会话里输入：

```text
> /tapd-server-cli:login
```

会弹出隔离浏览器窗口，登录 TAPD 后 cookie 自动持久化，附件下载工具立即可用。

### 升级（已通过 `npx install claude-code` 装过）

如果你之前用 `npx tapd-server-cli install claude-code` 装过，要切换到 plugin：

1. **先卸载老的 user-scope 配置**：`npx tapd-server-cli uninstall claude-code`（清掉 `~/.claude.json` 顶层 `mcpServers.tapd`）
2. 在 Claude Code 内 `/plugin marketplace add wanggan768q/tapd-server-cli`
3. `/plugin install tapd-server-cli@tapd-server-cli`，弹窗输入 PAT
4. 重启 Claude Code

> 按 Claude Code 官方优先级（local > project > **user > plugin** > claude.ai），如果不先卸载 user scope 那条 `tapd` 配置，会**屏蔽** plugin 提供的同名 server。

## 在其它客户端中安装（npx install）

适用于 Codex / OpenCode / Cursor，以及在终端里批量装 / CI 场景。

> ⚠️ **注意 — Claude Code 的 MCP 配置文件位置**：MCP server 写在 `~/.claude.json`（家目录顶层 `mcpServers.tapd`），**不是** `~/.claude/settings.json`（permissions / hooks / UI 行为的设置）。`settings.json` 里找不到 `tapd` 不是 bug——是找错文件了。如果你不想再纠结这两个文件，**改用上面的 plugin 路径**，PAT 直接进 keychain，不用碰任何配置文件。

> 如果你用 **Claude Code**，请优先看上面的「在 Claude Code 中安装（推荐）」节——plugin 路径更简单、PAT 直接进 keychain。

> Claude Code / Codex 这两家客户端，本工具会**优先调官方 CLI**（`claude mcp add-json --scope user` / `codex mcp add`）写入配置；CLI 不可用时回退到手写配置文件，行为与旧版兼容。

最省事的形态——在 TTY 终端跑零参，按空格挑想装的客户端：

```bash
npx -y tapd-server-cli install
```

会弹出一个 checkbox 多选界面，列出 Claude Code / Codex / OpenCode / Cursor。**空格切换、回车确认**，可以一次选多家。

也可以在命令行直接显式列出客户端（跳过交互、CI 友好）：

```bash
# 单家（向后兼容旧用法）
npx -y tapd-server-cli install claude-code

# 多家（一次安装，PAT 只输入一次）
npx -y tapd-server-cli install claude-code codex
npx -y tapd-server-cli install claude-code codex opencode cursor
```

命令会：
1. 交互式提示输入 TAPD 个人访问令牌一次，复用给所有目标客户端（隐藏输入，**不留 shell history**）
2. 把 `mcpServers.tapd` 条目写入对应客户端的配置文件（写前自动备份到 `.bak.<timestamp>`）
3. 输出每家结果汇总（`✔ wrote` / `= no-op` / `✗ failed`），并提示重启客户端

任意一家失败时不会中断其他家，最后整体退出码为非零。

然后**在客户端新会话里输入 `/mcp__tapd__setup`**，根据向导一路确认，登录 TAPD 后即装配完毕。

只授权一次即可。cookie 持久化到 `~/.config/tapd-mcp/cookie`，过期后再跑一次 `/mcp__tapd__setup` 重新登录。

### `--dry-run` 预览

不写文件，只打印将写入的内容（单家/多家均支持）：

```bash
npx -y tapd-server-cli install claude-code --dry-run
npx -y tapd-server-cli install claude-code codex --dry-run
```

### 非 tty / CI 场景

非 TTY 环境下零参会直接报错以保护脚本。请通过 `TAPD_TOKEN` env 提供令牌、并显式列出客户端：

```bash
TAPD_TOKEN=<your-pat> npx -y tapd-server-cli install claude-code
TAPD_TOKEN=<your-pat> npx -y tapd-server-cli install claude-code codex
```

## 卸载

### Claude Code 用户（plugin 路径）

```text
> /plugin uninstall tapd-server-cli
```

如需同时清理本地 cookie / token 文件：

```bash
npx -y tapd-server-cli uninstall claude-code --purge
```

### 其它客户端（npx install 路径）

与安装对称的撤销入口。零参 TTY 弹 checkbox 多选；显式列出客户端走非交互流程；`--dry-run` 只预览；`--purge` 额外清理本地凭据文件。**不需要输入 PAT**（卸载不读 token）。

```bash
# 交互式多选（TTY 下，空格选，回车确认）
npx -y tapd-server-cli uninstall

# 显式列出
npx -y tapd-server-cli uninstall claude-code
npx -y tapd-server-cli uninstall claude-code codex opencode cursor

# 预览不写入
npx -y tapd-server-cli uninstall claude-code --dry-run

# 同时清理本地 cookie + token 文件（完全清零）
npx -y tapd-server-cli uninstall claude-code --purge
```

命令会：
1. 从对应客户端的 MCP 配置中**仅移除 `mcpServers.tapd`（或 `mcp_servers.tapd`）**节，保留同节下其它 server 条目与文件其它顶层字段；
2. 写前自动备份原文件到 `.bak.<timestamp>`，便于回滚；
3. 输出每家结果汇总（`✔ removed` / `= (no-op)` / `[dry-run]` / `✗ failed`）；
4. 若启用了 `--purge`，在客户端循环结束后清理 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`。

### `--purge` 默认关闭

不加 `--purge` 时，本地 cookie 与 token 文件保留不动 —— 这样下次重新 `install` 不需要再走一遍登录授权。如果你确认要完全清零（换机器、放弃使用、合规要求等），再加 `--purge`。

未启用 `--purge` 但本地实际仍有残留文件时，汇总末尾会输出一行提示：`提示：cookie/token 文件未清除（如需清除请加 --purge）`。

`--purge` 只清两个固定文件名 `cookie` 和 `token`，**不会**递归删除 `~/.config/tapd-mcp/` 目录，也不会触碰目录下其它文件。

### 退出码

| 场景 | exit code |
|---|---|
| 全部 noop / removed / dry-run，且 `--purge`（若启用）全成功 | 0 |
| 任一客户端 failed | 1 |
| 任一 `--purge` 文件删除失败（非 ENOENT） | 1 |
| 未识别客户端 | 2 |
| 非 TTY 零参 | 2 |
| 用户取消多选（Ctrl-C） | 130 |

### 注意

- **TOML 注释丢失**：Codex 的 `~/.codex/config.toml` 由 `@iarna/toml` 解析后重新 stringify，会丢失原文件的注释。这与 install 同款 trade-off。如需保留注释，可从 `.bak.<timestamp>` 备份回滚后手动编辑该节。
- **uninstall 不调 `tapd.logout` MCP 工具**：`tapd.logout` 是 server 运行时工具（需要 server 进程存在），与 CLI uninstall 路径正交。两者最终效果在 cookie 清理上一致，但走不同代码路径。
- **npm 包不自动卸载**：`uninstall` 子命令只处理配置 + 持久化文件。如需移除全局可执行文件，自行执行 `npm uninstall -g tapd-server-cli`。

## 直接运行 server（无 install）

如果你想自己写 MCP 客户端配置，或者用 HTTP 远程传输：

```bash
# stdio 模式（默认）
TAPD_TOKEN=<your-pat> npx -y tapd-server-cli

# HTTP 传输（远程调用）
TAPD_TOKEN=<your-pat> TAPD_MCP_HTTP_PORT=8787 npx -y tapd-server-cli
curl http://127.0.0.1:8787/healthz
```

启动成功后会在 stderr 输出 JSON 日志，关键步骤：

```json
{"step":"token_ok","user_id":"...","user_name":"..."}
{"step":"workspaces_loaded","count":2}
{"step":"tools_registered","resource_tools":42,"setup_prompt":"registered"}
{"step":"stdio_ready"}   // 或 http_ready
```

## Slash 命令（首次设置 / 状态诊断）

MCP server 注册了一个名为 `setup` 的 prompt，客户端会渲染成一条 slash 命令：

- **Claude Code（plugin 路径，推荐）**：
  - `/tapd-server-cli:login` — 登录 TAPD（启用附件下载）
  - `/tapd-server-cli:logout` — 登出 TAPD
  - `/mcp__tapd__setup` — 首次设置向导（含 PAT 验证 + cookie 状态诊断）
- **Cursor**：`/tapd:setup`
- **其它 MCP 客户端**：在客户端的 prompts 列表里找名为 `setup` 的条目

输入即可一键完成首次设置：验证 PAT → 检查 cookie 状态 → 必要时自动弹出隔离浏览器登录 TAPD → 装配附件下载工具 → 总结。

**只需要授权一次**。Cookie 默认持久化到 `~/.config/tapd-mcp/cookie`，下次启动自动加载。当 cookie 过期（一般几小时到几天）后会收到 `unauthenticated` 错误，**再跑一次同样的 slash 命令即可重新登录**，或者直接对 AI 说"重新登录 TAPD"。

## 高级：手动配置 MCP 客户端

如果 `install <client>` 不覆盖你用的客户端，按下面任一模板把 `tapd` 加到对应客户端的 MCP 配置：

### Claude Code / Claude Desktop / Cursor / OpenCode（JSON）

```json
{
  "mcpServers": {
    "tapd": {
      "command": "npx",
      "args": ["-y", "tapd-server-cli"],
      "env": { "TAPD_TOKEN": "<your-pat>" }
    }
  }
}
```

各客户端配置文件路径：
- Claude Code: `~/.claude.json`（家目录顶层 `mcpServers.tapd`）
  > ⚠️ **不是** `~/.claude/settings.json`！`settings.json` 是 permissions / hooks / env / UI 行为的设置文件，**不放** MCP server 配置。如果你打开 `settings.json` 找不到 `tapd`，是找错文件了。
- Cursor: `~/.cursor/mcp.json`
- OpenCode: `~/.config/opencode/mcp.json`

### Codex（TOML）

`~/.codex/config.toml`：

```toml
[mcp_servers.tapd]
command = "npx"
args = ["-y", "tapd-server-cli"]
env = { TAPD_TOKEN = "<your-pat>" }
```

### 其它客户端

任何支持 MCP stdio 传输的客户端只需要：`command=npx`，`args=["-y", "tapd-server-cli"]`，`env.TAPD_TOKEN=<your-pat>`。其它细节查阅该客户端文档。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TAPD_TOKEN` | （必需） | 个人访问令牌 |
| `TAPD_API_BASE` | `https://api.tapd.cn` | API 基地址（私有部署时覆盖） |
| `TAPD_CONCURRENCY` | 8 | 全局并发上限 |
| `TAPD_TIMEOUT_MS` | 30000 | 单请求超时 |
| `TAPD_LOG_LEVEL` | `info` | trace/debug/info/warn/error |
| `TAPD_PERMISSION_TTL_SEC` | 600 | 读探针缓存 TTL |
| `TAPD_MCP_HTTP_PORT` | 未设置 | 启用 streamable HTTP 传输并监听该端口 |
| `TAPD_WEB_COOKIE` | 未设置 | 浏览器登录态 cookie；设置后注册 `tapd.attachments.download` |
| `TAPD_WEB_BASE` | `https://www.tapd.cn` | 主站基地址（Referer 来源） |
| `TAPD_FILE_BASE` | `https://file.tapd.cn` | 附件文件 CDN 基地址 |
| `TAPD_WEB_CONCURRENCY` | 4 | 网页客户端独立并发上限 |

CLI 参数（覆盖环境变量）：`--token <pat>`、`--api-base <url>`、`--http-port <port>`。

令牌也可放在 `~/.config/tapd-mcp/token`（POSIX 平台要求 mode 600）。

## 工具总览

### 元工具（始终注册）

- `tapd.whoami` — 当前令牌身份（脱敏）
- `tapd.list_workspaces` — 令牌可访问的全部 workspace
- `tapd.list_capabilities` — 已注册工具的目录视图（含 `web_client.cookie_source`）
- `tapd.refresh_permissions` — 清缓存并刷新权限快照
- `tapd.login` — 弹出隔离浏览器登录 TAPD，自动抓 cookie，热加载 `tapd.attachments.download`
- `tapd.logout` — 清除 server 端 cookie 文件并注销下载工具

### 资源工具（按令牌权限注册）

命名约定 `tapd.<resource>.<action>`，例如：

- 需求：`tapd.stories.list/get/count/create/update`
- 缺陷：`tapd.bugs.list/get/count/create/update`
- 任务：`tapd.tasks.list/get/count/create/update`
- 迭代：`tapd.iterations.list/get/count/create/update`
- 发布：`tapd.releases.list/get/count/create/update`
- 工时：`tapd.timesheets.list/count/create`
- 评论：`tapd.comments.list/count/create`
- 附件：`tapd.attachments.list/get`、`tapd.attachments.get_download_url`、`tapd.attachments.download`（仅当 `TAPD_WEB_COOKIE` 已配置时注册）
- 工作流：`tapd.workflows.list/get`
- 成员：`tapd.users.list/get`
- 配置：`tapd.categories.list/get`、`tapd.modules.list/get`、`tapd.custom-fields.list`

每个工具接受：

- `workspace_id`（受 enum 限定为令牌可访问的 workspace）
- `filters`（透传给 TAPD 的查询参数，如 `status`、`priority`、`creator` 等）
- `page` / `limit`（分页）
- `fields`（返回字段投影，list/get 用）
- `data`（写操作的字段对象，create/update 用）

写操作的 `description` 以 `[写操作] ` 前缀显式标注，便于客户端确认。

## 附件下载（cookie 模式）

TAPD 的附件下载 OpenAPI（`attachments::get_attachment_download_url`）需要管理员授权 scope，
非管理员账号的 PAT 不能开通。本项目提供**借用浏览器登录态**的替代路径。

### 推荐：在 Claude 里直接调 `tapd.login`

1. 把 MCP server 配好（见上面「MCP 客户端配置示例」）—— **不需要预先配 cookie**。
2. 在 MCP 客户端里说一句"登录 TAPD"（或显式调 `tapd.login` 工具）。
3. 弹出隔离的 Chrome 窗口（独立 user-data-dir，不影响你日常 Chrome），自动打开 TAPD 登录页。
4. 你登录完成 → server 自动抓取 `.tapd.cn` 域全部 cookie → 写入
   `~/.config/tapd-mcp/cookie`（POSIX mode 600）→ 装配 `tapd.attachments.download`
   工具 → 通过 `tools/list_changed` 通知客户端立即可见。
5. 之后直接调用 `tapd.attachments.download` 下载附件。

无需重启 MCP 客户端，无需手动复制 cookie 字符串。

下次进程启动会从文件自动加载 cookie（除非设置了 `TAPD_WEB_COOKIE` 环境变量，env 优先级最高）。

cookie 过期后再调一次 `tapd.login` 即可（任意时刻），或调 `tapd.logout` 主动清除。

`tapd.login` 仅在 stdio 传输模式可用（HTTP 远程模式会拒绝，因为远程 spawn 本地浏览器无意义）。

### 备选：手动配 `TAPD_WEB_COOKIE` 或 `grab-cookie.mjs` 脚本

适合 CI / 无 GUI 桌面 / 自动化场景：

```bash
# 方式 A：自己从浏览器复制 cookie 字符串到 env
TAPD_TOKEN=<pat> TAPD_WEB_COOKIE='name1=v1; name2=v2; ...' tapd-mcp

# 方式 B：用兼容脚本把 cookie 写到 ~/.claude.json（先 build dist/）
npm run build
node scripts/grab-cookie.mjs
```

### `tapd.attachments.download` 调用参数

```
tapd.attachments.download
  workspace_id  必填，TAPD 项目/公司 ID（受工具 enum 限定）
  attachment_id 必填，附件 ID（从 tapd.attachments.list 拿到）
  type          可选，默认 bug。需与附件 entity 字段一致（bug/story/task/iteration/release）
  save_to       可选，绝对路径。提供则落盘，返回 path/content_type/bytes/sha256
                不提供则 inline base64 返回（受 max_inline_mb 限制，默认 5 MB）
  max_inline_mb 可选，1-50，inline 模式的大小上限
```

未配置 cookie 时该工具不会注册，避免误调。`tapd.attachments.get_download_url`
始终注册（仅返回 URL 字符串，不调网络），cookie 不可用时可用它把链接给用户在浏览器自行下载。

### Cookie 来源优先级

`TAPD_WEB_COOKIE` 环境变量 > `~/.config/tapd-mcp/cookie` 文件 > 未配置。

可用 `tapd.list_capabilities` 查 `web_client.cookie_source` 字段确认当前 cookie 来自哪一源。

### Cookie 行为说明

- **过期**：cookie 一般几小时到几天后失效。检测到失效时工具返回 `unauthenticated`。**再调一次 `tapd.login` 即可**（不需要重启）。
- **限速**：TAPD 对短时高频下载会返回中文提示「下载过于频繁，请一分钟后再试」。客户端会归类为 `rate_limited` 错误，等约 1 分钟后再调即可。
- **凭据等级**：cookie 等同账号凭据，**不要提交到 git、聊天工具或截图**。`~/.config/tapd-mcp/cookie` 文件 POSIX 600。
- **撤销**：浏览器登出 TAPD 即让该 cookie 失效；或调 `tapd.logout` 主动清除 server 端文件。
- **完整卸载**：如果你打算永久放弃使用本工具，跑 `npx -y tapd-server-cli uninstall <client> --purge` 一并清理客户端配置 + 本地 cookie + 本地 token（参见上方「卸载」章节）。



| 现象 | 含义 | 处理 |
|---|---|---|
| 启动失败 `配置错误: TAPD_TOKEN 未提供` | 没传令牌 | 设置 `TAPD_TOKEN` 或 `--token` |
| 启动失败 `unauthenticated` | 令牌失效/格式错 | 重新生成 PAT |
| 调用返回 `permission_denied` | 令牌无该资源的写权限（或写失败短缓存） | `tapd.refresh_permissions` 后重试 |
| 调用返回 `not_found` | 资源不存在或令牌无权访问（TAPD 不区分二者） | 用 `tapd.list_workspaces` 核对 workspace_id |
| 调用返回 `invalid_argument` | TAPD 校验失败 | 看 `info` 字段，按字段补全 |
| 调用返回 `rate_limited` | 速率限制 | 降低并发或等待客户端自动重试 |
| 调用返回 `internal` | TAPD 服务端错误 | 看 `requestId` 反馈 TAPD |
| `tapd.attachments.download` 返回 `unauthenticated`（提示 cookie 已失效） | 浏览器 cookie 过期或被撤销 | 再调一次 `tapd.login`（无需重启） |
| `tapd.attachments.download` 返回 `rate_limited`（提示「下载过于频繁」） | TAPD 边缘限速 | 等约 1 分钟后重试，或降低下载频率 |
| `tapd.attachments.download` 工具在 `tools/list` 中不存在 | 还没登录，cookie 未装配 | 调 `tapd.login` 完成登录后，工具会自动通过 `tools/list_changed` 出现 |
| `tapd.login` 返回 `invalid_argument`（找不到 Chrome / Edge） | 本机无浏览器或路径未覆盖 | 安装 Chrome / Edge，或设置 `BROWSER` 环境变量指向浏览器 exe，或回退用 `TAPD_WEB_COOKIE` env |
| `tapd.login` 返回 `invalid_argument`（提示"仅支持 stdio"） | server 启用了 HTTP 传输 | 改用 stdio 启动（不设置 `TAPD_MCP_HTTP_PORT`），或手动配 `TAPD_WEB_COOKIE` env |
| `/mcp` 看不到 `tapd`（Claude Code） | 配置文件位置错或 Claude Code 未重启 | 检查 `~/.claude.json`（**不是** `~/.claude/settings.json`）；完全退出 Claude Code 进程后重启；或在新会话跑 `claude mcp list` 确认 |
| 已通过 `npx install claude-code` 装过、又装 plugin 但 `/mcp` 仍只看到一份 `tapd` | 按 Claude Code 优先级，user scope 屏蔽 plugin | 先 `npx tapd-server-cli uninstall claude-code` 清掉 `~/.claude.json` 顶层 `mcpServers.tapd`，再用 plugin |

## 开发

```bash
# 安装
npm ci

# 运行单元测试
npm test

# 集成测试（需要真实 PAT）
TAPD_TOKEN=<pat> TAPD_TEST_WORKSPACE_ID=<workspace> npm run test:integration

# 本地手动探测脚本
TAPD_TOKEN=<pat> ./scripts/probe-api.sh

# 编译
npm run build

# 启动开发模式（热重载）
TAPD_TOKEN=<pat> npm run dev
```

## 发版（maintainer）

CI 工作流 `.github/workflows/release.yml` 监听 `v*.*.*` tag：

```bash
# 1. 在 main 分支上修改版本号
npm version patch   # 或 minor / major；会自动 commit + tag
git push --follow-tags
```

CI 会自动 `npm ci` → `npm test` → `npm run build` → `npm publish --provenance` → `gh release create`。

需要在 GitHub 仓库 Settings → Secrets 配 **`NPM_TOKEN`**（npm 上生成 automation token）。

push 前请确保 tag 数字与 `package.json.version` 一致，CI 会校验并在不一致时直接 fail。

## 安全

- **令牌等同于账号凭证**：不要写入仓库、聊天记录、截图。
- PAT 只保留在内存中，进程退出即释放，不会被服务自身落盘。
- **Cookie 可由 `tapd.login` 持久化**到 `~/.config/tapd-mcp/cookie`（POSIX mode 600，Windows 依赖用户 profile 私有目录隔离）；这是 server 私有目录，不在 git 仓库内。
- 所有日志中的 PAT 都脱敏为 `前 4 + *** + 后 4`；cookie 整段 redact 为 `***`。

## License

MIT
