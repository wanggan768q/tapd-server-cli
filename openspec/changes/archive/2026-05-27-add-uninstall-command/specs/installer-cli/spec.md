## ADDED Requirements

### Requirement: uninstall 子命令接受可变长可选客户端列表

`tapd-server-cli uninstall` SHALL 接受零个、一个或多个位置参数作为目标 MCP 客户端。每个参数 MUST 取自支持集合:`claude-code`、`codex`、`opencode`、`cursor`。命令行参数形态与 `install` 子命令完全对称。

#### Scenario: 显式单客户端

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** CLI 解析出 `clients = ["claude-code"]`,且不进入交互式选择

#### Scenario: 显式多客户端

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code codex opencode cursor`
- **THEN** CLI 解析出 `clients = ["claude-code", "codex", "opencode", "cursor"]`,按列表顺序逐家执行卸载

#### Scenario: 未识别的客户端

- **WHEN** 用户执行 `tapd-server-cli uninstall foo`
- **THEN** CLI 以退出码 2 退出
- **AND** stderr 输出 `未识别的客户端 "foo"`,并列出支持集合

#### Scenario: --dry-run 与 client 列表混合顺序

- **WHEN** 用户执行 `tapd-server-cli uninstall --dry-run claude-code codex`
- **AND** 或 `tapd-server-cli uninstall claude-code codex --dry-run`
- **THEN** 两种顺序均被 CLI 正确解析为 `clients = ["claude-code", "codex"]`、`dryRun = true`

#### Scenario: --purge 与 client 列表混合顺序

- **WHEN** 用户执行 `tapd-server-cli uninstall --purge claude-code`
- **AND** 或 `tapd-server-cli uninstall claude-code --purge`
- **THEN** 两种顺序均被 CLI 正确解析为 `clients = ["claude-code"]`、`purge = true`

#### Scenario: --dry-run 与 --purge 同时启用

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code --dry-run --purge`
- **THEN** CLI 解析为 `dryRun = true`、`purge = true`
- **AND** 不实际写入或删除任何文件
- **AND** dry-run 输出 MUST 同时列出"将移除的 tapd 条目"与"将清理的持久化文件路径列表"

### Requirement: uninstall 零参且 TTY 时进入 checkbox 多选

当 `tapd-server-cli uninstall` 不带任何客户端参数、并且 `process.stdin.isTTY` 与 `process.stdout.isTTY` 均为真时,CLI MUST 进入交互式 checkbox 多选界面,允许用户用空格切换选中、回车确认。多选界面 MUST 复用 install 的 `select-clients.resolveClients` 实现,仅 prompt 文案不同。

#### Scenario: TTY 下零参进入交互

- **WHEN** 用户在 TTY 终端执行 `tapd-server-cli uninstall`
- **THEN** 终端展示一个 checkbox 列表,包含 `Claude Code` / `Codex` / `OpenCode` / `Cursor` 四项
- **AND** 提示文案 MUST 明确是"卸载"语义(如"选择要卸载的 MCP 客户端")
- **AND** 用户按空格切换选中、回车确认后,CLI 把所选项作为 `clients` 列表传入卸载流程

#### Scenario: 用户回车但未选任何项

- **WHEN** 用户在 checkbox 列表上未选中任何项即回车
- **THEN** CLI 输出"未选择任何客户端,已退出",并以退出码 1 退出

#### Scenario: 用户在 checkbox 中按 Ctrl-C 取消

- **WHEN** 用户在交互式选择期间按下 Ctrl-C
- **THEN** CLI 终止卸载流程,未修改任何客户端配置,且退出码为 130

### Requirement: uninstall 零参且非 TTY 时报错退出

当 `tapd-server-cli uninstall` 不带任何客户端参数、且 stdin 或 stdout 任一不是 TTY 时,CLI MUST 不进入交互式选择,并以退出码 2 退出。stderr 给出明确指引,**示例命令文案 MUST 是 `uninstall` 而非 `install`**。

#### Scenario: 非 TTY 零参直接报错

- **WHEN** `process.stdin.isTTY` 为 false 或 `process.stdout.isTTY` 为 false
- **AND** 用户执行 `tapd-server-cli uninstall`(无 client 参数)
- **THEN** CLI 立即退出,退出码为 2
- **AND** stderr 包含"非交互环境下必须显式指定客户端"等指引文案
- **AND** stderr 示例命令 MUST 形如 `tapd-server-cli uninstall claude-code` 而非 `install`

### Requirement: uninstall 不收集 PAT

`uninstall` 子命令 MUST NOT 提示用户输入 PAT,MUST NOT 读取 `TAPD_TOKEN` 环境变量,MUST NOT 读取 `~/.config/tapd-mcp/token` 文件。卸载流程仅需读现有客户端配置 → 移除 `tapd` 条目 → 备份并原子写回。

#### Scenario: 无 PAT 输入

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code` 且 `TAPD_TOKEN` 环境变量未设置
- **THEN** CLI MUST NOT 提示 PAT 输入
- **AND** CLI MUST NOT 因缺少 PAT 而退出

#### Scenario: 即使 TAPD_TOKEN 已设置也不读取

- **WHEN** `TAPD_TOKEN` 环境变量已设置且用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** CLI MUST 完成卸载,且 MUST NOT 在日志或汇总中引用该 token 值

### Requirement: uninstall 移除 tapd 条目并保留其它内容

对每个目标客户端,CLI MUST 仅从配置文件中移除 `mcpServers.tapd`(Claude Code / OpenCode / Cursor)或 `mcp_servers.tapd`(Codex)节点,**MUST 保留**:
1. 同节(`mcpServers` / `mcp_servers`)下的其它 MCP server 条目(如 `mcpServers.gitlab`);
2. 整个配置文件的其它顶层字段(如 Claude Code 的 `projects`、`telemetry` 等);
3. TOML / JSON 的整体结构不被破坏(允许 TOML 注释丢失,与 install 一致)。

移除后的写入 MUST 通过 `backupAndWrite` 完成:写前若文件存在则备份到 `<path>.bak.<timestamp>`,然后 tmp 文件 + rename 的原子写。

#### Scenario: 保留同节下其它 MCP server

- **WHEN** `~/.claude.json` 的 `mcpServers` 节同时存在 `tapd` 和 `gitlab` 两个条目
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** 写回后 `mcpServers.tapd` MUST 不存在
- **AND** `mcpServers.gitlab` 必须原样保留(键 / command / args / env 全部不变)

#### Scenario: 保留顶层其它字段

- **WHEN** `~/.claude.json` 顶层除 `mcpServers` 外还有 `projects` 或 `telemetry` 等字段
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** 写回后这些顶层字段 MUST 与卸载前完全一致(深度比较)

#### Scenario: 移除前自动备份

- **WHEN** 配置文件存在且 tapd 条目存在
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** 在写回前 MUST 把原文件复制到 `<path>.bak.<timestamp>`
- **AND** 汇总输出 MUST 包含备份路径提示

#### Scenario: mcpServers 移除 tapd 后变空对象

- **WHEN** 配置文件 `mcpServers` 节仅有 `tapd` 一个条目
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** 写回后 `mcpServers` MUST 保留为空对象 `{}`,而非整个删除该字段(保守策略,避免破坏用户的其它工具假设)

#### Scenario: Codex TOML 使用 mcp_servers 节

- **WHEN** `~/.codex/config.toml` 中 `[mcp_servers.tapd]` 节存在
- **AND** 用户执行 `tapd-server-cli uninstall codex`
- **THEN** 写回后 `mcp_servers.tapd` MUST 不存在,但 `[mcp_servers.<其它>]` 节(若有)MUST 保留

### Requirement: uninstall 的 idempotent noop

当目标客户端的配置文件不存在,或文件存在但 `tapd` 条目本来就不存在时,CLI MUST NOT 写文件,MUST 输出 `noop` outcome,且该单家 MUST NOT 计入失败。`hasTapdEntry` 的判定 MUST 采用宽松规则:**只要键 `tapd` 存在于 `mcpServers` / `mcp_servers` 下即视作存在**,以便清理被用户手改的非标准 schema 条目。

#### Scenario: 配置文件不存在

- **WHEN** `~/.claude.json` 不存在
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** CLI MUST NOT 创建该文件
- **AND** 汇总 outcome MUST 是 `noop`,exit code 为 0(若仅此一家)

#### Scenario: 配置文件存在但无 tapd 条目

- **WHEN** `~/.claude.json` 存在,但其 `mcpServers` 不含 `tapd` 键(或整个 `mcpServers` 字段都不存在)
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** CLI MUST NOT 写文件
- **AND** 汇总 outcome MUST 是 `noop`

#### Scenario: 手改坏的非标准 schema 也能识别为存在

- **WHEN** `mcpServers.tapd` 是字符串 `"deprecated"` 而非对象(用户手改)
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`
- **THEN** `hasTapdEntry` MUST 返回 true
- **AND** CLI MUST 把 `mcpServers.tapd` 移除,outcome 为 `removed`

### Requirement: uninstall per-client 失败隔离并输出汇总

当卸载多家客户端时,单家失败 MUST NOT 中断其它家的卸载。所有家处理完成后,CLI MUST 在 stdout 输出每家的最终 outcome 汇总,并在存在任何失败时以非零退出码结束。outcome 取值集合:`removed` / `noop` / `dry-run` / `failed`。

#### Scenario: 部分家失败、其余家成功

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code codex`
- **AND** 写入 claude-code 成功,写入 codex 时抛出异常(如配置文件不可写)
- **THEN** CLI 仍尝试并完成 claude-code 的写入,并打印错误信息
- **AND** stdout 汇总包含 claude-code 的 `removed` 状态与 codex 的 `failed` 状态及失败原因
- **AND** 进程以退出码 1 退出

#### Scenario: 全部成功移除

- **WHEN** 多家全部移除成功或为 noop
- **THEN** CLI 以退出码 0 结束
- **AND** 汇总输出每家的 path 与 outcome

#### Scenario: 全部 dry-run

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code codex --dry-run`
- **THEN** 不写入或删除任何文件
- **AND** 每家分别打印 dry-run 目标路径、待移除的 tapd 条目摘要、移除后 `mcpServers` 剩余键列表
- **AND** 汇总报告每家 outcome 为 `dry-run`,进程以退出码 0 结束

#### Scenario: 汇总格式与 install 对齐

- **WHEN** uninstall 输出汇总行
- **THEN** 格式 MUST 与 install 对齐:
  - `✔ <client>  <path>` 对应 `removed`
  - `= <client>  (no-op) <path>` 对应 `noop`
  - `[dry-run] <client>  <path>` 对应 `dry-run`
  - `✗ <client>  <reason>` 对应 `failed`

### Requirement: uninstall --purge 清理持久化凭据文件

当用户传入 `--purge` 时,CLI MUST 在所有客户端配置卸载完成后,清理 server 自有目录中的两个固定持久化文件:`~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`。默认不开启,需用户显式声明。清理 MUST 严格限定文件名,MUST NOT 递归删除 `~/.config/tapd-mcp/` 目录,MUST NOT 触碰该目录下任何其它文件。

#### Scenario: --purge 在客户端配置卸载完成后执行

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code codex --purge`
- **AND** 两家客户端配置都成功移除
- **THEN** CLI MUST 在客户端循环结束后才开始 purge 操作
- **AND** purge 阶段失败 MUST NOT 影响已完成的客户端 outcome

#### Scenario: cookie 与 token 文件均存在时被移除

- **WHEN** `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token` 都存在
- **AND** 用户执行 `tapd-server-cli uninstall claude-code --purge`
- **THEN** 两个文件 MUST 都被删除
- **AND** 汇总 MUST 包含两行类似 `purge: cookie removed` 与 `purge: token removed`

#### Scenario: cookie / token 文件不存在时视作已是预期状态

- **WHEN** `~/.config/tapd-mcp/cookie` 不存在(ENOENT)
- **AND** 用户执行 `--purge`
- **THEN** CLI MUST NOT 因此报错
- **AND** 汇总 MUST 包含 `purge: cookie not present (skipped)`,不计入 failure

#### Scenario: purge 文件删除失败影响退出码

- **WHEN** `--purge` 阶段删除 cookie 文件时遇到非 ENOENT 错误(如权限不足、Windows 上文件被占用)
- **THEN** 汇总 MUST 输出 `purge: cookie failed (<reason>)`
- **AND** 进程退出码 MUST 是 1(即使所有客户端配置移除均成功)

#### Scenario: 未开 --purge 时持久化文件保留

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code`(未加 `--purge`)
- **AND** `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token` 存在
- **THEN** 两个文件 MUST 不被触碰
- **AND** 汇总 MUST 在末尾追加提示行:`提示:cookie/token 文件未清除(如需清除请加 --purge)`(仅在文件实际存在时显示)

#### Scenario: --purge 只清固定文件名,不递归删除目录

- **WHEN** `~/.config/tapd-mcp/` 目录下除 `cookie` / `token` 外还有用户放的其它文件(如 `backup.json`)
- **AND** 用户执行 `--purge`
- **THEN** `backup.json` MUST 不被删除
- **AND** `~/.config/tapd-mcp/` 目录本身 MUST 不被删除(即使最终变空)

### Requirement: ClientAdapter 接口扩展为支持 uninstall

`ClientAdapter` 接口 MUST 增加两个纯函数方法:`hasTapdEntry(existing)` 判定当前配置是否含 `tapd` 条目;`removeEntry(existing)` 返回移除 `tapd` 条目后的新配置对象。两者 MUST 是纯函数,不进行 I/O。

新增方法 MUST 由 4 家 adapter(claude-code / codex / opencode / cursor)各自实现;现有方法(`read` / `merge` / `write` / `isUpToDate` / `describeCurrent` / `describeNext` / `configPath`)的语义 MUST 保持不变,以确保 install 行为零回归。

#### Scenario: hasTapdEntry 宽松判定

- **WHEN** existing 是 `{ mcpServers: { tapd: <any non-null value> } }`(对象 / 字符串 / 数字均视作存在)
- **THEN** `hasTapdEntry(existing)` MUST 返回 true

- **WHEN** existing 是 `undefined`、`null`、`{}`、`{ mcpServers: {} }`、`{ mcpServers: { other: ... } }`
- **THEN** `hasTapdEntry(existing)` MUST 返回 false

#### Scenario: removeEntry 是纯函数

- **WHEN** 对同一份 existing 多次调用 `removeEntry`
- **THEN** 输入对象 MUST NOT 被原地修改(深度比较前后不变)
- **AND** 返回的新对象 MUST 不包含 `tapd` 键

#### Scenario: install 行为未受影响

- **WHEN** 执行原有 install 路径(`install` 子命令、PAT 收集、`merge` / `isUpToDate` 等)
- **THEN** 所有现有 install 测试 MUST 通过,行为与本次变更前完全一致
