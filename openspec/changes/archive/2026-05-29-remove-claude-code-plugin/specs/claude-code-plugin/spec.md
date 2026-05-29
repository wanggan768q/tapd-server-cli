## REMOVED Requirements

### Requirement: npm version 钩子 git add sync 脚本写过的全部文件

**Reason**: `scripts/sync-plugin-version.mjs` 整脚本删除（plugin manifest / marketplace / .mcp.json / version.ts 4 处 sync 目标全失效），`package.json.scripts.version` 钩子整字段删除。`npm version <bump>` 退回 npm 默认行为：bump package.json + 自动 commit + tag。

**Migration**: maintainer 跑 `npm version patch` 流程不变；自动 commit 现在仅含 `package.json` + `package-lock.json` 改动（不再 stage plugin manifest 等文件——它们都不存在了）。

### Requirement: src/runtime/version.ts.VERSION 与 package.json.version 字面相等

**Reason**: `src/runtime/version.ts` 整文件删除——它是 PR #12 引入给 `tapd.update` MCP 工具用的"current 字段编译时内联常量"。该工具被本 change 删，常量失去消费方。

**Migration**: CLI update 子命令（由 `add-cli-subcommands-login-logout-update` change 实施）通过 `src/runtime/package-version.ts` 的 `readPackageVersion()` 复用现有源读 `package.json.version`，不再需要编译时内联（CLI 路径下没有 plugin 沙箱 cwd 不稳问题）。

### Requirement: .mcp.json args[1] 与 package.json.version 共享 minor ��围

**Reason**: `.mcp.json` 整文件删除（孤儿，plugin.json 不再存在引用它），args[1] 形态不再有载体。

**Migration**: 无。

## Notes

本 change archive 时整个 `claude-code-plugin` capability 标 REMOVED。

> **Spec 历史说明**：本 change 撰写时假设主 spec 还含 9 个 Requirement（plugin manifest / marketplace / bundled server / slash 命令 / npm publish 排除 / 并存优先级 + 3 个 sync 守卫）。但实际上 v0.2.2 hotfix 的 `fix-version-sync-git-add-missing-paths` change archive 时已经把前 6 个 plugin-本体 Requirement 移除并仅保留后 3 个 sync 守卫 Requirement。本 delta 只显式 REMOVE 主 spec 还实际存在的 3 个 sync 守卫 Requirement；前 6 个 plugin-本体 Requirement 的"被删除"在 spec 历史 commit 中已可追溯，不再重复 REMOVE。

archive 后预期效果：`openspec/specs/claude-code-plugin/spec.md` 整文件被 OpenSpec 自动删除（因为它失去全部 Requirement）。tasks.md 加兜底 `git rm` step。
