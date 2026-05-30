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
- **Slash 命令向导**：在客户端里输入 `/mcp__tapd__setup` 一键完成 PAT 验证、cookie 登录、附件下载工具装配；也可在终端直接 `npx tapd-server-cli login` 完成登录（v0.3.0 起两条等价路径）。
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

最简单的安装方式——一条 npx 命令：

```bash
npx -y tapd-server-cli install claude-code
```

会做三件事：

1. 提示输入 TAPD 个人访问令牌（PAT），写入 `~/.claude.json` 顶层 `mcpServers.tapd`（隐藏输入，**不留 shell history**）
2. 优先调 `claude mcp add-json --scope user` 注册（不可用时回退手写文件，行为兼容）
3. 复制 `commands/*.md` 到 `~/.claude/commands/tapd-server-cli/`，启用 user-scope slash 命令：
   - `/tapd-server-cli:login` — 登录 TAPD（弹独立浏览器抓 cookie）
   - `/tapd-server-cli:logout` — 登出 TAPD
   - `/tapd-server-cli:update` — 检查是否有新版

> **配置文件位置**：Claude Code 的 MCP 配置存在 `~/.claude.json`（家目录顶层），不是 `~/.claude/settings.json`（settings 文件不放 MCP）。如果你之前在 `settings.json` 里找过 `tapd` 配置没找到，是找错文件了。

> v0.3.0 起本工具不再以 Claude Code plugin 形式分发（SSH 22 在部分网络下被阻断，marketplace 添加不可达）。改走 npm + user-scope commands 双路径，安装更可靠。

### 首次使用附件下载

附件下载需要浏览器 cookie（PAT 不够，TAPD 限制）。在终端跑：

```bash
npx -y tapd-server-cli login
```

会弹出隔离 Chrome / Edge 窗口，登录 TAPD 后 cookie 自动持久化到 `~/.config/tapd-mcp/cookie`，附件下载工具立即可用。

> 也可以在 Claude Code 会话里输入 `/tapd-server-cli:login` 让 AI 引导你跑这条命令——本质是同一条终端命令，user-scope slash 命令只是入口提示。

### 升级

```bash
# 检查 npm 上是否有新版（仅检查，不自动升级）
npx -y tapd-server-cli update

# 全局升级
npm i -g tapd-server-cli@latest

# 或者下次 npx 自动用最新版（不用手动升级）
npx -y tapd-server-cli@latest install claude-code
```

## 通用形态：交互式选择 / 多客户端 / CI

适用于在终端批量装 Claude Code / Codex / OpenCode / Cursor 任意子集，包括 CI 与脚本场景。

> ⚠️ **注意 — Claude Code 的 MCP 配置文件位置**：MCP server 写在 `~/.claude.json`（家目录顶层 `mcpServers.tapd`），**不是** `~/.claude/settings.json`（permissions / hooks / UI 行为的设置）。`settings.json` 里找不到 `tapd` 不是 bug——是找错文件了。

> Claude Code / Codex 这两家客户端，本工具会**优先调官方 CLI**（`claude mcp add-json --scope user` / `codex mcp add`）写入配置；CLI 不可用时回退到手写配置文件，行为与旧版兼容。

最省事的形态——在 TTY 终端跑零参，弹 checkbox 多选界面：

```bash
npx -y tapd-server-cli install
```

界面列出 Claude Code / Codex / OpenCode / Cursor。**键位**：

- `空格`：勾选/取消当前项
- `↑/↓`：移动光标
- `a`：全选 / 全不选切换
- `i`：反选
- `回车`：确认（不勾任何项 → exit 1）
- `Ctrl-C`：取消（exit 130）

也可以在命令行直接显式列出客户端（跳过交互、CI 友好）：

```bash
# 单家
npx -y tapd-server-cli install claude-code

# 多家（一次安装，PAT 只输入一次）
npx -y tapd-server-cli install claude-code codex
npx -y tapd-server-cli install claude-code codex opencode cursor
```

命令会：
1. 交互式提示输入 TAPD 个人访问令牌一次，复用给所有目标客户端（隐藏输入，**不留 shell history**）
2. 把 `mcpServers.tapd` 条目写入对应客户端的配置文件（写前自动备份到 `.bak.<timestamp>`）
3. **若目标含 `claude-code`**，额外把 `commands/*.md` 拷到 `~/.claude/commands/tapd-server-cli/`（启用 `/tapd-server-cli:login` 等 user-scope slash 命令；其它客户端没有此机制，跳过）
4. 输出每家结果汇总（`✔ wrote` / `= no-op` / `✗ failed`），并提示重启客户端

任意一家失败时不会中断其他家，最后整体退出码为非零。

> 装好后即可在客户端使用 MCP 工具。如果想在客户端内走"一键设置向导"，可输入 `/mcp__tapd__setup`（MCP server 内置 prompt，等价于终端 `npx tapd-server-cli login`，二选一）。

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

```bash
# 交互式多选（TTY 下，空格选，回车确认）
npx -y tapd-server-cli uninstall

# 显式列出
npx -y tapd-server-cli uninstall claude-code
npx -y tapd-server-cli uninstall claude-code codex opencode cursor

# 同时清理 ~/.claude/commands/tapd-server-cli/ + 本地 cookie/token 文件
npx -y tapd-server-cli uninstall claude-code --purge
```

claude-code 的 uninstall 会**额外移除**：

- `~/.claude/commands/tapd-server-cli/` 整个 namespace 目录（v0.3.0 起：install 拷过去的 user-scope slash 命令）
- `mcpServers.tapd` 节（保留同节下其它 server 条目与文件其它顶层字段）

`--purge` 才会清 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`（默认保留以便再次安装不用重新登录）。

写前会自动备份原 MCP 配置文件到 `.bak.<timestamp>`，便于回滚。输出每家结果汇总：`✔ removed` / `= (no-op)` / `[dry-run]` / `✗ failed`。

未启用 `--purge` 但本地实际仍有残留文件时，汇总末尾会输出一行提示：`提示：cookie/token 文件未清除（如需清除请加 --purge）`。`--purge` 只清两个固定文件名 `cookie` 和 `token`，**不会**递归删除 `~/.config/tapd-mcp/` 目录，也不会触碰目录下其它文件。

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

**Claude Code（user-scope commands，v0.3.0 起默认）** —— `npx tapd-server-cli install claude-code` 会把这三条命令拷到 `~/.claude/commands/tapd-server-cli/`：

- `/tapd-server-cli:login` — 登录 TAPD（弹独立浏览器抓 cookie，启用附件下载）
- `/tapd-server-cli:logout` — 登出 TAPD（删本地 cookie）
- `/tapd-server-cli:update` — 检查 npm 上是否有 `tapd-server-cli` 新版

> 这三条 slash 命令本质是 **AI 引导提示**：让 AI 知道用户想做什么，并提示用户在终端执行对应的 `npx tapd-server-cli login` / `logout` / `update`。真正的副作用（弹浏览器、删文件、查 npm）在终端命令里发生，不在 MCP server 里。

外加 MCP server 注册的 prompt（不依赖 user-scope commands）：

- **Claude Code**：`/mcp__tapd__setup` — 首次设置向导（PAT 验证 + cookie 状态诊断 + 自动登录）
- **Cursor**：`/tapd:setup`
- **其它 MCP 客户端**：在客户端的 prompts 列表里找名为 `setup` 的条目

> 同一 MCP prompt 在不同客户端被渲染成不同 slash 命令名（`/mcp__<server>__<prompt>` vs `/<server>:<prompt>` 等），这是各客户端按自身 namespace 规则的差异，不是 server 配置项。

输入 `/mcp__tapd__setup` 即可一键完成首次设置：验证 PAT → 检查 cookie 状态 → 必要时自动弹出隔离浏览器登录 TAPD → 装配附件下载工具 → 总结。

> **`/mcp__tapd__setup` 与终端 `npx tapd-server-cli login` 二选一**：前者在 MCP 会话里走 server 内的 `tapd.login` 工具弹浏览器；后者直接在终端弹浏览器。两条路径最终都把 cookie 写到 `~/.config/tapd-mcp/cookie`，行为等价。Cookie 过期后两条路径任选其一重新登录，**v0.3.0 起推荐终端路径**——不依赖 server 在线、不绑定客户端 GUI。

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

### CLI 子命令一览（v0.3.0）

```bash
npx tapd-server-cli                              # 启动 server（默认 stdio）
npx tapd-server-cli install [<client>...]        # 写 MCP 配置 + 拷 user-scope slash 命令（仅 claude-code）
npx tapd-server-cli uninstall [<client>...]      # 移除 MCP 配置（claude-code 同时移除 commands 目录）
npx tapd-server-cli login [--timeout <sec>]      # 弹独立浏览器抓 TAPD cookie（默认 300s）
npx tapd-server-cli logout                       # 删本地 cookie 文件
npx tapd-server-cli update [--json]              # 检查 npm 上是否有新版（仅检查不自动升级）
npx tapd-server-cli --help                       # 详细帮助
```

## 工具总览

### 元工具（始终注册）

- `tapd.whoami` — 当前令牌身份（脱敏）
- `tapd.list_workspaces` — 令牌可访问的全部 workspace
- `tapd.list_capabilities` — 已注册工具的目录视图（含 `web_client.cookie_source`）
- `tapd.refresh_permissions` — 清缓存并刷新权限快照
- `tapd.login` — 弹出隔离浏览器登录 TAPD，自动抓 cookie，热加载 `tapd.attachments.download`
- `tapd.logout` — 清除 server 端 cookie 文件并注销下载工具

> **v0.3.0 起 `tapd.login` / `tapd.logout` 与终端 `npx tapd-server-cli login` / `logout` 是两条等价并行路径**——前者由 MCP 客户端调 server 内工具触发，后者直接终端跑、不依赖 server 在线。最终都把 cookie 写到 `~/.config/tapd-mcp/cookie`，行为完全一致。MCP 工具 `tapd.update` 在 v0.3.0 已移除，对应能力由终端 `npx tapd-server-cli update` 承接。

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

### 推荐：终端 `npx tapd-server-cli login`（v0.3.0 起）

```bash
npx -y tapd-server-cli login
```

弹出隔离 Chrome / Edge 窗口（独立 user-data-dir，不污染日常浏览器），登录完成后自动：

1. 抓取 `.tapd.cn` 域全部 cookie
2. 拼成 `Cookie:` 头形态写入 `~/.config/tapd-mcp/cookie`（POSIX 600）
3. 关闭浏览器、清理临时 user-data-dir
4. exit 0

**不依赖 MCP server 在线**——这是 v0.3.0 起的推荐路径。下次启动 MCP server 自动从文件加载 cookie，`tapd.attachments.download` 工具立即可用。Cookie 过期后再跑一次同样命令即可重新登录。

### 备选 A：在 MCP 会话里调 `tapd.login` 工具

1. 把 MCP server 配好（见上面「MCP 客户端配置示例」）—— **不需要预先配 cookie**。
2. 在 MCP 客户端里说一句"登录 TAPD"（或显式调 `tapd.login` 工具）。
3. 弹出隔离的 Chrome 窗口，自动打开 TAPD 登录页。
4. 你登录完成 → server 自动抓取 cookie → 写入 `~/.config/tapd-mcp/cookie` → 装配 `tapd.attachments.download` 工具 → 通过 `tools/list_changed` 通知客户端立即可见。

无需重启 MCP 客户端，无需手动复制 cookie 字符串。与终端 `login` 是等价并行路径。

`tapd.login` 仅在 stdio 传输模式可用（HTTP 远程模式会拒绝，因为远程 spawn 本地浏览器无意义）；终端 `npx tapd-server-cli login` 不受此限制——它根本不经 MCP 协议。

### 备选 B：手动配 `TAPD_WEB_COOKIE` 或 `grab-cookie.mjs` 脚本

适合 CI / 无 GUI 桌面 / 自动化场景：

```bash
# 方式 A：自己从浏览器复制 cookie 字符串到 env
TAPD_TOKEN=<pat> TAPD_WEB_COOKIE='name1=v1; name2=v2; ...' tapd-mcp

# 方式 B：用兼容脚本把 cookie 写到 ~/.claude.json（先 build dist/）
npm run build
node scripts/grab-cookie.mjs
```

> v0.3.0 起方式 B 主要给 0.2.x 旧脚本用户做向后兼容；新用户推荐直接 `npx tapd-server-cli login`，更直接、不需要先 build。

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
| 已通过 `npx install claude-code` 装过、又装 plugin 但 `/mcp` 仍只看到一份 `tapd` | 已无关：v0.3.0 起不再以 plugin 形式分发 | 仅 `npx -y tapd-server-cli install claude-code` 即可（同时安装 user-scope slash 命令） |
| `npx -y tapd-server-cli install` 报 `✗ Node.js 版本不满足要求` | 当前 Node 低于 22.13.0（v0.3.x 起的最低支持线） | `nvm install 22 && nvm use 22`（macOS/Linux 用 nvm，Windows 用 nvm-windows）；或访问 <https://nodejs.org/> 下载 LTS。npm install 阶段先看到 EBADENGINE warning 不阻断，运行时再次拒绝并 exit 2 |
| `npm warn EBADENGINE Unsupported engine ... mute-stream@4.0.0 ... required: { node: '^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0' }` | 传递依赖（PAT 隐藏输入用）声明的 Node 范围比我们 `engines.node` 严 | **可忽略**——warning 不阻断，实测 22.13 即可正常使用。彻底消除：升级到 Node 22.22.2+ 或 24.15+ |

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
