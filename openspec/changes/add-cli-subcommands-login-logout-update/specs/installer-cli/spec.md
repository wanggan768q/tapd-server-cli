## ADDED Requirements

### Requirement: CLI 子命令 login / logout / update 在终端独立可用

`tapd-server-cli` CLI MUST 提供三个子命令 `login` / `logout` / `update`，让终端用户不依赖任何 IDE 也能完成 plugin 时代的同款任务（cookie 抓取 / cookie 清理 / 版本检查 + 升级建议）。

子命令路由通过 commander 实现，与现有 `install <client>` `uninstall <client>` 对称——commander 解析 argv、dispatch 到 `src/commands/<name>-handler.ts` 的 handler。

#### Scenario: tapd-server-cli login 弹浏览器抓 cookie

- **WHEN** 用户在终端跑 `npx tapd-server-cli login`
- **THEN** CLI 调 `src/auth/browser-login.ts` 的 `loginAndCaptureCookie()`，弹独立 Chrome / Edge 窗口打开 TAPD 登录页
- **AND** 用户在浏览器登录后，CLI 抓取 `.tapd.cn` 域 cookie 写入 `~/.config/tapd-mcp/cookie`（POSIX mode 600）
- **AND** stdout 输出友好消息（如 `✓ Logged in. Cookie saved to ~/.config/tapd-mcp/cookie`）
- **AND** exit code 0

#### Scenario: tapd-server-cli login 浏览器超时——退出码 1 + 友好错误

- **WHEN** 用户跑 `npx tapd-server-cli login --timeout 5`（5 秒超时）
- **AND** 5 秒内未完成登录
- **THEN** stderr 输出 `Error: browser login timeout (5s); see ~/.config/tapd-mcp/...` 类似消息
- **AND** exit code 1
- **AND** stderr 不含 PAT 明文（虽然 login 流程不持 PAT，仍按 redactError 风格保持）

#### Scenario: tapd-server-cli logout 清除 cookie

- **WHEN** 用户跑 `npx tapd-server-cli logout`
- **THEN** CLI 调 `src/auth/cookie-store.ts` 的 `clearCookie()`，删除 `~/.config/tapd-mcp/cookie`
- **AND** stdout 输出 `✓ Logged out. Cookie cleared.`
- **AND** exit code 0

#### Scenario: tapd-server-cli logout 在没 cookie 时不抛错

- **WHEN** 用户跑 `npx tapd-server-cli logout` 且 `~/.config/tapd-mcp/cookie` 不存在
- **THEN** CLI 静默成功
- **AND** stdout 输出 `= No cookie file found, nothing to clear.`
- **AND** exit code 0

#### Scenario: tapd-server-cli update 当前是最新——up-to-date 输出

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** `package.json.version` = `0.3.0` 且 `npm view tapd-server-cli version` 返回 `0.3.0`
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  0.3.0 (npm registry)

  ✓ Up to date.
  ```
- **AND** exit code 0

#### Scenario: tapd-server-cli update 有新版——给升级建议

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** current = `0.3.0`、latest = `0.3.1`
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  0.3.1 (npm registry)

  ! Update available.

  To upgrade:
    npm install -g tapd-server-cli@latest
  or:
    npx tapd-server-cli@latest install claude-code   # 重新装到 Claude Code 含 user-scope commands 同步
  ```
- **AND** exit code 0（信息查询，不是动作失败）

#### Scenario: tapd-server-cli update --json 输出结构化

- **WHEN** 用户跑 `npx tapd-server-cli update --json`
- **THEN** stdout 输出单行 JSON：
  ```json
  {"current":"0.3.0","latest":"0.3.1","comparison":"outdated","upgrade_commands":["npm install -g tapd-server-cli@latest","npx tapd-server-cli@latest install claude-code"]}
  ```
- **AND** exit code 0

#### Scenario: tapd-server-cli update 网络不可达——permissive 退出 0

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** `npm view` 因网络/registry 不可达/npm 不在 PATH 失败
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  <unable to fetch from npm registry: ...>

  ! Network error; cannot check for updates.
  ```
- **AND** exit code 0（**不**是 1——update 是信息查询，网络错误不算动作失败）

#### Scenario: tapd-server-cli update --json 网络不可达——fetch_error 字段

- **WHEN** 同上但加 `--json`
- **THEN** stdout 输出 JSON 含 `fetch_error` 字段：
  ```json
  {"current":"0.3.0","latest":null,"fetch_error":"npm view command failed: ..."}
  ```
- **AND** exit code 0

### Requirement: commands/update.md 指引用户去终端运行 CLI update 子命令

`commands/update.md`（slash 命令源文件，由 `install-claude-code-user-scope-commands` change 拷到 `~/.claude/commands/tapd-server-cli/update.md`）的内文 MUST 指引用户在终端跑 `npx tapd-server-cli update`，而非调用已删除的 `tapd.update` MCP 工具。

frontmatter 含 `description` 字段，简短说明 slash 命令用途（自动补全列表显示）。

#### Scenario: /tapd-server-cli:update slash 命令在 Claude Code 内被触发

- **WHEN** 用户在 Claude Code 会话里输入 `/tapd-server-cli:update`
- **THEN** Claude Code 把 `commands/update.md` 正文作为 prompt 注入对话
- **AND** Claude 看到指引"用户想检查 tapd-server-cli 版本"
- **AND** Claude 用 Bash 工具运行 `npx tapd-server-cli update` 或建议用户在终端跑该命令
- **AND** Claude 把输出格式化展示给用户

#### Scenario: commands/update.md 不再引用 tapd.update MCP 工具

- **WHEN** 任何代码扫描或文档审计读 `commands/update.md`
- **THEN** 文件内容**不**含字符串 `tapd.update`（不能引用已删工具）
- **AND** 文件内容含字符串 `npx tapd-server-cli update`
