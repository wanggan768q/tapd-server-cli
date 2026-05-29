## Context

PR #1 / #11 / #12 / #14 / #15 累积引入 plugin 体系（v0.2.0 → v0.2.2 三个 patch）。这层基建在工程上"半完成"——marketplace add 在国内网络受限场景下实测不通；issue #10 的 GUI 8 项手工 smoke 至今没人完成；plugin 维护成本溢出（4 处 version 同步、专属测试守卫、CI 校验 step、tapd.update 工具的 plugin/npx 路径分流逻辑）。本 change 决定把这层基建整体撤回，回归 v0.2.0 之前的"npm 包 + npx install"为唯一推荐路径。

但完全撤回会丢失 plugin 时代用户已熟悉的 UX——`/tapd-server-cli:login` slash 命令、`tapd.update` 升级提示。本 change 仅负责**删**；UX 替代由两个独立 change 同 PR 实施：

- `install-claude-code-user-scope-commands`：`commands/login.md` `logout.md` `update.md` 在 `npx install claude-code` 时拷到 `~/.claude/commands/tapd-server-cli/`，让 user-scope slash 命令体验保留
- `add-cli-subcommands-login-logout-update`：CLI 加 `tapd-server-cli login/logout/update` 子命令，让终端用户也有等价路径

三个 change 共用一个 PR、一个 v0.3.0 发版 tag。

## Goals / Non-Goals

**Goals:**

- 完全删除 plugin manifest（`.claude-plugin/`）+ MCP server bundle 配置（`.mcp.json`）+ tapd.update MCP 工具及其测试 + 4 处 version 同步基建（脚本 + npm version 钩子 + CI step + 测试守卫）
- 不破坏 npx install 路径——claude-code/codex/opencode/cursor 四家适配器、CLI 优先（claude-cli/codex-cli probe）、redact 安全脱敏、所有运行时工具（login/logout/whoami/list_workspaces/attachments）一律保留
- 留下 `commands/login.md` `commands/logout.md` 作为下游 change 拷贝模板（不删；它们这次也不再被 plugin manifest 引用，但为下游 change 服务）
- 同 PR 同 v0.3.0 发版

**Non-Goals:**

- 不实现 user-scope commands 拷贝（独立 change 干）
- 不实现 CLI login/logout/update 子命令（独立 change 干）
- 不动 `.gitignore` / `.npmignore`（前者本来无关；后者由 `install-claude-code-user-scope-commands` change 调整 commands/ 排除规则）
- 不 yank v0.2.x npm 版本——已发布的 plugin 用户保留升级选择权（在 `~0.2.0` 范围内继续用、或显式 `npm install tapd-server-cli@0.3.0` 后改走 npx install）
- 不重发 0.2.x patch 来"修"plugin 体验问题——撤回是唯一闭环

## Decisions

### Decision 1：commands/login.md + logout.md 保留，update.md 删

`commands/login.md` `commands/logout.md` 作为下游 `install-claude-code-user-scope-commands` change 拷贝模板的源文件保留——内文写"调 MCP 工具 tapd.login / tapd.logout"对 user-scope 路径仍然合适（前提是 server 已通过 npx install 注册到同会话），不需要改文本（这是 brainstorm 阶段 Q2.a 决定）。

`commands/update.md` 删除——它对应的 `tapd.update` MCP 工具被本 change 删，留 commands/update.md 会让用户调到不存在的工具。CLI update 子命令的语义由 `add-cli-subcommands-login-logout-update` change 重新建立 `commands/update.md`（内容会重写，不复用本文件），届时 `install-claude-code-user-scope-commands` change 会把新写的 update.md 也一并拷到 user-scope。

### Decision 2：sync-plugin-version.mjs 整脚本删，不 archive

脚本的所有功能（plugin.json/marketplace.json/.mcp.json/version.ts 4 处 version 同步）都失效（前 3 个文件被本 change 删；version.ts 也被删）。整文件 git rm，不留 stub、不 archive。

`scripts/` 目录其它脚本（`publish.mjs` / `extract-changelog.mjs` / `grab-cookie.mjs` / `probe-api.sh`）一律保留。

### Decision 3：package.json.scripts.version 钩子整删，不收缩

钩子签名是 `node scripts/sync-plugin-version.mjs && git add ...`——脚本删了 `node scripts/sync-plugin-version.mjs` 命令直接 ENOENT。即便钩子改成只 `git add`（什么文件？没有要 add 的），它存在的唯一目的就是为 sync 脚本服务。整个字段从 `package.json.scripts` 里删除。

`npm version <bump>` lifecycle 在没有 `version` 钩子时退回为默认行为：bump package.json + 自动 commit + tag（不再有别的副作用），与 `npm version` 标准用法一致。

### Decision 4：CI 删 Verify plugin version sync，保留 npm pack excludes

`.github/workflows/release.yml` 含两个 plugin 相关的 verify step：

- `Verify plugin version sync`（PR #14 加，校验 4 处 version 一致）—— **删**
- `Verify npm package excludes plugin files`（PR #14 加，跑 `npm pack --dry-run` 后 grep `.claude-plugin/|.mcp.json|^commands/|^skills/|^openspec/|^docs/`）—— **保留**

后者保留的理由：

1. 即便本 change 删了 `.claude-plugin/` `.mcp.json`，`commands/` 仍在仓库（作为下游 change 拷贝��板）；`openspec/` `docs/` 仍在
2. 下游 `install-claude-code-user-scope-commands` change 会把 `commands/` 改为**进入** npm tarball——届时该 step 的 grep 模式要更新（去掉 `^commands/`），但 step 本身仍有用（继续守 `openspec/` `docs/` 不进 tarball）
3. 这种"step 保留、grep 模式调整"的细粒度变化由下游 change 处理；本 change 不动

### Decision 5：plugin-manifest.test.ts 整文件删

文件里 5 个用例全部测的是 plugin manifest（schema basics / 4 处 version 同步 / .mcp.json env 占位符 / args[1] 范围 / sync-targets 元测试）。本 change 删了所有被测对象，整文件 `git rm`。

`installer-flow.test.ts` 的 `prefers claude CLI` describe 块（PR #1 加的 vi.doMock 集成测试）一律保留——它测的是 npx install 流程的 CLI 优先逻辑，与 plugin 无关。

### Decision 6：CHANGELOG `[0.3.0]` 段共享给三个 change

按 OpenSpec 工作流，每个 change 应在 archive 时贡献自己的 CHANGELOG 行——但这次三个 change 同 PR 同 release tag，且语义紧密绑定（撤 plugin、立 user-scope commands、立 CLI 子命令）。CHANGELOG `[0.3.0]` 段写一段统一叙事，而非三段独立行。

本 change 的 task 9 写完整段；`install-claude-code-user-scope-commands` 和 `add-cli-subcommands-login-logout-update` 的 task 不重写 CHANGELOG，仅 review。

### Decision 7：openspec/specs/claude-code-plugin/spec.md 整文件删

v0.2.2 hotfix archive 时 OpenSpec 自动把 3 个 ADDED Requirements 落到 `openspec/specs/claude-code-plugin/spec.md`（首次创建该 main spec）。本 change archive 时该 capability 整体 REMOVED——OpenSpec 应自动删该 main spec 文件。

如果 archive 后该文件仍存在（OpenSpec CLI 行为），手动 `git rm` 收尾。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 已 install 的 plugin 用户拉不到 0.3.0（`~0.2.0` 范围卡住） | 这是 by-design 安全网；CHANGELOG `[0.3.0]` 段提供迁移指南：先 `/plugin uninstall tapd-server-cli`，再 `npm install -g tapd-server-cli@latest && npx tapd-server-cli install claude-code` |
| 用户已调 `tapd.update` MCP 工具 → v0.3.0 后报 unknown tool | CLI 子命令 `npx tapd-server-cli update` 替代；CHANGELOG 与 README 引导 |
| OpenSpec archive 行为不删 main spec 文件 | 本 change 的 task 加一步显式 `git rm openspec/specs/claude-code-plugin/spec.md` 兜底 |
| 三个 change 同 PR，archive 顺序敏感 | OpenSpec 不依赖 archive 顺序——按 OpenSpec 文档，`openspec archive` 的 spec 落地是幂等的（capability 不存在则创建、存在则增删 ADDED/MODIFIED/REMOVED）。但稳妥起见按 A → B → C 顺序 archive |
| 现存 OpenSpec change `add-claude-code-plugin`（v0.2.1 时建，至今未 archive，含 6 个 Requirement 没进 main spec） | 本 change archive 时它仍未 archive——其引用的 capability `claude-code-plugin` 已被本 change REMOVED，archive 顺序冲突。**解决**：本 change 实施 task 加一步：先 `openspec archive add-claude-code-plugin --yes`（让它的 6 个 Requirement 落到 main spec），再 archive 本 change（让 capability 整体 REMOVED）；如果觉得 add-claude-code-plugin 的 Requirement 已不再适用、不该被 archive 进 main spec，则在归档前手动删除该 change 的 specs 目录（绕开它对 main spec 的写入）|

## Migration（用户视角）

- **未装过 plugin 的用户**：无影响，`npx install` 路径不变
- **装过 plugin 的用户**：需手动迁移
  ```text
  > /plugin uninstall tapd-server-cli
  > /plugin marketplace remove tapd-server-cli
  ```
  再在终端：
  ```bash
  npm uninstall -g tapd-server-cli  # 如果之前装了 global
  npx tapd-server-cli@latest install claude-code  # 重新走 npx install 路径
  ```
- **依赖 `tapd.update` MCP 工具的客户端**：替换为 `npx tapd-server-cli update` CLI 子命令调用
- **已注册 marketplace 但未 install plugin 的用户**：可忽略；marketplace add 在 v0.3.0 之后会失败但不影响其它

## Test Plan

| 测试 | 期望 |
|---|---|
| `npm test` | 31 → ~28 文件 / 315 → ~290 用例（减去 plugin-manifest 5 + update-logic + update-tool 各几个 + 元测试 1）；installer-flow / claude-cli / codex-cli / redact 等 npx install 路径测试全保留全过 |
| `npm run typecheck` | clean——`server.ts` 不再 import `update.ts` `version.ts`；`meta.ts` 不再引用 `tapd.update` |
| `npm run build` | clean——dist 不再含 `dist/tools/update.js` `dist/runtime/version.js` |
| `npm pack --dry-run` | tarball 不含 `.claude-plugin/` `.mcp.json` `commands/update.md`；含 `dist/` `commands/login.md` `commands/logout.md` `commands/update.md`（后三个由下游 change 加） |
| 手动跑 `node -e "require('./dist/runtime/server.js')"` 不抛错 | 确认 server import 链不缺 |
