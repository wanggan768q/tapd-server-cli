# tapd-server-cli

为腾讯 TAPD 开发的 MCP（Model Context Protocol）Server。
通过**个人访问令牌**（PAT）暴露 TAPD Open API，让 Claude Code / Claude Desktop / Cursor / OpenCode / Codex 等 MCP 客户端直接读写 TAPD 数据（需求 / 缺陷 / 迭代 / 工时 / 评论 / 附件 / 工作流 / 成员…）。

> TAPD 官方 API 文档：<https://o.tapd.tencent.com/document/api-doc/next/api/>
>
> 字段语义、参数细节以官方文档为准。

---

## 1) 准备：获取 TAPD 个人访问令牌

1. 登录 TAPD（<https://www.tapd.cn>）。
2. 进入「设置 → 个人设置 → 安全设置 → API 令牌」，按提示生成个人访问令牌。
3. 复制令牌字符串（仅显示一次），保存到安全位置。

> 令牌等同账号凭证，**不要提交到 Git，不要分享到聊天工具**。

---

## 2) 安装到 MCP 客户端

下面四种方式任选其一，全部等价（最终都把 `mcpServers.tapd` 写到对应客户端的 MCP 配置）。

### A. Claude Code —— 一行命令（推荐）

```bash
claude mcp add-json tapd --scope user '{"type":"stdio","command":"npx","args":["-y","tapd-server-cli"],"env":{"TAPD_TOKEN":"<your-pat>"}}'
```

或用更直观的语法：

```bash
claude mcp add tapd --scope user --env TAPD_TOKEN=<your-pat> -- npx -y tapd-server-cli
```

> Claude Code 的 MCP 配置存在 `~/.claude.json`（家目录顶层 `mcpServers.tapd`），**不是** `~/.claude/settings.json`（后者只放 permissions / hooks / UI 设置，没有 MCP 字段）。`/mcp` 命令查看当前已加载的 MCP server。

### B. Claude Desktop / Cursor / OpenCode —— 粘 JSON

把下面这段并入对应客户端的 MCP 配置文件：

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

| 客户端 | 配置文件 |
|---|---|
| Claude Code | `~/.claude.json`（顶层 `mcpServers.tapd`） |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor（项目级） | `<project>/.cursor/mcp.json` |
| Cursor（全局） | `~/.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/mcp.json` |

### C. Codex —— 粘 TOML

`~/.codex/config.toml`：

```toml
[mcp_servers.tapd]
command = "npx"
args = ["-y", "tapd-server-cli"]
env = { TAPD_TOKEN = "<your-pat>" }
```

或一行命令：

```bash
codex mcp add tapd --env TAPD_TOKEN=<your-pat> -- npx -y tapd-server-cli
```

### D. 其它支持 MCP stdio 的客户端

任何支持 MCP stdio 传输的客户端只需要：`command=npx`，`args=["-y", "tapd-server-cli"]`，`env.TAPD_TOKEN=<your-pat>`。其它细节查阅该客户端文档。

---

## 3) 安装后验证

重启对应客户端，让新的 MCP 配置生效，然后随便问一句：

> "用 tapd 工具看看我能访问哪些 workspace"

客户端会调 `tapd.list_workspaces` 工具返回可访问的项目列表。如果看不到 `tapd` 工具：

- Claude Code：跑 `claude mcp list` 确认 `tapd` 在列表里；进入 Claude Code 后用 `/mcp` 查看连接状态
- 其它客户端：用客户端自带的 MCP 状态面板查看

---

## 4) 附件下载（可选 cookie 模式）

TAPD 的附件下载 OpenAPI 需要管理员授权 scope，非管理员账号的 PAT 不能开通。本项目提供**借用浏览器登录态**的替代路径：

```bash
npx -y tapd-server-cli login
```

会弹独立 Chrome / Edge 窗口，登录 TAPD 后 cookie 自动持久化到 `~/.config/tapd-mcp/cookie`（POSIX 600）。下次启动 MCP server 自动加载，`tapd.attachments.download` 工���立即可用。

Cookie 过期后再跑一次同样命令即可重新登录。

```bash
# 登出（清本地 cookie）
npx -y tapd-server-cli logout
```

替代方案：如果是 CI / 无 GUI 环境，可手动设置 `TAPD_WEB_COOKIE` 环境变量，把浏览器里复制出来的 cookie 字符串塞进去。

---

## 5) 直接运行 server（无客户端）

如果你想自己写 MCP 客户端配置，或者用 HTTP 远程传输：

```bash
# stdio 模式（默认）
TAPD_TOKEN=<your-pat> npx -y tapd-server-cli

# HTTP 传输（远程调用）
TAPD_TOKEN=<your-pat> TAPD_MCP_HTTP_PORT=8787 npx -y tapd-server-cli
curl http://127.0.0.1:8787/healthz
```

启动成功后 stderr 输出 JSON 日志，关键步骤：

```json
{"step":"token_ok","user_id":"...","user_name":"..."}
{"step":"workspaces_loaded","count":2}
{"step":"tools_registered","resource_tools":42,"setup_prompt":"registered"}
{"step":"stdio_ready"}
```

---

## 6) 便利脚本：批量装多家 / 卸载

如果你要一次给 Claude Code / Codex / OpenCode / Cursor 中的多家写配置，本仓库带了一个交互式 installer：

```bash
# TTY 下零参 → 弹 checkbox 多选界面（空格选、回车确认）
npx -y tapd-server-cli install

# 显式列出（CI 友好）
npx -y tapd-server-cli install claude-code
npx -y tapd-server-cli install claude-code codex opencode cursor
```

特性：

- **PAT 隐藏输入只问一次**，复用给所有目标客户端
- 对 Claude Code / Codex 优先调官方 CLI（`claude mcp add-json --scope user` / `codex mcp add`），不可用时回退手写配置文件
- 写前自动备份原文件到 `.bak.<timestamp>`
- `--dry-run` 仅预览不写文件
- 非 TTY 零参直接报错（保护脚本），改通过 `TAPD_TOKEN` env 提供令牌

> 这只是把上面 §2 的"一行命令 / 粘 JSON"批量化的便利脚本——单家场景直接用 §2 的官方路径更直接。

### 卸载

```bash
# 交互多选
npx -y tapd-server-cli uninstall

# 显式列出
npx -y tapd-server-cli uninstall claude-code
npx -y tapd-server-cli uninstall claude-code codex opencode cursor

# 同时清本地 cookie / token 文件
npx -y tapd-server-cli uninstall claude-code --purge
```

uninstall 仅移除 `mcpServers.tapd` 节，保留同节其它 server 与文件其它字段。`--purge` 才会清 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`（默认保留以便再次安装不用重新登录）。

### CLI 子命令一览

```bash
npx tapd-server-cli                              # 启动 server（默认 stdio）
npx tapd-server-cli install [<client>...]        # 写 MCP 配置（多家）
npx tapd-server-cli uninstall [<client>...]      # 移除 MCP 配置
npx tapd-server-cli login [--timeout <sec>]      # 弹浏览器抓 TAPD cookie
npx tapd-server-cli logout                       # 删本地 cookie
npx tapd-server-cli update [--json]              # 检查 npm 上有无新版
npx tapd-server-cli --help                       # 详细帮助
```

---

## 安装 Skills（让模型按规则使用 TAPD 工具）

`install` 子命令只把 `mcpServers.tapd` 写到客户端配置里。模型并不知道**什么时候用哪个工具、字段语义、行为护栏**——这些"使用知识"以独立的 **Skill 包**形式发布，由 `install-skills` 子命令一键铺到客户端。

> 普通安装流程（仅 MCP server）和 Skill 包是相互独立的：可以只装其一，也可以两个都装。

### 一键安装

```bash
# 用户级：写到 ~/.claude/skills/、~/.codex/AGENTS.md 等
npx tapd-server-cli install-skills claude-code codex --scope user

# 项目级：写到当前目录下的 .claude/skills/、CLAUDE.md、AGENTS.md
npx tapd-server-cli install-skills --scope project

# 不指定 client：在 TTY 下弹出 checkbox 多选；非交互环境下报错
npx tapd-server-cli install-skills

# 仅预览，不写文件
npx tapd-server-cli install-skills claude-code --scope user --dry-run
```

第一次运行时，CLI 会自动调 `tapd.whoami` + `tapd.list_workspaces` 探测身份并写到 `~/.tapd/cache.json`；之后的 `install-skills` 调用会复用这份缓存。

### 装了什么

10 个 skill（4 共享 + 6 普通用户）落到对应客户端的目录：

| 客户端 | 用户级 | 项目级 |
|---|---|---|
| Claude Code | `~/.claude/skills/tapd-*/SKILL.md` + `~/.claude/CLAUDE.md` managed block | `<proj>/.claude/skills/tapd-*/SKILL.md` + `<proj>/CLAUDE.md` |
| Codex | `~/.codex/AGENTS.md` managed block（含 skill 全文） | `<proj>/AGENTS.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` managed block | `<proj>/AGENTS.md`（与 Codex 共享） |
| Cursor | `~/.cursor/rules/tapd.mdc` 全文 | `<proj>/.cursor/rules/tapd.mdc` |

每次 `install-skills` 都是幂等的——重跑只会替换 managed block 内的内容，块外用户写的东西原样保留。CLAUDE.md / AGENTS.md 在写入前自动备份原文件（首次写入除外）。

### 升级冲突

如果你手改过某个 SKILL.md，下次 `install-skills` 检测到 hash 不匹配后，会询问 `keep` / `overwrite` / `show diff`：

- 选 `keep` → 跳过这个文件（保留你的改动）
- 选 `overwrite` → 把原文件备份到 `<file>.bak.<时间戳>`，再写新版
- 非交互模式（CI / 管道）默认 `keep`，并在 stdout 列出跳过的清单

### 卸载

```bash
# 默认：清掉 SKILL.md / managed block / tapd.config.json
# 但保留 ~/.tapd/cache.json（server 启动还会用）
npx tapd-server-cli uninstall-skills claude-code codex --scope user

# 同时清掉 cache.json
npx tapd-server-cli uninstall-skills claude-code --scope user --purge-cache

# 仅预览
npx tapd-server-cli uninstall-skills claude-code --scope user --dry-run
```

被你改过的 SKILL.md 会被移到 `<file>.bak.<时间戳>` 而不是直接删除——找不回的内容是工程师最大的痛。

### 行为护栏（hard rules）

skill 文件里固化了 5 条不可被项目配置覆盖的硬规则：

1. **绝不删除任何 TAPD 条目**（不调 `tapd_*_delete`）
2. **绝不把 bug 状态改为 `closed`**（仅到 `resolved`，由报告人 / QA 关闭）
3. **普通用户不能创建 task**（`tapd_tasks_create`）
4. **写操作确认网关**：评论可直接发；改状态 / 改 owner / 创建 / 批量必须先 preview
5. **批量上限 10 条**（超出拆批，每批单独确认）

详见 `tapd-safety-rules` skill 的正文。

### 相关命令

| 命令 | 作用 |
|---|---|
| `npx tapd-server-cli install-skills <client...>` | 安装 skill 包 |
| `npx tapd-server-cli uninstall-skills <client...>` | 卸载 skill 包，可选 `--purge-cache` |
| `npx tapd-server-cli login` | 重新抓 cookie（处理 401/403） |
| `npx tapd-server-cli update` | 检查 npm 上有无新版 |

> 注：`switch-role` 子命令是占位——管理者 skill 上线后才启用，本版本运行会以退出码 2 提示。



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

---

## 工具总览

### 元工具（始终注册）

- `tapd.whoami` — 当前令牌身份（脱敏）
- `tapd.list_workspaces` — 令牌可访问的全部 workspace
- `tapd.list_capabilities` — 已注册工具的目录视图（含 `web_client.cookie_source`）
- `tapd.refresh_permissions` — 清缓存并刷新权限快照
- `tapd.login` — 弹出隔离浏览器登录 TAPD，自动抓 cookie，热加载 `tapd.attachments.download`
- `tapd.logout` — 清除 server 端 cookie 文件并注销下载工具

> `tapd.login` / `tapd.logout` 与终端 `npx tapd-server-cli login` / `logout` 是两条等价并行路径。前者由 MCP 客户端调 server 内工具触发（仅 stdio 传输可用），后者直接终端跑、不依赖 server 在线。**首次登录推荐走终端路径**——更直接、不绑定客户端 GUI。

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

���操作的 `description` 以 `[写操作] ` 前缀显式标注，便于客户端确认。

---

## Setup prompt（客户端内的设置向导）

MCP server 注册了一个 `setup` prompt，在不同客户端被渲染成不同 slash 命令名：

- **Claude Code / Claude Desktop**：`/mcp__tapd__setup`
- **Cursor**：`/tapd:setup`
- **其它 MCP 客户端**：在客户端的 prompts 列表里找名为 `setup` 的条目

输入这条 prompt 即可在会话里走一遍：验证 PAT → 检查 cookie 状态 → 必要时自动弹浏览器登录 → 装配附件下载工具 → 总结。

> 该 prompt 与终端 `npx tapd-server-cli login` 二选一，行为等价；终端路径更直接。

---

## 故障排查

| 现象 | 含义 | 处理 |
|---|---|---|
| 启动失败 `配置错误: TAPD_TOKEN 未提供` | 没传令牌 | 设置 `TAPD_TOKEN` 或 `--token` |
| 启动失败 `unauthenticated` | 令牌失效/格式错 | 重新生成 PAT |
| 调用返回 `permission_denied` | 令牌无该资源的写权限 | `tapd.refresh_permissions` 后重试 |
| 调用返回 `not_found` | 资源不存在或令牌无权访问 | 用 `tapd.list_workspaces` 核对 workspace_id |
| 调用返回 `invalid_argument` | TAPD 校验失败 | 看 `info` 字段，按字段补全 |
| 调用返回 `rate_limited` | 速率限制 | 降低并发或等待客户端自动重试 |
| 调用返回 `internal` | TAPD 服务端错误 | 看 `requestId` 反馈 TAPD |
| `tapd.attachments.download` 返回 `unauthenticated` | 浏览器 cookie 过期或被撤销 | 再调一次 `tapd.login` 或终端 `npx tapd-server-cli login` |
| `tapd.attachments.download` 返回 `rate_limited`（"下载过于频繁"） | TAPD 边缘限速 | 等约 1 分钟后重试 |
| `tapd.attachments.download` 工具在 `tools/list` 中不存在 | 还没登录，cookie 未装配 | 调 `tapd.login` 完成登录 |
| `/mcp` 看不到 `tapd`（Claude Code） | 配置文件位置错或 Claude Code 未重启 | 检查 `~/.claude.json`（**不是** `~/.claude/settings.json`）；完全退出 Claude Code 进程后重启；或在新会话跑 `claude mcp list` 确认 |
| `npx -y tapd-server-cli` 报 `Node.js 版本不满足要求` | 当前 Node 低于 22.13.0 | `nvm install 22 && nvm use 22`；或访问 <https://nodejs.org/> 下载 LTS |
| `npm warn EBADENGINE Unsupported engine ... mute-stream@4.0.0` | 传递依赖声明的 Node 范围比我们 `engines.node` 严 | **可忽略**——warning 不阻断，实测 22.13 即可正常使用 |

---

## 安全

- **令牌等同账号凭证**：不要写入仓库、聊天记录、截图。
- PAT 只保留在内存中，进程退出即释放，server 自身不会落盘。
- **Cookie 可由 `tapd.login` 持久化**到 `~/.config/tapd-mcp/cookie`（POSIX mode 600）；这是 server 私有目录，不在 git 仓库内。
- 所有日志中的 PAT 都脱敏为 `前 4 + *** + 后 4`；cookie 整段 redact 为 `***`。

---

## 开发

```bash
# 安装
npm ci

# 单元测试
npm test

# 集成测试（需要真实 PAT）
TAPD_TOKEN=<pat> TAPD_TEST_WORKSPACE_ID=<workspace> npm run test:integration

# 本地手动探测
TAPD_TOKEN=<pat> ./scripts/probe-api.sh

# 编译
npm run build

# 开发模式（热重载）
TAPD_TOKEN=<pat> npm run dev
```

---

## 发版（maintainer）

CI 工作流 `.github/workflows/release.yml` 监听 `v*.*.*` tag：

```bash
npm version patch   # 或 minor / major；自动 commit + tag
git push --follow-tags
```

CI 会自动 `npm ci` → `npm test` → `npm run build` → `npm publish --provenance` → `gh release create`。

需要在 GitHub 仓库 Settings → Secrets 配 **`NPM_TOKEN`**（npm 上生成 automation token）。

push 前请确保 tag 数字与 `package.json.version` 一致，CI 会校验并在不一致时直接 fail。

---

## License

MIT
