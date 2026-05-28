# Tasks

## B0: `.mcp.json` 锁定到 ~0.2.0

- [ ] **Task 1**：把 `.mcp.json` 的 `args` 由 `["-y", "tapd-server-cli"]` 改为 `["-y", "tapd-server-cli@~0.2.0"]`
- [ ] **Task 2**：扩展 `scripts/sync-plugin-version.mjs`：`npm version` 钩子时同步 `.mcp.json` 的 `args[1]` 为 `tapd-server-cli@~<major>.<minor>.0`
- [ ] **Task 3**：扩展 `.github/workflows/release.yml` 的 `Verify plugin version sync` step：把 `.mcp.json` 也纳入 version 一致校验（解析 args，取 `~` 后的值，与 package.json 的 major.minor 比对）
- [ ] **Task 4**：单测 `test/unit/sync-plugin-version.test.ts`（如果不存在则新建）增加用例：`.mcp.json` 在 npm version 后被正确更新到 ~<new-major>.<new-minor>.0

## B1: 新 MCP 工具 `tapd.update`

- [ ] **Task 5**：新建 `src/runtime/version.ts`，导出常量 `VERSION = '0.2.0'`
- [ ] **Task 6**：扩展 `scripts/sync-plugin-version.mjs`：`npm version` 钩子时同步 `src/runtime/version.ts` 的 VERSION 值（用正则 `/export const VERSION = '[^']+'/`）
- [ ] **Task 7**：新建 `src/tools/update.ts`：
  - 导出 `NpmViewProbe` 接口与 `defaultNpmViewProbe()`（spawnSync npm view，5s timeout，Windows 走 `npm.cmd`，对称 claude-cli/codex-cli）
  - 导出纯函数 `detectInstalledVia(env: ProcessEnv, argv: string[]): 'plugin' | 'npx'`
  - 导出纯函数 `compareVersions(current: string, latest: string | null): 'up-to-date' | 'update-available' | 'unknown'`
  - 导出纯函数 `buildUpgradeCommands(installedVia, comparison): UpgradeCommand[]`
  - 导出 `registerUpdateTool(server, deps)`，工具名 `tapd.update`，无入参，返回 `{ current, latest, comparison, installed_via, upgrade_commands, note, fetch_error }`
- [ ] **Task 8**：`src/tools/register.ts` 注册 `tapd.update`，把它加入 `tapd.list_capabilities` 的 `meta_tools` 数组
- [ ] **Task 9**：单测 `test/unit/update-logic.test.ts`：覆盖 `detectInstalledVia` 三种信号源 + `compareVersions` 三种返回 + `buildUpgradeCommands` 两种 installed_via × 三种 comparison
- [ ] **Task 10**：单测 `test/unit/update-tool.test.ts`：用注入式 `NpmViewProbe` 测 timeout / 网络失败 / 正常 latest 三个分支；断言 PAT 在任何分支都不会泄漏到响应（虽然 update 工具本不该接触 PAT，但守住"非 sensitive 工具也不应回显 env"原则）
- [ ] **Task 11**：集成测 `test/unit/update-tool-integration.test.ts`：用 SDK client 调真实注册过的 `tapd.update`，断言 response.content[0].type === 'text' && structuredContent 形态

## B2: slash 命令 `/tapd-server-cli:update`

- [ ] **Task 12**：新建 `commands/update.md`，按 `commands/login.md` 体例：frontmatter `description: 检查 tapd-server-cli 是否有新版本并指引升级`；正文指示 Claude 调 `tapd.update` 并渲染输出
- [ ] **Task 13**：如果 `.claude-plugin/plugin.json` 显式列出 commands，追加 `update` 条目；否则跳过（plugin host 自动扫描 `commands/` 目录）

## B3: 文档同步

- [ ] **Task 14**：README「升级」相关节扩展：
  - 「在 Claude Code 中安装（推荐）」节末尾加一句"想检查/触发升级？在会话里输入 `/tapd-server-cli:update`"
  - 「升级（已通过 npx install claude-code 装过）」节插入相同提示
  - 故障排查表新增一行：`tapd.update 返回 latest: null` → 原因列「`npm view` 网络受限或 corporate registry」+ 处理列「自己跑 `npm view tapd-server-cli version` 看 npm 的具体报错」
- [ ] **Task 15**：CHANGELOG.md 新增 `[0.3.0] — Unreleased` 段（如果 CHANGELOG 工作流要求这么做），列出本 change

## 验证 & 提交

- [ ] **Task 16**：`npm run typecheck` 干净
- [ ] **Task 17**：`npm test` 全过（预计 +14 测试：B0 = 1，B1 = 12，B2 = 1）
- [ ] **Task 18**：本地手动 smoke：
  - `npm run build && node dist/index.js`（启动 server）
  - 用 SDK client 或者 MCP Inspector 调 `tapd.update`，断言返回 `current === '0.2.0'`、`latest` 是 npm 上的当前版本
  - 把 `process.env.npm_config_registry` 改成不存在的 URL，再调一次，断言 `latest: null, fetch_error: <reason>`
- [ ] **Task 19**：按 PR #1 follow-up commit 风格组织 2 个 commit：
  - `feat(tools): add tapd.update + lock .mcp.json version to ~minor`
  - `test(tools): cover update tool probe / version compare / install path detection`
- [ ] **Task 20**：推到 `feat/tapd-update-command` 分支，建 PR，body 引用 issue #2 + 本 change，CI 6 矩阵 job 全绿后 squash merge，自动 closes #2
