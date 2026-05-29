## Context

`src/cli.ts` 现在是 commander 路由——`tapd-server-cli` 没子命令时启 MCP server，`install <client>` `uninstall <client>` 是已有子命令。本 change 在同样模式下加 `login` `logout` `update` 三个子命令。

`src/auth/browser-login.ts` 与 `src/auth/cookie-store.ts` 已经实现了 OS 级浏览器登录与 cookie 持久化的"核心层"——`src/tools/login.ts` 是套了 MCP 工具协议（`tools/list_changed` 通知、错误 JSON 序列化等）的"协议层"。CLI 子命令版直接调"核心层"绕开"协议层"，避免重新发明轮子。

`src/tools/update.ts` 在 `remove-claude-code-plugin` change 中被删除——`update` 子命令需要重新实现"读 current / 拿 latest / 比对 / 输出建议"逻辑，但**简单得多**（不需要 plugin 沙箱 cwd 处理、不需要 `installed_via` 双信号检测——CLI 路径下 `installed_via` 永远是 `npm`、不需要 `${user_config.*}` 占位符语义）。

## Goals / Non-Goals

**Goals:**

- 三个 CLI 子命令 `login` / `logout` / `update` 在终端可用、独立于任何 IDE
- 子命令复用 `src/auth/*` 的核心实现——一份逻辑两个入口（MCP 工具 / CLI 子命令）
- `update` 子命令替代删除的 `tapd.update` MCP 工具，提供版本检查 + 升级建议
- `commands/update.md` 重写为指引用户去终端跑 CLI 子命令的 thin wrapper（保持 user-scope slash 命令体验，但底层执行在终端）
- 测试覆盖三个子命令的 commander 解析 + dispatch + handlers（用 mock 避免真 spawn 浏览器/调 npm registry）

**Non-Goals:**

- 不重新引入 plugin 体系或 user_config 占位符
- 不实现 `tapd.update` MCP 工具（已删；本 change 不复活；CLI 子命令是替代方案）
- 不重写 `src/auth/browser-login.ts` 或 `src/auth/cookie-store.ts`——直接复用
- update 子命令不支持 `--auto-update`（自动跑升级）——仅打印建议、用户自己决定（Q4.a 决定）

## Decisions

### Decision 1：commander 子命令风格——与 install/uninstall 对称

`src/cli.ts` 加三个 `program.command(...)`：

```ts
program
  .command('login')
  .description('Login to TAPD via headless browser, capture cookie to ~/.config/tapd-mcp/cookie')
  .option('--timeout <seconds>', 'browser login timeout in seconds', '300')
  .action(loginCommand);

program
  .command('logout')
  .description('Clear TAPD cookie at ~/.config/tapd-mcp/cookie')
  .action(logoutCommand);

program
  .command('update')
  .description('Check for tapd-server-cli updates on npm registry')
  .option('--json', 'output as JSON instead of formatted text')
  .action(updateCommand);
```

每个 handler 在 `src/commands/<name>-handler.ts` 单文件，便于单测注入 mock fs / mock spawn。

### Decision 2：handlers 与 MCP 工具共享核心，不重写

| CLI 子命令 | 核心调用 | MCP 工具版本 |
|---|---|---|
| `login` | `src/auth/browser-login.ts.loginAndCaptureCookie()` | `src/tools/login.ts` |
| `logout` | `src/auth/cookie-store.ts.clearCookie()` | `src/tools/login.ts`（同文件，logout 共用） |
| `update` | 新增 `src/commands/update-handler.ts.checkUpdate()`（读 package.json + spawn npm view） | （已删）|

`login` `logout` 复用现有"核心层"——零代码重复。`update` 重新实现但比 `tapd.update` 简单 60% 以上（无 plugin sandbox 兼容代码）。

### Decision 3：update 输出格式——人类可读 + JSON 双模式

默认人类可读：

```
Current: 0.3.0 (this binary)
Latest:  0.3.0 (npm registry)

✓ Up to date.
```

或：

```
Current: 0.2.2 (this binary)
Latest:  0.3.0 (npm registry)

! Update available.

To upgrade:
  npm install -g tapd-server-cli@latest
or:
  npx tapd-server-cli@latest install claude-code   # 重新装到 Claude Code 含 user-scope commands 同步
```

`--json` 输出结构化（与原 `tapd.update` MCP 工具的 schema 接近）：

```json
{
  "current": "0.2.2",
  "latest": "0.3.0",
  "comparison": "outdated",
  "upgrade_commands": [
    "npm install -g tapd-server-cli@latest",
    "npx tapd-server-cli@latest install claude-code"
  ]
}
```

### Decision 4：update 错误模式——permissive

`npm view tapd-server-cli version` 失败时（网络/registry 不可达/npm 不在 PATH）：

- 文本模式：输出 `Current: 0.3.0` + `Latest: <unable to fetch from npm registry: ...>` + `! Network error; cannot check for updates.` + exit 0
- JSON 模式：`{ "current": "0.3.0", "latest": null, "fetch_error": "..." }` + exit 0

不抛、不非 0 退出——`update` 是信息查询命令，网络错误不算"动作失败"。

### Decision 5：login 子命令的 timeout 默认 300 秒

`src/auth/browser-login.ts.loginAndCaptureCookie()` 已有 timeout 参数（默认 300 秒），CLI 子命令通过 `--timeout` 选项暴露。值与 MCP 工具版本一致。

login 失败（用户取消 / 超时 / 浏览器找不到）：handler 抛错让 commander 默认错误处理打印消息 + exit 1。错误消息走 `redactError()` 脱敏（不让 PAT 出现在 stderr——虽然 login 流程本身不持有 PAT，但保持代码风格一致）。

### Decision 6：commands/update.md 重写策略

原 `commands/update.md`（plugin 时代）内文：

```
请调用 MCP 工具 `tapd.update` 查询当前版本与最新版本，给出升级建议。
```

新内文（v0.3.0 后）：

```markdown
---
description: 检查 tapd-server-cli 是否有新版（终端命令）
---

请告诉用户在终端运行：

\`\`\`
npx tapd-server-cli update
\`\`\`

或如果用户在 Claude Code 会话里直接想看，可以用 Bash 工具运行同款命令并把输出格式化展示。
```

slash 命令从"调 MCP 工具"变成"指引用户跑终端命令"——这是 plugin 撤回 + MCP 工具删除的必然结果。该文件由本 change 重写，由 `install-claude-code-user-scope-commands` change 拷贝到 user-scope。

### Decision 7：测试策略——三层 mock + 一个集成

**单元层**（`test/unit/cli-commands.test.ts` 新增）：

- `loginCommand` 注入 mock `loginAndCaptureCookie`、断言被调用 + 输出友好消息
- `logoutCommand` 注入 mock `clearCookie`、断言被调用 + 输出
- `updateCommand` 注入 mock `spawnSync('npm', ['view', 'tapd-server-cli', 'version'])` 返回不同 latest 字符串、断言三种比对结果（up-to-date / outdated / ahead）输出文本格式正确
- `updateCommand` 注入 spawn 抛错的 mock、断言走 `fetch_error` 路径 + exit 0

**集成层**（`test/unit/cli.test.ts` 已存在则扩展）：

- 新子命令的 `--help` 输出含 description
- 不传子命令仍走 server 模式（与现有行为一致，不破回归）

**不测**：真去 spawn 浏览器、真去查 npm registry——这是 MCP 工具 smoke 测试的范围（已有），不在本 change 单元测试责任内。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| `loginAndCaptureCookie()` 的 MCP 协议层与 CLI 子命令对它的调用语义有差异（如错误返回 vs 抛错） | 在 `src/commands/login-handler.ts` 包一层 try/catch 把抛错转 commander 退出码——与 install/uninstall 现有错误处理风格一致 |
| `update` 重新实现 npm spawn 又踩 `tapd.update` 当时的坑（Win .cmd 探测、shell:false PAT 安全等） | 直接复用 `src/installer/claude-cli.ts` 的 `resolveBinaryName()` + `spawnSync` 模板（PR #1 引入）；不重新发明 |
| `commands/update.md` 重写但 `install-claude-code-user-scope-commands` change 的拷贝逻辑还没把它拷出去 | 三个 change 同 PR——本 change 写 commands/update.md、install-claude-code-user-scope-commands change 在 install 流程里拷它。两个 change merge 顺序不影响最终 commit 状态（同 PR）|
| 用户在装了 0.2.x 的 `npx -g tapd-server-cli` 老 binary 上跑 `update`、它没 update 子命令 | 老 binary 报 commander unknown command `update` + exit 2。CHANGELOG `[0.3.0]` 段提示"先 `npm install -g tapd-server-cli@latest` 再跑 update"。这是 SemVer minor bump 的合理边界 |
| `update` 在 corporate registry 后面（`.npmrc` 改了 registry）查到的 `latest` 是企业镜像版本，与官方 npm 不一致 | by-design——`npm view` 走的就是用户当前 registry 配置；CLI 子命令尊重它。文档简单 note "查 latest 走当前 npm registry 配置" |
