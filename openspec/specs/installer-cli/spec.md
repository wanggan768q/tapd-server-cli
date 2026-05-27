# installer-cli Specification

## Purpose
TBD - created by archiving change install-multi-client-checkbox. Update Purpose after archive.
## Requirements
### Requirement: install 子命令接受可变长可选客户端列表

`tapd-server-cli install` SHALL 接受零个、一个或多个位置参数作为目标 MCP 客户端。每个参数 MUST 取自支持集合：`claude-code`、`codex`、`opencode`、`cursor`。

#### Scenario: 显式单客户端（向后兼容）
- **WHEN** 用户执行 `tapd-server-cli install claude-code`
- **THEN** CLI 解析出 `clients = ["claude-code"]`，且不进入交互式选择

#### Scenario: 显式多客户端
- **WHEN** 用户执行 `tapd-server-cli install claude-code codex`
- **THEN** CLI 解析出 `clients = ["claude-code", "codex"]`，按列表顺序逐家执行安装

#### Scenario: 未识别的客户端
- **WHEN** 用户执行 `tapd-server-cli install foo`
- **THEN** CLI 以非零退出码退出，stderr 输出 `未识别的客户端 "foo"`，并列出支持集合

#### Scenario: --dry-run 与 client 列表混合顺序
- **WHEN** 用户执行 `tapd-server-cli install --dry-run claude-code codex`
- **AND** 或 `tapd-server-cli install claude-code codex --dry-run`
- **THEN** 两种顺序均被 CLI 正确解析为 `clients = ["claude-code", "codex"]`、`dryRun = true`

### Requirement: 零参且 TTY 时进入 checkbox 多选

当 `tapd-server-cli install` 不带任何客户端参数、并且 `process.stdin.isTTY` 与 `process.stdout.isTTY` 均为真时，CLI MUST 进入交互式 checkbox 多选界面，允许用户用空格切换选中、回车确认。

#### Scenario: TTY 下零参进入交互
- **WHEN** 用户在 TTY 终端执行 `tapd-server-cli install`
- **THEN** 终端展示一个 checkbox 列表，包含 `Claude Code` / `Codex` / `OpenCode` / `Cursor` 四项
- **AND** 用户按空格切换选中、回车确认后，CLI 把所选项作为 `clients` 列表传入安装流程

#### Scenario: 用户回车但未选任何项
- **WHEN** 用户在 checkbox 列表上未选中任何项即回车
- **THEN** CLI 输出"未选择任何客户端，已退出"并以非零退出码退出

#### Scenario: 用户在 checkbox 中按 Ctrl-C 取消
- **WHEN** 用户在交互式选择期间按下 Ctrl-C
- **THEN** CLI 终止安装流程，未写入任何客户端配置，且退出码为非零

### Requirement: 零参且非 TTY 时报错退出

当 `tapd-server-cli install` 不带任何客户端参数、且 stdin 或 stdout 任一不是 TTY（如被 CI、shell 管道、daemon 调用），CLI MUST 不进入交互式选择，并以非零退出码退出，stderr 给出明确指引。

#### Scenario: 非 TTY 零参直接报错
- **WHEN** `process.stdin.isTTY` 为 false 或 `process.stdout.isTTY` 为 false
- **AND** 用户执行 `tapd-server-cli install`（无 client 参数）
- **THEN** CLI 立即退出，退出码非零
- **AND** stderr 包含"非交互环境下必须显式指定客户端"等指引文案，并给出支持的客户端列表

### Requirement: 多客户端共享一次 PAT 输入

当 `clients` 列表长度 ≥ 1 时，CLI MUST 在进入安装循环之前只解析一次 TAPD PAT（按既有优先级：`opts.tokenOverride` / `TAPD_TOKEN` env / 交互式 `promptToken`），并把同一份 token 复用于所有目标客户端的写入。

#### Scenario: 多���共享一次交互输入
- **WHEN** 用户安装两家及以上客户端，且未通过 env / `--token` 提供 PAT
- **THEN** CLI 仅弹出一次 PAT 输入提示
- **AND** 所有目标客户端写入的 `TAPD_TOKEN` env 均为这同一次输入的值

#### Scenario: 多家共享 env PAT
- **WHEN** `TAPD_TOKEN` 环境变量已设置，且用户安装多家客户端
- **THEN** CLI 不弹任何交互输入，所有目标客户端写入同一 token

### Requirement: 失败跳过并输出汇总

当循环安装多家客户端时，单家失败 MUST NOT 中断其他家的安装。所有家处理完成后，CLI MUST 在 stdout 输出每家的最终状态汇总，并在存在任何失败时以非零退出码结束。

#### Scenario: 部分家失败、其余家成功
- **WHEN** 用户执行 `tapd-server-cli install claude-code codex`
- **AND** 写入 claude-code 成功，写入 codex 时抛出异常（如配置文件不可写）
- **THEN** CLI 仍尝试并完成 claude-code 的写入，并打印错误信息
- **AND** stdout 汇总包含 claude-code 的 wrote/noop 状态与 codex 的 failed 状态及失败原因
- **AND** 进程以非零退出码退出

#### Scenario: 全部成功
- **WHEN** 多家全部写入成功或为 no-op
- **THEN** CLI 以退出码 0 结束，汇总输出每家的 path 与 outcome

#### Scenario: 全部 dry-run
- **WHEN** 用户执行 `tapd-server-cli install claude-code codex --dry-run`
- **THEN** 不写入任何文件，每家分别打印 dry-run 目标路径与即将写入的摘要
- **AND** 汇总报告每家 outcome 为 `dry-run`，进程以退出码 0 结束

### Requirement: 单客户端调用语义保持向后兼容

当用户传入恰好一个客户端时，CLI 的写入行为、备份策略、no-op 判定、`--dry-run` 输出 MUST 与当前实现一致；退出码语义在单家场景下保持（0 成功 / 1 PAT 输入错或运行时错 / 2 未识别客户端）。

#### Scenario: 单家成功安装
- **WHEN** 用户执行 `tapd-server-cli install claude-code`
- **AND** 配置文件写入成功
- **THEN** 退出码为 0，stdout 包含写入路径与下一步指引

#### Scenario: 单家配置已是最新
- **WHEN** 现有配置已与待写入条目完全一致
- **THEN** 不写入文件，stdout 提示"配置已是最新，无需变更"，退出码为 0

#### Scenario: 单家 PAT 输入错误
- **WHEN** 用户在 PAT 交互中输入空值或非法值
- **THEN** stderr 输出错误信息，退出码为 1，未写入任何文件

