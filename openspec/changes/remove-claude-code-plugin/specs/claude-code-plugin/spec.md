## REMOVED Requirements

### Requirement: 仓库提供 Claude Code plugin manifest

**Reason**: plugin 体系整体撤回——marketplace add 在网络受限环境实测不通、issue #10 GUI smoke 始终未完成、维护成本（4 处 version 同步 + 专属测试守卫 + CI 校验 + tapd.update 工具的路径分流）远超价值。

**Migration**:
- 未装过 plugin 的用户：无影响，继续 `npx tapd-server-cli install claude-code`
- 装过 plugin 的用户：先 `/plugin uninstall tapd-server-cli` + `/plugin marketplace remove tapd-server-cli`，再 `npx tapd-server-cli@latest install claude-code` 改走 npx 路径
- `commands/login.md` `commands/logout.md` 的 slash 命令体验由 `install-claude-code-user-scope-commands` change 通过 user-scope 拷贝机制重新提供（不依赖 plugin）

### Requirement: 仓库提供 marketplace manifest 让自身被发现

**Reason**: 同上——marketplace add 路径整体撤回。`.claude-plugin/marketplace.json` 一并删除。

**Migration**: 已注册过 `wanggan768q/tapd-server-cli` 为 marketplace 源的用户，在 v0.3.0 之后 marketplace 拉取会失败但不影响其它 plugin。运行 `/plugin marketplace remove tapd-server-cli` 清掉记录。

### Requirement: bundled MCP server 通过 npx 拉起，PAT 走 user_config 占位符注入

**Reason**: 该 Requirement 描述 `.mcp.json` 的 `mcpServers.tapd` 配置；plugin manifest 删了之后 `.mcp.json` 成孤儿（plugin.json `mcpServers: "./.mcp.json"` 是它唯一上游 reference），整文件删除。

**Migration**: PAT 的注入路径回归为 `npx install claude-code` 写 `~/.claude.json` 顶层 `mcpServers.tapd.env.TAPD_TOKEN` —— 这是 plugin 出现之前就有的现行路径，未变。

### Requirement: plugin 提供 slash 命令包装

**Reason**: plugin 体系撤回；slash 命令的承接路径由 `install-claude-code-user-scope-commands` change 通过 user-scope `~/.claude/commands/tapd-server-cli/` 拷贝实现，不再依赖 plugin。

**Migration**: 见 `install-claude-code-user-scope-commands` change 的 spec。`/tapd-server-cli:login` `/tapd-server-cli:logout` slash 命令的语义保留；`/tapd-server-cli:update` 由独立 change 重新实现并拷贝。

### Requirement: plugin 文件不进入 npm publish

**Reason**: plugin 文件本身（`.claude-plugin/` `.mcp.json`）已删；该 Requirement 的"双保险"语义部分不再适用。但 CI step `Verify npm package excludes plugin files` 保留——它仍能守 `openspec/` `docs/` 不进 tarball、且下游 change 把 `commands/` 改为**进入** tarball 时该 step 的 grep 模式会更新。

**Migration**: 无（基础设施层调整，对用户透明）。

### Requirement: 与现行 npx install 路径并存且明确优先级

**Reason**: 不再"并存"——npx install 成为唯一路径。

**Migration**: README 重排把"在 Claude Code 中安装（推荐）"节删除；npx install 节抬到唯一推荐路径；故障排查表的 plugin/user-scope 优先级冲突一行（PR #14 加）一并删除（不再有 plugin scope 与 user scope 的冲突场景）。

### Requirement: npm version 钩子 git add sync 脚本写过的全部文件

**Reason**: `scripts/sync-plugin-version.mjs` 整脚本删除（plugin manifest / marketplace / .mcp.json / version.ts 4 处 sync 目标全失效），`package.json.scripts.version` 钩子整字段删除。`npm version <bump>` 退回 npm 默认行为：bump package.json + 自动 commit + tag。

**Migration**: maintainer 跑 `npm version patch` 流程不变；自动 commit 现在仅含 `package.json` + `package-lock.json` 改动（不再 stage plugin manifest 等文件——它们都不存在了）。

### Requirement: src/runtime/version.ts.VERSION 与 package.json.version 字面相等

**Reason**: `src/runtime/version.ts` 整文件删除——它是 PR #12 引入给 `tapd.update` MCP 工具用的"current 字段编译时内联常量"。该工具被本 change 删，常量失去消费方。

**Migration**: CLI update 子命令（由 `add-cli-subcommands-login-logout-update` change 实施）会重新建立"读 package.json.version"的简单方案——不再需要编译时内联（CLI 路径下 `import { version } from '../../package.json' assert { type: 'json' }` 即可，没有 plugin 沙箱 cwd 不稳问题）。

### Requirement: .mcp.json args[1] 与 package.json.version 共享 minor 范围

**Reason**: `.mcp.json` 整文件删除（孤儿，plugin.json 不再存在引用它），args[1] 形态不再有载体。

**Migration**: 无。

## Notes

本 change archive 时整个 `claude-code-plugin` capability 标 REMOVED。OpenSpec CLI 行为：

- 若该 capability 在其它 change 中仍被引用（例如 `add-claude-code-plugin` 还没 archive），archive 顺序敏感——本 change 的 tasks.md 处理该 risk
- archive 后预期效果：`openspec/specs/claude-code-plugin/spec.md` 整文件被 OpenSpec 自动删除（如果它是该 capability 唯一来源）。tasks.md 加兜底 `git rm` step
