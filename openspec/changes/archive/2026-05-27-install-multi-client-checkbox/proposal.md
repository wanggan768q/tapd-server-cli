## Why

`tapd-server-cli install` 当前要求用户必须以 `<client>` 位置参数显式指定一个客户端（`claude-code` / `codex` / `opencode` / `cursor`），且一次只能装一家。多数用户同时使用多个 MCP 客户端（典型组合：Claude Code + Codex / Cursor），需要重复执行命令，体验差，也无法在一次交互里复用 PAT 输入。当不带 `<client>` 时 commander 直接报错而不是给出友好提示，初次接触的用户更容易被劝退。

## What Changes

- 把 `install <client>` 升级为 `install [clients...]`：位置参数变为可变长（variadic）、可选。
- 不传任何 client 且 stdin 是 TTY 时，进入交互式 **checkbox 多选**：空格切换、回车确认。
- 不传任何 client 且 stdin 非 TTY 时，按现行逻辑报错退出（保护 CI / 脚本场景）。
- 显式传一个或多个 client 时，跳过交互、按顺序逐家安装。
- 多家安装共用**一次** PAT 输入（无论交互式获得还是 `TAPD_TOKEN` env / `--token` 传入）。
- 任意一家失败时**继续**安装其他家，最后输出汇总报告，整体 exit code 在有失败时为非 0。
- 引入新的生产依赖：`@inquirer/checkbox`（用于 TTY 多选）。
- README / CLI `--help` 文案同步更新。

## Capabilities

### New Capabilities
- `installer-cli`: `tapd-server-cli install` 子命令的命令行解析、交互式客户端选择、PAT 输入复用、多客户端循环安装编排与汇总输出。

### Modified Capabilities
（无——install 子命令此前未在 specs 中沉淀，本次以新 capability 一次性建立）

## Impact

**代码**
- `src/cli.ts`: `<client>` → `[clients...]`，参数校验改为多元素。
- `src/installer/flow.ts`: `RunInstallOptions.client: string` → `clients: string[]`；增加循环、PAT 共享、汇总；新增"无 client + TTY → checkbox" 入口。
- 新增 `src/installer/select-clients.ts`（或同目录下的 `prompt-clients.ts`）封装 checkbox 选择器。
- `src/index.ts`: `parsed.mode === 'install'` 分支适配新签名。
- 测试：新增交互/非交互、多 client、部分失败的单测。

**依赖**
- `package.json` 新增 `dependencies`: `@inquirer/checkbox`（按需 ESM、零隐式依赖）。

**API**
- 命令行参数语义变更：`install <client>`（必填单值） → `install [clients...]`（可选多值）。**向后兼容**：旧的 `install claude-code` 形态行为不变；新形态在旧用法下完全等价。
- 退出码语义微调：从单家成功/失败映射，扩展为"任一失败即非 0"。

**文档**
- `README.md` 安装章节示例更新。
- CLI `--help` 文本由 commander 自动反映新签名。

**不影响**
- MCP server 运行时、TAPD API client、auth、resources 等 capability 完全不动。
