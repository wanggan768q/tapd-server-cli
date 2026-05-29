## Why

`remove-claude-code-plugin` change 删除了 `tapd.update` MCP 工具——但它解决的真问题"如何告诉用户有新版"仍然存在。原 plugin 用户跑 `/tapd-server-cli:update` 就能看到 `current=0.2.2 / latest=0.3.0` + `npx -y tapd-server-cli@latest install claude-code` ��级建议；删了之后用户没有任何信号知道仓库出了新版。

同时 `tapd.login` `tapd.logout` MCP 工具的入口在 plugin 时代是 `/tapd-server-cli:login` slash 命令——`install-claude-code-user-scope-commands` change 通过 user-scope commands 把这条入口保留下来，但**仅限 Claude Code 用户**。Codex / OpenCode / Cursor 用户、纯终端用户没有等价路径。

把这些功能搬到 CLI 子命令解决两件事：

- 终端用户跑 `npx tapd-server-cli login` 就能弹浏览器抓 cookie，不依赖任何 IDE
- `npx tapd-server-cli update` 替代删除的 `tapd.update` MCP 工具，提供版本检查 + 升级建议
- CLI 与 MCP server 共享底层逻辑（不重复实现）——`src/auth/browser-login.ts` 已经是核心 cookie 抓取逻辑、`src/tools/login.ts` 是 MCP wrapper，CLI 子命令也调同一份核心

## What Changes

- **新增 CLI 子命令**（`src/cli.ts` commander 路由）：
  - `tapd-server-cli login` — 弹浏览器抓 TAPD cookie，写入 `~/.config/tapd-mcp/cookie`
  - `tapd-server-cli logout` — 删除 `~/.config/tapd-mcp/cookie`
  - `tapd-server-cli update` — 读 `package.json.version` 作为 current；spawnSync `npm view tapd-server-cli version` 拿 latest；输出 current/latest/comparison + 升级建议（`npm install -g tapd-server-cli@latest` 或 `npx tapd-server-cli@latest install <client>`）
- **重写 commands/update.md**：内文从"调 MCP 工具 tapd.update"改为"用户在终端跑 `npx tapd-server-cli update`"——slash 命令变成"指引用户去终端"的 thin wrapper，因为 MCP 工具已删
- **抽出共享逻辑**：
  - `src/auth/browser-login.ts` 已经是 OS 级 cookie 抓取（spawn 浏览器、抓 cookie）的"核心层"——CLI login 子命令直接调它，与 `src/tools/login.ts` MCP 工具版本共享
  - `src/auth/cookie-store.ts` 已经是 cookie 持久化（读写 `~/.config/tapd-mcp/cookie` POSIX 600）—— logout CLI 子命令直接调
  - 不重复实现这些低层逻辑；仅在 `src/cli.ts` 加 thin command handlers
- **测试覆盖**：
  - `test/unit/cli-commands.test.ts`（新增）：login / logout / update 三个子命令的 commander 解析 + 调用 dispatch；用 mock 注入避免真去 spawn 浏览器或调真 npm registry
  - `test/unit/cli.test.ts`（如已存在则扩展）：覆盖新增子命令的 `--help` 输出 + 错误处理

## Capabilities

### New Capabilities
（无）

### Modified Capabilities

- `installer-cli`：新增 Requirement "CLI 子命令 login/logout/update 提供 plugin 时代 slash 命令的等价物"——含三个子命令的具体行为契约 + 输出格式 + 退出码

## Impact

**代码**

| 文件 | 操作 |
|---|---|
| `src/cli.ts` | EDIT 加 commander 子命令 `login` `logout` `update` |
| `src/commands/login-handler.ts`（新增） | 调 `src/auth/browser-login.ts` 的 `loginAndCaptureCookie()`；写 `~/.config/tapd-mcp/cookie`；输出友好消息 |
| `src/commands/logout-handler.ts`（新增） | 调 `src/auth/cookie-store.ts` 的 `clearCookie()`；输出友好消息 |
| `src/commands/update-handler.ts`（新增） | 读 `package.json.version`、spawn `npm view tapd-server-cli version`、比对、输出建议 |
| `commands/update.md` | EDIT 重写——内文指向 `npx tapd-server-cli update` 终端命令而非已删除 MCP 工具 |
| `test/unit/cli-commands.test.ts`（新增） | 单元覆盖三个子命令 |
| `README.md` | EDIT 加"CLI 子命令"节 + 更新 Slash 命令节（与 §B install-claude-code-user-scope-commands 协调） |

**API**

- **新增**：`tapd-server-cli login` `tapd-server-cli logout` `tapd-server-cli update` 三个 CLI 子命令
- **保留**：`tapd-server-cli install <client>` `tapd-server-cli uninstall <client>` 不变
- **退出码**：login 失败（无法弹浏览器 / 无法写 cookie 文件）非 0；logout 失败非 0；update 任何状态都退出 0（仅信息输出，不"动作失败"）；如 npm registry 不可达 update 输出 fetch_error 但仍 exit 0

**发版**

- 与 `remove-claude-code-plugin` 和 `install-claude-code-user-scope-commands` 共用 v0.3.0 发版

**不影响**

- `tapd.login` `tapd.logout` MCP 工具仍在（plugin 用户没了，但 npx install 的用户在 Claude Code 内仍可对话调起这些工具）
- `~/.config/tapd-mcp/cookie` 文件路径与格式不变
- `package.json.bin` 入口不变（同一个 `dist/index.js`，commander 路由分流）
