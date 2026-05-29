## 1. 准备 src/commands/ 目录

- [ ] 1.1 `mkdir src/commands`（如不存在）
- [ ] 1.2 `tsconfig.json` / vitest 配置无需改（默认 include `src/**/*.ts`）

## 2. 实现 login handler

- [ ] 2.1 新增 `src/commands/login-handler.ts`：导出 `loginCommand(opts: { timeout?: number })`
- [ ] 2.2 内部调 `src/auth/browser-login.ts` 的 `loginAndCaptureCookie(timeout)`
- [ ] 2.3 成功：stdout `✓ Logged in. Cookie saved to ~/.config/tapd-mcp/cookie`，return（exit 0）
- [ ] 2.4 失败：try/catch 抛错；catch 块 stderr `Error: <msg>`（走 redactError 风格脱敏）+ `process.exit(1)`
- [ ] 2.5 单测覆盖 happy + timeout + browser-not-found 三种路径（注入 mock loginAndCaptureCookie）

## 3. 实现 logout handler

- [ ] 3.1 新增 `src/commands/logout-handler.ts`：导出 `logoutCommand()`
- [ ] 3.2 内部调 `src/auth/cookie-store.ts` 的 `clearCookie()`（如已存在；否则用 `fs.unlink(cookiePath, { force: true })`）
- [ ] 3.3 文件存在被删：stdout `✓ Logged out. Cookie cleared.`
- [ ] 3.4 文件不存在：stdout `= No cookie file found, nothing to clear.`
- [ ] 3.5 失败（权限等）：stderr `Error: <msg>` + exit 1
- [ ] 3.6 单测覆盖 cookie 存在 / 不存在 / 权限错三种路径

## 4. 实现 update handler

- [ ] 4.1 新增 `src/commands/update-handler.ts`：导出 `updateCommand(opts: { json?: boolean })`
- [ ] 4.2 读 `package.json.version` 作为 current（用 `import { createRequire } from 'node:module'` + `createRequire(import.meta.url)('../../package.json').version`）
- [ ] 4.3 spawn `npm view tapd-server-cli version` 拿 latest（复用 `src/installer/claude-cli.ts` 的 `resolveBinaryName('npm')` 与 spawnSync 模板）；timeout 5 秒
- [ ] 4.4 比对 current vs latest：用 `semver.compare(current, latest)` 算 comparison（uptodate / outdated / ahead）；引入 semver 依赖（如未有）或简易自实现
- [ ] 4.5 输出文本模式 / JSON 模式（按 `--json` flag）
- [ ] 4.6 spawn 失败：fetch_error 路径，文本模式输出网络错误消息、JSON 模式输出 `latest: null, fetch_error: <msg>`，**exit 0**
- [ ] 4.7 单测覆盖 up-to-date / outdated / ahead / fetch_error 四种路径 + JSON 输出格式

## 5. 集成到 commander 路由

- [ ] 5.1 修改 `src/cli.ts`：在 install/uninstall 子命令旁加：
  - `program.command('login').option('--timeout <seconds>', '...', '300').action(loginCommand)`
  - `program.command('logout').action(logoutCommand)`
  - `program.command('update').option('--json', '...').action(updateCommand)`
- [ ] 5.2 验证 `node dist/index.js --help` 输出新增三个子命令的 description
- [ ] 5.3 验证 `node dist/index.js login --help` 输出 `--timeout` option

## 6. 重写 commands/update.md

- [ ] 6.1 修改 `commands/update.md`：内文从"调 MCP 工具 tapd.update"改为指引用户在终端跑 `npx tapd-server-cli update`
- [ ] 6.2 frontmatter `description` 改为简短说明（如 `检查 tapd-server-cli 是否有新版（终端命令）`）
- [ ] 6.3 grep 检查文件不再含 `tapd.update`（已删 MCP 工具）

## 7. 测试覆盖

### 7.1 单元层 (test/unit/cli-commands.test.ts，新增)

- [ ] 7.1.1 `loginCommand` 调 mock `loginAndCaptureCookie`、stdout 含 `✓ Logged in`
- [ ] 7.1.2 `loginCommand` mock 抛错、stderr 含 `Error:` + exit 1
- [ ] 7.1.3 `logoutCommand` 调 mock `clearCookie` 返 true、stdout 含 `Cookie cleared`
- [ ] 7.1.4 `logoutCommand` mock 返 false（文件不存在）、stdout 含 `nothing to clear`
- [ ] 7.1.5 `updateCommand` mock spawn 返 latest=current、stdout 含 `Up to date`
- [ ] 7.1.6 `updateCommand` mock spawn 返 latest>current、stdout 含 `Update available` + 升级建议两行
- [ ] 7.1.7 `updateCommand` mock spawn 抛错、stdout 含 `Network error`、**exit 0**
- [ ] 7.1.8 `updateCommand --json`、stdout 是 JSON、含 `current/latest/comparison/upgrade_commands`
- [ ] 7.1.9 `updateCommand --json` 网络错误、JSON 含 `fetch_error` 字段、`latest: null`

### 7.2 commander 解析层 (test/unit/cli.test.ts 如已存在则扩展，否则新增)

- [ ] 7.2.1 `parseCli(['login'])` 返 `{ mode: 'login', timeout: 300 }`
- [ ] 7.2.2 `parseCli(['login', '--timeout', '60'])` 返 `{ mode: 'login', timeout: 60 }`
- [ ] 7.2.3 `parseCli(['logout'])` 返 `{ mode: 'logout' }`
- [ ] 7.2.4 `parseCli(['update'])` 返 `{ mode: 'update', json: false }`
- [ ] 7.2.5 `parseCli(['update', '--json'])` 返 `{ mode: 'update', json: true }`
- [ ] 7.2.6 不传子命令仍走 server 模式（不破回归）

### 7.3 集成 smoke

- [ ] 7.3.1 `node dist/index.js update`（实际 spawn npm，受网络）：本地手动验证 stdout 输出格式正确——任 maintainer 跑一次贴 issue/PR description 作为证据；不进 CI

## 8. README 更新

- [ ] 8.1 加"CLI 子命令"小节（在现有"快速开始"节之后），列三个子命令 + 各自一行说明：
  ```
  ## CLI 子命令

  - `npx tapd-server-cli login` — 弹独立浏览器抓 TAPD cookie
  - `npx tapd-server-cli logout` — 删除本地 cookie
  - `npx tapd-server-cli update` — 检查 npm 上是否有新版
  ```
- [ ] 8.2 在 Slash 命令节里加一行（与 `install-claude-code-user-scope-commands` change 协调）：`/tapd-server-cli:update` 在 Claude Code 内会引导用户去终端跑 `npx tapd-server-cli update`

## 9. 跑全套测试

- [ ] 9.1 `npm run typecheck` clean
- [ ] 9.2 `npm test` 全过——新加 ~9 个 cli-commands 用例 + ~6 个 cli.test 用例 PASS
- [ ] 9.3 `npm run build` dist 含新 `dist/commands/login-handler.js` `logout-handler.js` `update-handler.js`
- [ ] 9.4 手动 smoke：`node dist/index.js update`（实际 spawn npm view）—— 输出格式肉眼检查

## 10. archive 本 change（与 §A §B 同 PR merge 后）

- [ ] 10.1 `openspec archive add-cli-subcommands-login-logout-update --yes`
- [ ] 10.2 验证 `openspec/specs/installer-cli/spec.md` 含本次新增的 2 个 Requirement（CLI 子命令 + commands/update.md 指引）
- [ ] 10.3 commit archive 移动
