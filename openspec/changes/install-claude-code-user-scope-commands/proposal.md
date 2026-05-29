## Why

`remove-claude-code-plugin` change 把整个 plugin 体系撤回——但 plugin 时代用户已熟悉的 `/tapd-server-cli:login` `/logout` `/update` slash 命令是真有 UX 价值的：

- 用户在 Claude Code 会话里键入 `/tapd-server-cli:login` 比"对 Claude 说'调一下 tapd.login 工具'"短、明确、不靠 Claude 的工具调用判断
- frontmatter 的 `description` 字段在 `/` 自动补全列表里直接告诉用户"登录 TAPD（弹出隔离浏览器抓 cookie，启用附件下载）"
- 把 cookie 流程入口前置到 slash 命令而不是埋在 MCP 工具里，发现性高一档

Claude Code 提供的**不依赖 plugin** 的 user-scope commands 机制天然能承接：放 `~/.claude/commands/<namespace>/<name>.md` 就自动注册成 `/<namespace>:<name>` slash 命令——和 plugin 路径并列的另一条原生入口，没 marketplace 网络依赖、没 manifest 维护负担。

本 change 让 `npx tapd-server-cli install claude-code` 在写 `~/.claude.json` 之外，**额外把 `commands/login.md` `logout.md` `update.md` 拷贝到 `~/.claude/commands/tapd-server-cli/`**，让 plugin 时代的 slash 命令体验在 npx 路径上等价保留。

## What Changes

- **claude-code adapter 增强**：`src/installer/adapters/claude-code.ts` 的 install 流程增加一步——把 npm 包内 `commands/*.md` 拷到 `~/.claude/commands/tapd-server-cli/`
- **uninstall 反向清理**：`uninstall claude-code` 删除 `~/.claude/commands/tapd-server-cli/` 整目录；`--purge` 不需特殊处理（commands 目录本就是 install 副产物，uninstall 时删干净）
- **commands/ 进 npm tarball**：
  - `package.json.files` 白名单加 `"commands"`
  - `.npmignore` 删 `commands/` 排除项
  - `.github/workflows/release.yml` 的 `Verify npm package excludes plugin files` step 的 grep 正则更新——去掉 `^commands/`，保留 `\.claude-plugin/|\.mcp\.json|^skills/|^openspec/|^docs/`
- **commands 内容保留不动**：`commands/login.md` `logout.md` 文本写"调 MCP 工具 tapd.login / tapd.logout"——在 user-scope 路径下仍然合适（前提是 server 已通过 `npx install` 注册到同会话），不需要改文本（brainstorm Q2.a 决定）
- **`commands/update.md` 重写**：由 `add-cli-subcommands-login-logout-update` change 重新建立（内容指向 CLI update 子命令而非已删除的 MCP 工具）；本 change 的 install 流程在文件存在时拷贝它，不存在时跳过——这种 graceful 保证三个 change 间不依赖严格 archive 顺序
- **测试覆盖**：`test/unit/installer-adapters.test.ts` 现有 `claude-code` 测试增加用例覆盖 commands 拷贝；新增 `installer-flow.test.ts` 集成用例验证完整 install 流程后 `~/.claude/commands/tapd-server-cli/login.md` 文件实际写入
- **README 更新**：在 npx install claude-code 节加一段说明"安装时会同时把 slash 命令拷到 ~/.claude/commands/tapd-server-cli/"，列出三个可用 slash 命令

## Capabilities

### New Capabilities
（无）

### Modified Capabilities

- `installer-cli`：新增 Requirement "claude-code install 同步拷贝 user-scope commands"（含 login/logout/update 文件 + 拷贝时机 + 失败处理 + uninstall 反向）；新增 Requirement "uninstall claude-code 反向清理 user-scope commands"

## Impact

**代码**

| 文件 | 操作 |
|---|---|
| `src/installer/adapters/claude-code.ts` | EDIT 加 `installCommands()` + `removeCommands()` 调用 |
| `src/installer/flow.ts` | EDIT install 成功后调 `installCommands`；uninstall 成功后调 `removeCommands` |
| `src/installer/uninstall-flow.ts` | EDIT 同 flow.ts uninstall 路径 |
| `package.json` | EDIT `files` 白名单加 `"commands"` |
| `.npmignore` | EDIT 删 `commands/` 排除项 |
| `.github/workflows/release.yml` | EDIT `Verify npm package excludes plugin files` step 的 grep 更新 |
| `test/unit/installer-adapters.test.ts` | EDIT 加 `claude-code` 拷贝测试 |
| `test/unit/installer-flow.test.ts` | EDIT 加端到端集成测试 |
| `README.md` | EDIT 加 user-scope commands 说明节 |
| `commands/login.md` `logout.md` | UNCHANGED（保留文本） |
| `commands/update.md` | 由 `add-cli-subcommands-login-logout-update` change 重写；本 change install 流程对它做 graceful 拷贝 |

**API**

- `tapd-server-cli install claude-code` 行为变化：除写 `~/.claude.json` 外，**新增**拷贝 commands 到 `~/.claude/commands/tapd-server-cli/`。**向后兼容**：未运行过 `install claude-code` 的用户不受影响；运行过的用户重新跑一次 `install` 即可获得 slash 命令
- `tapd-server-cli uninstall claude-code` 行为变化：**新增**清理 `~/.claude/commands/tapd-server-cli/` 目录。**向后兼容**：之前 install 没拷过的目录不存在，rm 静默失败

**发版**

- 与 `remove-claude-code-plugin` 和 `add-cli-subcommands-login-logout-update` 共用 v0.3.0 发版
- npm tarball 体积增加（commands/ 三个 .md 文件，约 2KB）

**不影响**

- `~/.claude.json` 的 mcpServers.tapd 写入逻辑不变
- codex / opencode / cursor 三家适配器不动——它们没有等价的 user-scope commands 机制（OpenCode 有 plugin npm 包机制走 `bun install`、Codex 有自己的 plugin marketplace、Cursor 没 slash 命令体系）
- 现有 npx install 路径的 CLI prefer (`claude mcp add-json --scope user`) 逻辑不变——拷贝 commands 是这一步的副产物
