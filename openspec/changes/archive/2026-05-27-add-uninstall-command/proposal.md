## Why

`install` 子命令已经覆盖了 Claude Code / Codex / OpenCode / Cursor 四家 MCP 客户端的一键写入,但没有对称的卸载入口——用户想撤回安装只能手动编辑各家的 JSON / TOML 配置,还要自己找到并删除 `~/.config/tapd-mcp/cookie`、`~/.config/tapd-mcp/token` 等持久化文件,容易漏删或误删。补一个 `uninstall` 子命令可消除这块体验断层,也让 CLI 自身的可逆性闭环。

## What Changes

- 新增 `uninstall [clients...]` 子命令,行为与 `install` 完全对称:零参 TTY 弹 checkbox 多选;显式列出客户端走非交互流程;`--dry-run` 只预览不写文件;per-client try/catch 隔离,单家失败不影响其他家;写前自动备份到 `.bak.<timestamp>`。
- 新增 `--purge` 选项:除了从客户端配置中移除 `tapd` 条目外,额外清理 `~/.config/tapd-mcp/cookie` 和 `~/.config/tapd-mcp/token`(POSIX mode 600 文件)。默认不开启,需用户显式声明。
- 扩展 `ClientAdapter` 接口:加 `hasTapdEntry(existing)` 和 `removeEntry(existing)` 两个方法,4 家 adapter 各自实现移除自己 schema 下的 tapd 节(`mcpServers.tapd` 或 `mcp_servers.tapd`),保留同节下其它 server 条目与文件其它顶层字段不变。
- 新增 `uninstall-flow` 模块:read → hasTapdEntry → removeEntry → backupAndWrite,复用现有 `backupAndWrite` 与 `select-clients`,无需重新实现备份/原子写/多选交互。
- README 增加「卸载」章节,与「快速开始(推荐:一键安装)」对称呈现。
- Outcome 命名引入新值 `removed`(对应 install 的 `wrote`);其它三个(`noop` / `dry-run` / `failed`)与 install 复用。
- 退出码沿用 install 约定:任一 failed → 1;未识别客户端 → 2;用户取消(Ctrl-C)→ 130;全 noop / removed / dry-run → 0。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `installer-cli`: 增加 `uninstall` 子命令的需求,包含交互/非交互模式、`--dry-run`、`--purge`、per-client 隔离、备份、退出码、`ClientAdapter` 接口扩展点。
- `tapd-auth`: 增加「卸载时凭据清理边界」的需求 —— 明确 `--purge` 时清除哪些文件(cookie / token)、不清除哪些(MCP 客户端配置中的 `TAPD_TOKEN` env 由 uninstall 主流程负责一并移除),以及非 `--purge` 时这些持久化文件保留不动的语义。

## Impact

- **代码**:
  - `src/installer/adapter.ts` —— `ClientAdapter` 接口扩展。
  - `src/installer/adapters/{claude-code,codex,opencode,cursor}.ts` —— 各家实现 `hasTapdEntry` / `removeEntry`。
  - `src/installer/uninstall-flow.ts` —— 新增编排模块(约 100 行)。
  - `src/installer/select-clients.ts` —— 多选 prompt 文案可参数化(改为接受 message 参数),复用给 uninstall。
  - `src/cli.ts` —— `ParsedCli` 联合类型加 `mode: 'uninstall'`;commander 注册新子命令;`UnknownClientError` 复用。
  - `src/index.ts` —— 顶层 main() 加 `uninstall` 路由分支。
  - `src/auth/cookie-store.ts` / 令牌文件清理 —— 暴露统一的「purge persistent files」辅助函数,供 uninstall 调用。
- **测试**:
  - 4 家 adapter 的 `removeEntry` / `hasTapdEntry` 纯函数单测(保留同节下其它 server、保留顶层其它字段)。
  - `uninstall-flow` 集成测试(per-client 隔离、备份、idempotent noop、dry-run、未识别客户端、混合 outcome 汇总、`--purge` 路径)。
  - `cli.ts` 解析测试(`uninstall`、`uninstall <c1> <c2>`、`--dry-run`、`--purge`、未识别客户端)。
  - `index.ts` 路由分发测试(`mode: 'uninstall'` → resolveClients → runUninstall)。
- **文档**:`README.md` 加「卸载」章节,与「快速开始」呼应;`tapd.logout` 工具说明保持不变(那是 server 端运行时工具,与 CLI uninstall 不重叠)。
- **依赖**:不引入新依赖。复用 `@inquirer/checkbox`、`@iarna/toml`、`commander`、`backupAndWrite`、`readIfExists`。
- **向后兼容**:纯增量。现有 `install` 行为零变化;`ClientAdapter` 接口加方法属于 internal API,无下游消费者;CLI 退出码语义与 install 对齐,不影响已部署脚本。
