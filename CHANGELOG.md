# Changelog

本仓库所有重要变更都记录在此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

每个版本段下分组顺序固定:`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`。
未出现的分组省略。

发版前 `scripts/publish.mjs` 与 CI 都会校验:**`CHANGELOG.md` 顶部必须含与即将发布版本号匹配的版本段**。
缺失则拒绝发版。

## [Unreleased]

<!-- 下一版本的变更草稿,合并到 main 时累积。发版时由 publish 流程移到 [<version>]。 -->

### Changed

- **`release.yml` 的 `npm ci` 加 3 次 retry**（`nick-fields/retry@v3`，间隔 15s）：与 `ci.yml` 对齐。v0.3.2 release CI 第 1 次跑就命中 `mirrors.tencent.com` 拉 `signal-exit-4.1.0.tgz` ETIMEDOUT，靠 `gh run rerun --failed` 救回来。v0.3.1 给 `ci.yml` 加过同款 retry 但漏了 `release.yml`——本次补齐，让发版路径同样抗 transient flake，不再依赖人工 rerun。


## [0.3.2] - 2026-05-30

撤回 v0.3.0 引入的 user-scope slash commands 拷贝逻辑，把 README 重排为业界主流 MCP server 标准顺序。核心动机：让本仓库的安装路径与 GitHub MCP / Notion MCP / Playwright MCP / Filesystem MCP / Supabase MCP 等标杆对齐——`claude mcp add-json` / 粘 JSON / 粘 TOML 为主流，私有便利脚本降级为可选。

### Removed

- **撤回 install claude-code 时的 user-scope commands 拷贝逻辑**：v0.3.0 引入的"`install claude-code` 顺手把 `commands/*.md` 拷到 `~/.claude/commands/tapd-server-cli/`"被撤回。撤回原因：
  1. **业界 MCP 标杆都不这样**：调研 GitHub MCP / Notion MCP / Playwright MCP / Filesystem MCP / Supabase MCP 等主流 server，它们的安装方式统一是"`claude mcp add` / 粘 JSON / 一键 deeplink"，没人把 user-scope slash 命令塞进 install。本仓 v0.3.0 的拷贝逻辑显得"非标"，让安装流程从"业界标准 1 步"膨胀到"3 步带额外副作用"
  2. **三条 slash 命令都是 thin wrapper**：`/tapd-server-cli:login` / `:logout` / `:update` 内文都是"AI 引导提示"——本质是同一条终端命令的入口提示。让用户多记 4 条命令（3 slash + 1 MCP prompt），收益只是"客户端里聊一句也能登录"，不划算
  3. **简化 install/uninstall**：install 输出从 3 段（CLI 注册 + commands 拷贝 + 汇总）缩成 1 段；uninstall 不再需要反向清理 `~/.claude/commands/tapd-server-cli/`
- 删除 `src/installer/user-scope-commands.ts`、`test/unit/user-scope-commands.test.ts`、`commands/login.md` / `commands/logout.md` / `commands/update.md` 三个 slash 命令源文件
- `package.json.files` 移除 `commands` 条目，`.npmignore` 加回 `commands/` 防回归
- `release.yml` 的 `Verify npm package excludes plugin files` step 把 `commands/` 加回 PATTERN 黑名单，删除 `COMMANDS_NON_MD` 的细粒度白名单（因为整目录已禁）
- `RunInstallOptions` 移除 `homedirOverride` / `commandsSrcOverride` 测试钩子；`PerClientResult` 移除 `userScopeCommands` 字段
- `RunUninstallOptions` 移除 `homedirOverride` 测试钩子
- `installer-flow.test.ts` / `uninstall-flow.test.ts` 中 user-scope commands 集成测试段共 6 个 test 移除（10 unit + 6 integration = 16 test 总计；总数 344 → 328）

### Changed

- **README 重排为业界标准顺序**：参考 GitHub / Notion / Playwright / Supabase / modelcontextprotocol/servers 等标杆 README 的展开方式，把"获取 PAT → 安装到客户端（一行命令 / 粘 JSON / 粘 TOML）→ 验证"三步当主流程，私有 `npx tapd-server-cli install` 多客户端便利脚本降级到 §6"批量装多家"。安装入口对齐 Anthropic 官方推荐的 `claude mcp add-json --scope user '<json>'`，让用户搜"如何装 MCP server"时眼睛能直接落到熟悉的 JSON 片段上
- **README 删除 user-scope slash 命令章节**：`/tapd-server-cli:login` / `:logout` / `:update` 三条 slash 命令在 v0.3.2 一并撤回，不再随 install 拷贝。终端 `npx tapd-server-cli login` / `logout` / `update` 是唯一推荐路径

### Notes

- **向后兼容性**：v0.3.0/0.3.1 用户从 `~/.claude/commands/tapd-server-cli/` 残留的三条 slash 命令仍可手工触发，但已不再被新版 install 拷过去。如想清理跑 `rm -rf ~/.claude/commands/tapd-server-cli/`（或在升到本版本后跑 `npx tapd-server-cli uninstall claude-code` 也会**不再**触碰该目录——所以是否清理由用户自己决定）
- **服务器代码 / TAPD API 调用 / 资源工具行为零变化**：本变更只动 installer 与文档


## [0.3.1] - 2026-05-30

Patch 发版。聚焦 Node.js 环境兼容性与 CI 韧性，不动业务逻辑。回应 v0.3.0 用户在 Node v24.14.1 上看到 `mute-stream@4 EBADENGINE` warning 的反馈——补上"装之前先验环境"的清晰路径，避免用户跑到 inquirer 崩溃才知道环境不对。

### Added

- **Node.js 版本运行时自检**（`src/runtime/node-version-check.ts`）：`main()` 入口第一道闸门，所有子命令（install / uninstall / login / logout / update / server）执行前检查 `process.version`。低于阈值时写中文提示到 stderr 并 `exit(2)`，不再让用户跑到 inquirer / undici / commander 崩溃才知道环境不对。提示含修复建议（`nvm install 22 && nvm use 22`）。共 11 个新单元测试覆盖：parseNodeVersion 5 个 + assertNodeVersion 6 个（pass / reject / 边界 patch / NaN 兜底）。

### Changed

- **`engines.node` 从 `>=20` 提升到 `>=22.13.0`**：与实际依赖现实对齐——`commander@12` / `undici@7` 都要求 22+，`@inquirer/checkbox@5` 实测下限 20.17 但被前两者收紧到 22.13。Node 20 用户在 `npx -y tapd-server-cli` 时会看到 `EBADENGINE` warning（不阻断），随后被运行时自检拒绝，提示明确升级路径。表里如一，避免文档承诺与依赖现实漂移。
- **CI 矩阵 Node 20→22, 新加 Node 24**（`.github/workflows/ci.yml`）：与 `engines.node` 对齐砍掉 Node 20 矩阵（运行时自检会 exit 2 拒绝它），新增 Node 24 验证用户社区主流环境（v0.3.0 那位 EBADENGINE 反馈用户跑的就是 v24.14.1）。
- **`npm ci` 加 3 次 retry**（`nick-fields/retry@v3`，间隔 15s）：windows-latest × Node 24 在 ed3c574 的 CI run 命中 `mirrors.tencent.com` 拉包 `ETIMEDOUT`，是 GitHub Actions runner 网络偶发抖动 / 镜像源路由不稳。包住 `npm ci` 抗 transient flake；不动 typecheck/test/build 三步——它们的失败一定是代码问题，重试反而掩盖真问题。
- **claude-cli JSDoc 与测试断言风格 backport**（PR-2 review 对称债 #33）：把 codex-cli 实施时新增的两条 JSDoc（`addJson` timeout 行为、顶层 try/catch 永不抛契约）backport 到 `src/installer/claude-cli.ts`；`test/unit/claude-cli.test.ts` 第 2 用例 payload 断言从 `toMatchObject` 升级 `toEqual` 与 codex-cli 对齐——更严格能捕获意外多出来的字段。

### Docs

- **README v0.3.0 主线对齐**：删除全部 plugin / marketplace 残留文案；安装节改为单条 `npx tapd-server-cli install claude-code`，附说明会同时拷 user-scope slash 命令；升级节改用 `npx tapd-server-cli update`；卸载节描述会同时移除 `~/.claude/commands/tapd-server-cli/` namespace 目录；故障排查表更新；新增"通用形态"节统一 install 多客户端文案；新增 §CLI 子命令一览表（install/uninstall/login/logout/update）。
- **README 故障排查表新增 2 行**：① Node 版本不满足时 `npx tapd-server-cli` 直接 exit 2 + 中文提示的预期行为说明；② `mute-stream@4 EBADENGINE` warning 可忽略的解释（实测 22.13 即可，彻底消除需 22.22.2+ 或 24.15+）。
- **新增 `docs/v0.3.0-verification.html`**（v0.3.1 同步更新覆盖到 v0.3.x 系列）：一份 HTML 验证手册，左侧 sticky 导航 + 锚点跳转，分两节——「用户验证」6 步骤（install→/mcp→whoami→login→download→update/uninstall）+「Maintainer 验证」5 节（npm publish + provenance / GitHub Release / 跨平台 smoke / OpenSpec 状态 / 回滚预案）。自适应深/浅色，`< 900px` 单列响应。

### Notes

- **下游影响**：仍在 Node 20 的用户需升级到 LTS 22（22.13.0+ 即可，推荐 22.x 最新 LTS）。Node 18 用户必须升级——v0.2.x 已不再获得新功能。Windows 用户用 `nvm-windows`，macOS/Linux 用 `nvm`。
- **mute-stream@4 EBADENGINE warning**：`@inquirer/core@11.2.0` 的传递依赖 `mute-stream@4` 要求 Node `^22.22.2 || ^24.15.0 || >=26.0.0`，比我们的 `engines.node` 还严。Node `[22.13, 22.22)` 与 `[24.0, 24.15)` 区间用户仍会看到该 warning，但**实测不影响功能**（PAT 输入隐藏、配置写入、server 启动均正常）。如想彻底消除：用 LTS 22.22.2+ 或 24.15+。
- **服务器代码 / TAPD API 调用 / 资源工具行为零变化**：本版本只动入口闸门 + 文档 + CI，server runtime 调 TAPD Open API 的逻辑完全不动。
- **测试**：333 → 344（+11，全为新 node-version-check 用例）。所有跨平台矩阵 PASS（ubuntu/windows/macos × Node 22/24）。


## [0.3.0] - 2026-05-29

撤回 Claude Code plugin 体系的 minor 版本（破坏性，但 0.x 允许）。改走 npm + user-scope commands + CLI 子命令的双路径方案，安装与维护更可靠。

### Removed

- **Claude Code plugin 体系完全撤回**：删除 `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` / `.mcp.json`，npm 包 `files` 不再包含 plugin manifest。撤回原因：
  1. **`/plugin marketplace add` 不可达**：marketplace add 走 SSH 22 端口克隆 GitHub 仓库；部分受限网络（GFW）下 SSH 22 被阻断，HTTPS 克隆又不在 marketplace add 当前实现支持范围内，导致一大批用户根本进不到第 1 步
  2. **issue #10 GUI smoke 始终未完成**：plugin 路径需要在 Claude Code GUI 内做端到端验收，本仓 maintainer 多次尝试均被网络环境阻塞
  3. **维护成本不成比例**：4 处版本号同步、plugin/npx 双路由、`scripts/sync-plugin-version.mjs` + 钩子守卫……为一条不能被多数用户走到的路径维持双路径不划算
- **MCP 工具 `tapd.update`**：原依赖 plugin 路径的 `dist/runtime/version.js` 编译期常量。撤回 plugin 后该常量来源不稳定（pure-npx 用户没有保障的 server runtime 版本元数据），改用终端 CLI `npx tapd-server-cli update`（同步 `package.json.version` + `npm view`），路径更直接、不依赖 server 上下文
- 删除 `src/tools/update.ts` / `src/runtime/version.ts` / `commands/update.md` 旧版（同名新版改指 CLI）/ `scripts/sync-plugin-version.mjs` / `package.json.scripts.version` 钩子 / `.github/workflows/release.yml` 的 plugin 版本同步守卫步骤
- 测试随之删除：`test/unit/plugin-manifest.test.ts` / `test/unit/update-logic.test.ts` / `test/unit/update-tool.test.ts`
- `meta_tools` 数组移除 `'tapd.update'` 条目（`src/tools/meta.ts`）

### Added

- **CLI 子命令 `login` / `logout` / `update`** —— 替代被撤回的 plugin 内 slash 命令对应的 MCP 工具调用：
  - `npx tapd-server-cli login [--timeout <seconds>]` —— 弹独立 Chrome / Edge 抓 TAPD cookie，写 `~/.config/tapd-mcp/cookie`（POSIX 600）；底层复用 `src/auth/browser-login.ts` 与 `src/auth/cookie-store.ts`
  - `npx tapd-server-cli logout` —— 删除 cookie 文件；不存在不算错
  - `npx tapd-server-cli update [--json]` —— 读本地 `package.json.version`，spawn `npm view tapd-server-cli version` 拿 latest；网络失败仍 exit 0（输出 `Network error` / JSON `fetch_error`），不阻断脚本；自带简易 SemVer 比较，无新依赖
- **`install claude-code` 同时拷贝 user-scope slash 命令模板** —— 安装时把仓库 `commands/*.md` 拷到 `~/.claude/commands/tapd-server-cli/`，对应 `/tapd-server-cli:login` / `/tapd-server-cli:logout` / `/tapd-server-cli:update` 三条 slash 命令在 Claude Code 内即用，无需 plugin 体系
- 新增模块：`src/installer/package-root.ts`（包根定位）、`src/installer/user-scope-commands.ts`（installCommands / removeCommands）、`src/commands/{login,logout,update}-handler.ts`（CLI 子命令实现）
- 新增 27 个测试用例：`user-scope-commands.test.ts` (10) + `installer-flow.test.ts` 集成 (3) + `uninstall-flow.test.ts` 集成 (3) + `cli-commands.test.ts` (18) + `cli-{login,logout,update}.test.ts` (9)；全量 330 PASS

### Changed

- **`uninstall claude-code` 行为扩展**：除清 `mcpServers.tapd` 外，会**额外移除**整个 `~/.claude/commands/tapd-server-cli/` namespace 目录（与 install 对称）；不动同级其它 namespace
- `commands/{login,logout}.md` 内文重写为引导用户跑终端 CLI 命令；旧版直接调 MCP 工具的指令在 v0.3.0 不再准确
- **npm 包 `files` 增加 `commands/`**（v0.3.0 起 user-scope commands 拷贝模板源），`.npmignore` 与 `.github/workflows/release.yml` 的 npm pack 守卫 grep 模式同步调整（`commands/` 不再排除）
- README 重写：删除全部 plugin / marketplace 文案；安装节改为单条 `npx tapd-server-cli install claude-code`，附说明会同时拷 slash 命令模板；升级节、卸载节、Slash 命令节、故障排查表均按新方向更新

### Notes

- **此次方案取舍**：完全删 plugin 路径、用 user-scope commands + CLI 子命令承接，是综合"实际可用性 > 名义功能完整性"的取舍。CLI 子命令对所有客户端通用（不限 Claude Code）、不依赖 server 在线、不绑定 GUI 弹窗——比 plugin 内 MCP 工具更鲁棒
- **向后兼容性**：MCP 工具 `tapd.login` / `tapd.logout` 在 server 内仍保留——已经在 server 上下文内的客户端继续工作，但首次安装路径不再依赖它们。`tapd.update` 工具被移除（替代 = 终端 CLI）
- **服务器代码 / TAPD API 调用 / 资源工具行为零变化**：本版本只重构分发与运行时入口，server runtime 调 TAPD Open API 的逻辑完全不动

### Spec (OpenSpec)

3 个独立 change 同 PR 推进：
- `remove-claude-code-plugin` —— 删除 capability `claude-code-plugin`，撤回所有 plugin 相关 spec
- `install-claude-code-user-scope-commands` —— 新增 capability `installer-user-scope-commands`，规约 install/uninstall 时 `commands/*.md` 拷贝/移除契约
- `add-cli-subcommands-login-logout-update` —— 修改 capability `installer-cli`，新增 3 个 Requirement 描述 login/logout/update 子命令的输入/输出/退出码契约

## [0.2.2] - 2026-05-28

Hotfix 版本。修复 v0.2.1 发版时引入的版本元数据漂移 bug——已发布 `tapd-server-cli@0.2.1` 的 npm tarball 内 `dist/runtime/version.js` 实际编译出 `VERSION = '0.2.0'`，落后包元数据一个 patch。

### Fixed

- **npm version 钩子漏 git add 同步过的文件，导致 dist 内 VERSION 落后**：`scripts/sync-plugin-version.mjs` 在 `npm version <bump>` 触发时同步 4 个文件——`.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` / `.mcp.json` / `src/runtime/version.ts`——但 `package.json.scripts.version` 钩子的 `git add` 列表只列了前 2 个 manifest，漏掉 `version.ts` + `.mcp.json`。后果：sync 脚本写好的 `version.ts` 不进 `npm version` 自动 commit，HEAD 永远停在前一个版本号。CI 从 tag commit 拉代码 build，`dist/runtime/version.js` 跟着滞后。`tapd.update` MCP 工具靠这个值算 `current` 字段，于是对 plugin 用户报 `current=0.2.0 / latest=0.2.1`，让他们以为没装上新版。本版本把钩子的 `git add` 列表扩到 4 个文件全覆盖，并在 `test/unit/plugin-manifest.test.ts` 加元测试 `version sync targets cover all writeFileSync paths`——解析 sync 脚本的 `writeFileSync` 调用集合与钩子的 `git add` 列表对比，不一致即 FAIL，防回归。

### Notes

- **0.2.1 plugin 用户的迁移建议**：现存装了 0.2.1 的 plugin 用户在 `tapd.update` 看到 `current=0.2.0` 不是 client 误报、是 dist 里真写错了。**升到 0.2.2 即修**——`/plugin marketplace update tapd-server-cli` 会按 `.mcp.json` 锁定的 `~0.2.0` minor 范围自动拉到 0.2.2。
- **服务器代码 / API / 工具行为零变化**：本版本只修元数据钩子，不动任何运行时逻辑。
- 影响范围：仅 plugin 安装路径下 `tapd.update` 工具的 `current` 字段。`npx install` 路径不依赖此常量。

### Spec (OpenSpec)

- 修改 capability `claude-code-plugin`：新增 3 个 Requirement 显式约束 hook 与 sync 脚本的同步契约——
  - "npm version 钩子 git add sync 脚本写过的全部文件"（含 4 个具体文件 + 测试守卫 scenario）
  - "src/runtime/version.ts.VERSION 与 package.json.version 字面相等"（含读源码字面字符串的测试方式）
  - ".mcp.json args[1] 与 package.json.version 共享 minor 范围"（PR #12 隐式契约的显式化）
- 变更已归档到 `openspec/changes/archive/2026-05-28-fix-version-sync-git-add-missing-paths/`。

## [0.2.1] - 2026-05-28

本版本累积 PR #1 / #11 / #12 / #13 四次合入,把仓库升级为 Claude Code plugin、加入官方 CLI 优先安装路径、新增 `tapd.update` 升级工具、并交付 plugin 端到端 smoke 工具链。零 breaking change;0.2.0 用户无需重装。

### Added

#### Claude Code plugin 一等公民支持 (PR #1)

- **`.claude-plugin/plugin.json`**:plugin manifest。`name=tapd-server-cli`、`userConfig.tapd_token` (`sensitive: true`,让 Claude Code 把 PAT 走系统 keychain 不落配置文件)、`mcpServers: "./.mcp.json"` 引用 bundled server 配置。
- **`.claude-plugin/marketplace.json`**:单 plugin 入口,`source: "./"`,让用户能 `claude /plugin marketplace add wanggan768q/tapd-server-cli` 把本仓库注册为 marketplace 源。
- **`.mcp.json`**:bundled MCP server 配置,`mcpServers.tapd` 走 `npx -y tapd-server-cli@~0.2.0`(PR #12 锁定到 minor 范围),env.TAPD_TOKEN 用 `${user_config.tapd_token}` 占位符注入。
- **`commands/login.md` + `commands/logout.md`**:thin-wrapper slash 命令 `/tapd-server-cli:login` / `/tapd-server-cli:logout`,提示 Claude 调底层 `tapd.login` / `tapd.logout` MCP 工具。
- **`scripts/sync-plugin-version.mjs`**:`npm version` 钩子调用,自动同步 4 处 version(plugin.json / marketplace.json / .mcp.json / src/runtime/version.ts)避免漂移。
- **`.github/workflows/release.yml` CI 校验**:发版前 verify plugin version sync + verify npm pack excludes plugin files(`.claude-plugin/` `.mcp.json` `commands/` `skills/` `openspec/` `docs/` 任一命中即 fail,失败时 echo 出 grep 命中行便于定位)。
- **`.npmignore`**:与 `package.json.files` 白名单形成双保险,plugin 文件不进 npm publish。

#### `npx install` 优先调官方 CLI (PR #1)

- **`src/installer/claude-cli.ts`**:`ClaudeCliProbe` 接口 + `defaultClaudeCliProbe()` (spawnSync) + `preferClaudeCliInstall()` 高阶函数。检测 `claude --version` 可用 → 调 `claude mcp add-json tapd '<json>' --scope user`;不可用或失败 → 返回 `{ used: 'fallback' }` 让调用方走现行手写 `~/.claude.json` 路径。5 秒超时,`shell: false` 防 PAT 进 shell history。
- **`src/installer/codex-cli.ts`**:对称的 `CodexCliProbe` + `preferCodexCliInstall()`,调用 `codex mcp add tapd --env K=V ... -- npx -y tapd-server-cli`。
- **`src/installer/flow.ts` 集成**:为 `claude-code` / `codex` 客户端前置 CLI 优先逻辑,CLI 成功 → 跳过 `adapter.write`,失败/不可用 → 回退现行手写文件路径(向后兼容老用户)。

#### `tapd.update` MCP 工具 + `/tapd-server-cli:update` slash 命令 (PR #12)

- **`src/tools/update.ts`**:无入参,返回结构化 `UpdateInfo`:`current` / `latest` / `comparison` / `installed_via` / `upgrade_commands` / `fetch_error` / `note`。
  - **current**:编译时内联 `src/runtime/version.ts` 的 `VERSION` 常量,避免运行时读 `package.json` 在 plugin 沙箱里 cwd 不稳。
  - **latest**:`spawnSync('npm', ['view', 'tapd-server-cli', 'version'])`,5s 超时,Windows 走 `.cmd` 探测(复用 PR #1 `resolveBinaryName` 范式 + `TAPD_TEST_PLATFORM` 钩子)。
  - **installed_via**:双信号检测 — `CLAUDE_PLUGIN_ROOT` env 优先于 `argv[1]` 路径包含 `.claude/plugins/` 子串。
  - **upgrade_commands**:按 `installed_via × comparison` 矩阵分流 — plugin 路径给 `/plugin marketplace update`,npx 路径给 `npx -y tapd-server-cli@latest install <client>`。
  - **对外永不抛**:网络受限 / corporate registry / npm CLI 缺失任意场景下 `latest=null`,fetch_error 走 `redactError()` 脱敏,工具仍返成功结构。
- **`commands/update.md`**:slash 命令 `/tapd-server-cli:update`,正文指示 Claude 调 `tapd.update` 并按 `upgrade_commands` 给用户渲染升级指引。
- **`src/runtime/version.ts`**:编译时内联版本号常量,作为 `tapd.update.current` 字段的可信源。

#### Plugin E2E smoke 工具链 (PR #13)

- **`scripts/smoke/run-plugin-e2e.sh`**:5 项可自动化的 plugin 端到端检查 — version 三处一致 / `claude plugin validate` / `npm pack --dry-run` 排除 / `.mcp.json` 锁定形态 / npm registry `~minor.0` 范围解析。`SMOKE_OUT=path` 同时落盘日志,`SKIP_NPX=1` 跳过最慢的 step 5。任一 FAIL 退出码 1。
- **`docs/smoke/2026-05-28-plugin-e2e.md`**:8 条 GUI checklist,人在 Claude Code 里跑完每条贴证据,闭环 issue #10。
- **`docs/smoke/2026-05-28-plugin-e2e.sample-output.txt`**:作者首次跑通的输出样本,供后人对照格式。

#### 测试

新增 6 个测试文件、+12 个 vitest 用例,累积 277 → 接近 280+ 全绿:

- `test/unit/claude-cli.test.ts`:4 用例(不可用 / 成功 / 失败 / spawn 抛错不泄漏 PAT)。
- `test/unit/codex-cli.test.ts`:4 个对称用例。
- `test/unit/installer-flow.test.ts` 增量:`prefers claude CLI` describe 2 集成用例(`vi.doMock` + 动态 import,断言 `adapter.write` 不被调 vs 真写入)。
- `test/unit/plugin-manifest.test.ts`:3 用例 — schema basics / 三处 version 同步 / `.mcp.json` env 占位符不写死真 PAT。
- `test/unit/redact.test.ts`:覆盖 `redact()` / `redactError()` 白名单 + err.stack + URL-encoded 三层(PR #11)。
- `test/unit/update-logic.test.ts` + `update-tool.test.ts`:版本比较 / installed_via 检测 / npm CLI probe 等 update 工具核心逻辑。

### Changed

- **`.mcp.json` 锁定到 `~0.2.0`** (PR #12):`args[1]` 由 `tapd-server-cli` 改为 `tapd-server-cli@~0.2.0`。patch 自动跟(安全修复无感分发)、minor/major 必须显式 `/plugin marketplace update` 触发(by-design,防止 plugin 用户在不知情下吃到 breaking change)。
- **`redact` 抽到独立 util** (PR #11):`src/installer/redact.ts` 集中 `redact()` + `redactError()`,删除 `claude-cli.ts` / `codex-cli.ts` 内的本地实现。三处加固:
  - **白名单脱敏**:只对 `SENSITIVE_KEYS = { TAPD_TOKEN }` 命中的 env 值替换。老实现 `if (v.length >= 4)` 全替会把 `TAPD_LOG_LEVEL='info'` 替成 `***`,干扰 stderr 诊断输出。
  - **覆盖 `err.stack`**:`redactError()` 同时清 `err.message` + `err.stack`,防 Node 把 argv 塞进 stack 时 PAT 从 stack 泄漏。
  - **URL-encoded 兜底**:token 同时按 `encodeURIComponent(token)` 形态再替一次,覆盖 CLI 把 token URL-encode 后输出错误的场景。
- **README 重排**(PR #1 + PR #11):
  - 顶部新增「在 Claude Code 中安装(推荐)」节,plugin 路径置顶,1-2-3 步骤。
  - 现行「快速开始」降级为「在其它客户端中安装(npx install)」。
  - 显式澄清 `~/.claude.json`(MCP 配置) ≠ `~/.claude/settings.json`(settings)——红字 + 故障排查表新增 2 行(`/mcp` 看不到 `tapd` / `npx 装过又装 plugin` 被 user scope 屏蔽)。
  - 卸载节区分 plugin 用户(`/plugin uninstall tapd-server-cli`)与 npx install 用户(`npx ... uninstall --purge`)。
  - Slash 命令节加 `/tapd-server-cli:login` `/tapd-server-cli:logout` `/tapd-server-cli:update`。

### Fixed

- **`flow.ts` CLI 优先分支** Important issue(PR #1 review 期间发现并 amend 修复):`Verify npm package excludes plugin files` CI step 从原位置(在 `npm run build` 之前)移到 `npm run build` 之后、`npm publish` 之前。原位置 `dist/` 还没生成,`files: ["dist", ...]` 白名单匹配 0 文件,校验沦为无意义恒过。同时失败信息增强为输出 grep 命中的具体行,便于 maintainer 定位。
- **`.claude-plugin/plugin.json` 预格式化** (PR #1 follow-up commit `d0bccf1`):`keywords` 数组从手写 inline 形态预先改成 `JSON.stringify(obj, null, 2)` 输出的多行形态,让 `sync-plugin-version.mjs` 跑后文件字节稳定,首次 `npm version patch` 不产生无谓的 6 行格式 diff。

### Spec (OpenSpec)

- 新增 capability `claude-code-plugin`:6 个 Requirement(plugin manifest / marketplace manifest / bundled MCP server / slash 命令 / npm publish 隔离 / 与 npx install 并存)。
- 修改 capability `installer-cli`:新增 2 个 Requirement(CLI 优先 + 文案区分两文件)。
- 新增 capability `update-command`(PR #12):覆盖 `tapd.update` 工具的 current/latest/installed_via/upgrade_commands 字段语义、永不抛契约、redact 脱敏边界,共 115 行 spec。
- 变更未归档(保持在 `openspec/changes/` 待后续 `openspec-archive-change` 处理)。

### Notes

- **PR 合并顺序**:#1 → #11 → #12 → #13(线性,无 rebase 冲突)。
- **本地工具债**(已任务化跟踪,不阻塞发版):claude-cli vs codex-cli JSDoc 风格对称 backport;`flow.ts` 抽 `CLI_PREFER_BY_CLIENT` map 替硬编码;README 6 条文档微调。
- **issue #10 (端到端 smoke 闭环)**:本版本交付工具链(PR #13)+ 自动化部分 5/5 PASS,GUI 8 项 checklist 待人工补证据。

## [0.2.0] - 2026-05-27

### Added

- **`uninstall` CLI 子命令**:与 `install` 完全对称的撤销入口。
  - 零参 TTY 弹 checkbox 多选(Claude Code / Codex / OpenCode / Cursor),`select-clients.resolveClients` 通过新的 `message` / `commandName` 选项参数化复用。
  - 显式列出 `tapd-server-cli uninstall claude-code codex` 走非交互流程,与 install 命令行形态一致。
  - `--dry-run`:只预览,输出目标路径、当前 tapd 条目摘要、移除后 `mcpServers` / `mcp_servers` 剩余 keys 列表;不写文件。
  - `--purge`:在客户端配置卸载完成后,额外清理 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`。**默认关闭**,需显式声明,以便用户重新 `install` 时复用旧登录态。
  - per-client 失败隔离 + 写前自动备份到 `.bak.<timestamp>` + atomic 写入,沿用 `backupAndWrite` 与 install 同款 trade-off(包括 Codex TOML 注释丢失)。
  - 退出码:0 全部成功 / noop / dry-run;1 任一 client 或 `--purge` 文件失败;2 未识别客户端 / 非 TTY 零参;130 用户 Ctrl-C 取消。
- **`ClientAdapter` 接口扩展**:新增 `hasTapdEntry()` 与 `removeEntry()` 两个纯函数方法,4 家 adapter 各自实现。`hasTapdEntry` 采用宽松判定(键存在即视作存在),便于清理用户手改的非标 schema 条目。
- **`src/auth/persistent-files.ts`**:新增 `purgePersistentFiles()` 与 `hasAnyPersistentFile()` 辅助函数。仅清理两个固定文件名 `cookie` 与 `token`,不递归删除目录,不读取文件内容(避免日志泄露)。
- **README 「卸载」章节**:对称呈现于「快速开始」之后,含 4 种用法示例、`--purge` 默认关闭说明、退出码表与 3 条注意事项;「附件下载(cookie 模式)」末尾追加 cross-link 指向 uninstall + `--purge` 作为完整清理路径。

### Changed

- **`select-clients.resolveClients` 选项参数化**:`ResolveClientsOptions` 增加可选 `message` 与 `commandName`;`NonInteractiveNoClientError` 增加 `commandName` 字段。默认值保持 install 文案,install 调用点显式传入"install"以防默认值未来漂移。

### Spec(OpenSpec)

- `installer-cli`:新增 9 条 requirements 覆盖 uninstall 子命令的解析、TTY/非 TTY 行为、不收 PAT、移除条目并保留其它内容、idempotent noop、per-client 隔离汇总、`--purge` 清理边界、`ClientAdapter` 接口扩展。
- `tapd-auth`:新增 2 条 requirements 覆盖 `--purge` 的凭据清理边界(仅清固定文件名、不调 `tapd.logout` MCP 工具)与 `purgePersistentFiles` 辅助函数语义。
- 变更已归档到 `openspec/changes/archive/2026-05-27-add-uninstall-command/`。

### Tests

新增 41 个测试,旧测试零回归(总计 25 文件 / 264 tests 全绿):

- `installer-adapters.test.ts`:`describe.each` 参数化 4 家 adapter × (`hasTapdEntry` 8 cases + `removeEntry` 5 cases)。
- `persistent-files.test.ts`:两文件存在/不存在/单存在、隔离失败、不调 `readFile`、不动其他文件、目录不删。
- `select-clients.test.ts`:默认 vs 自定义 message、`commandName` 字段断言。
- `uninstall-flow.test.ts`:防御 / noop(文件或条目不存在)/ 实写 / dry-run / 多家 per-client 失败隔离 / `--purge` 全成功 / `--purge` 单文件失败导致 exit=1 / 残留提示 / 汇总格式四态。
- `cli-uninstall.test.ts`:commander 解析 11 种参数组合。
- `cli-uninstall-integration.test.ts`:fork 子进程跑 `tsx src/index.ts uninstall ...`,断言端到端链路联通。

## [0.1.0] - 初始版本

### Added

- TAPD MCP Server 初始版本,通过个人访问令牌(PAT)暴露 TAPD Open API。
- 资源工具:stories / bugs / tasks / iterations / releases / timesheets / comments / attachments / workflows / users / categories / modules / custom-fields。
- 元工具:`tapd.whoami` / `tapd.list_workspaces` / `tapd.list_capabilities` / `tapd.refresh_permissions` / `tapd.login` / `tapd.logout`。
- 一键安装到 MCP 客户端:`tapd-server-cli install` 子命令,支持 Claude Code / Codex / OpenCode / Cursor 四家 checkbox 多选。
- Slash 命令向导:`/mcp__tapd__setup` 一键完成 PAT 验证、cookie 登录、附件下载工具装配。
- stdio + streamable HTTP 双传输;HTTP 模式带 `/healthz`。
- 限流与重试:429 ≤3 次、5xx ≤2 次、指数退避;并发上限默认 8。
- 令牌脱敏:日志强制脱敏(前 4 + `***` + 后 4),令牌不落盘。
- 附件下载 cookie 模式:浏览器登录态 cookie 持久化到 `~/.config/tapd-mcp/cookie`(POSIX mode 600),装配 `tapd.attachments.download` 工具。

[Unreleased]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.3.1...v0.3.2
[Unreleased-old]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wanggan768q/tapd-server-cli/releases/tag/v0.1.0
