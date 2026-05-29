## ADDED Requirements

### Requirement: npm version 钩子 git add sync 脚本写过的全部文件

`package.json.scripts.version`（被 `npm version <bump>` lifecycle 调用）MUST 在跑完 `scripts/sync-plugin-version.mjs` 之后，把脚本写过的全部文件都 `git add` 进暂存区，让 `npm version` 自动生成的 commit 含同步后的全部 version 字段。

具体地，钩子的 `git add` 参数列表 MUST 与 sync 脚本实际 `writeFileSync` 的目标完全一致——当前为 4 个：

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.mcp.json`
- `src/runtime/version.ts`

钩子 SHOULD 显式列出这 4 个路径而非用 `git add -u` 或通配符——前者会把开发者 inflight 的所有 tracked 改动一起 stage 进 release commit，破坏自动化的隔离性。

#### Scenario: npm version patch 自动 commit 含全部 4 个文件的同步改动

- **WHEN** 仓库 `package.json.version === '0.2.1'` 且 maintainer 跑 `npm version patch`
- **THEN** `npm version` lifecycle 把 `package.json.version` bump 到 `0.2.2`
- **AND** 触发 `version` 钩子，钩子先调 `node scripts/sync-plugin-version.mjs` 把同步写入 4 个文件
- **AND** 钩子再调 `git add` 把这 4 个文件都暂存
- **AND** `npm version` 自动生成的 commit 含这 5 个文件的改动（package.json + 4 个被 sync 的文件）
- **AND** 推 tag 后 CI 从 tag commit 拉代码 build dist，`dist/runtime/version.js` 字面值是 `0.2.2`

#### Scenario: 钩子 git add 列表与 sync 脚本目标列表漂移时测试守卫拦下

- **WHEN** 未来某 PR 给 `scripts/sync-plugin-version.mjs` 加第 5 个同步目标但忘了改钩子的 `git add` 列表
- **THEN** `test/unit/plugin-manifest.test.ts` 的 4 处 version 一致性用例在本地或 CI 跑出来仍是 PASS（因为脚本写过、文件都同步过）
- **AND** 但**新增的** scenario 用例 "version sync targets cover all writeFileSync paths" 通过解析 `scripts/sync-plugin-version.mjs` 的 `writeFileSync` 调用与 `package.json.scripts.version` 字符串中的 `git add` 列表对比，检测到漂移并 FAIL
- **AND** PR 在合并前看到红测试，被拦下

### Requirement: src/runtime/version.ts.VERSION 与 package.json.version 字面相等

`src/runtime/version.ts` 中的 `VERSION` 常量字面值 MUST 与 `package.json.version` 字段字符串完全相等。该常量在编译时被 inline 进 `dist/runtime/version.js`，是 `tapd.update` 工具 `current` 字段的唯一可信来源。两者漂移会让 `tapd.update` 误报 `current` 字段。

`scripts/sync-plugin-version.mjs` 跑完后该不变量 MUST 自动满足。`test/unit/plugin-manifest.test.ts` MUST 含一条断言显式校验。

#### Scenario: plugin-manifest 测试断言 VERSION 与 package.json.version 一致

- **WHEN** vitest 跑 `test/unit/plugin-manifest.test.ts` 的 `version sync` 用例
- **THEN** 用例读 `package.json.version` 字段
- **AND** 读 `src/runtime/version.ts` 文件、用 `/export const VERSION = '([^']+)'/` 提取常量值
- **AND** 断言两者字面相等
- **AND** 同一用例还断言 `.claude-plugin/plugin.json.version`、`.claude-plugin/marketplace.json.plugins[0].version` 也与之相等（共 4 处一致）

#### Scenario: 漂移会让用例 FAIL

- **WHEN** 开发者手动改 `package.json.version` 但忘跑 `npm version` 流程（直接编辑或脚本误用）
- **THEN** vitest 跑此用例 FAIL，错误消息明确指出哪两个文件不一致
- **AND** PR 不能合并，直到开发者跑 `node scripts/sync-plugin-version.mjs` 把 4 处同步、再 commit

### Requirement: .mcp.json args[1] 与 package.json.version 共享 minor ��围

`.mcp.json.mcpServers.tapd.args[1]` 字面字符串 MUST 形如 `tapd-server-cli@~<major>.<minor>.0`，其中 `<major>.<minor>` 与 `package.json.version` 字段相同（patch 不必相同——按 PR #12 设计，args[1] 锁定到 minor 范围让 patch 自动跟）。

#### Scenario: patch bump 不动 args[1]

- **WHEN** maintainer 跑 `npm version patch`，`package.json.version` 从 `0.2.1` bump 到 `0.2.2`
- **THEN** `scripts/sync-plugin-version.mjs` 看 `.mcp.json.args[1]` 已是 `tapd-server-cli@~0.2.0`，与新 minor 范围 `~0.2.0` 一致
- **AND** 脚本输出 `.mcp.json` 行打 `=`（no-op）而不是 `✓`（写入）
- **AND** 钩子的 `git add .mcp.json` 是 no-op（无改动可 stage）

#### Scenario: minor bump 让 args[1] 跟着升

- **WHEN** maintainer 跑 `npm version minor`，`package.json.version` 从 `0.2.x` bump 到 `0.3.0`
- **THEN** sync 脚本计算新 minor 范围 `~0.3.0`，与现行 args[1] `tapd-server-cli@~0.2.0` 不一致
- **AND** 脚本写 `.mcp.json` 把 args[1] 改成 `tapd-server-cli@~0.3.0`
- **AND** 钩子 `git add .mcp.json` 把改动暂存进 release commit

#### Scenario: plugin-manifest 测试断言 args[1] 字面字符串符合范围

- **WHEN** vitest 跑 `test/unit/plugin-manifest.test.ts` 现有 `.mcp.json` 占位符校验用例
- **THEN** 用例除断言 `command/args/env` 字段值外，还断言 `args[1]` 匹配正则 `^tapd-server-cli@~\d+\.\d+\.0$`
- **AND** 断言 args[1] 中的 `<major>.<minor>` 与 `require('./package.json').version` 取出的 major.minor 字符串相等
