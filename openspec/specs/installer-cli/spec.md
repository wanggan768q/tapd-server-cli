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

### Requirement: claude-code install 拷贝 user-scope commands 到 ~/.claude/commands/tapd-server-cli/

`tapd-server-cli install claude-code` 在成功写入 `~/.claude.json` 后，MUST 额外把 npm 包内 `commands/*.md` 文件拷贝到用户家目录 `~/.claude/commands/tapd-server-cli/<file>.md`。

具体行为：

1. 仅 `claude-code` 客户端触发拷贝；codex / opencode / cursor 三家不拷
2. 拷贝时机：mcp.json 写入成功之后；mcp.json 写入失败则不触发拷贝
3. 拷贝来源：npm 包根的 `commands/` 目录，按 `import.meta.url` 推算
4. 拷贝目标：`~/.claude/commands/tapd-server-cli/`（用 `os.homedir()` 解析 `~`）
5. 目标目录不存在时 `mkdir -p` 创建
6. 拷贝行为是**字节级覆盖**（不做 backup、不询问），namespace 视为本工具私有
7. 失败 graceful：拷贝错误打 stderr warning 不抛，install outcome 仍为 `wrote`
8. install summary 输出包含拷贝结果（每个文件 `✓` 或 `✗`）

#### Scenario: claude-code install 成功后用户在 ~/.claude/commands/tapd-server-cli/ 看到三个 .md 文件

- **WHEN** 用户运行 `npx tapd-server-cli install claude-code` 提供 PAT 后
- **AND** mcp.json 写入 `~/.claude.json` 成功
- **THEN** `~/.claude/commands/tapd-server-cli/login.md` 字节级等于 npm 包内 `commands/login.md`
- **AND** `~/.claude/commands/tapd-server-cli/logout.md` 字节级等于 npm 包内 `commands/logout.md`
- **AND** `~/.claude/commands/tapd-server-cli/update.md` 字节级等于 npm 包内 `commands/update.md`（由 `add-cli-subcommands-login-logout-update` change 提供）
- **AND** install summary 输出含 `✓ user-scope commands installed (3 files)`

#### Scenario: 拷贝目标目录已存在用户其它文件——install 不删除它们

- **WHEN** `~/.claude/commands/tapd-server-cli/` 目录已存在
- **AND** 该目录含 `my-custom.md` 文件（用户自己加的）
- **AND** 用户运行 `npx tapd-server-cli install claude-code`
- **THEN** install 把 `login.md` `logout.md` `update.md` 拷进去（覆盖本工具同名文件）
- **AND** `my-custom.md` 保留不删

#### Scenario: 单个 commands/*.md 文件在 npm 包内不存在——graceful 跳过

- **WHEN** npm 包内 `commands/update.md` 因为版本临时不存在（例如 `add-cli-subcommands-login-logout-update` change 还没合入）
- **AND** 用户运行 `npx tapd-server-cli install claude-code`
- **THEN** install 跳过 update.md 不抛错
- **AND** login.md / logout.md 仍正常拷贝
- **AND** install summary 输出 `✓ user-scope commands installed (2 files, update.md skipped — not in package)`

#### Scenario: 用户家目录无写入权限——graceful 警告

- **WHEN** 用户运行 `npx tapd-server-cli install claude-code`
- **AND** mcp.json 写入 `~/.claude.json` 成功
- **AND** `~/.claude/commands/tapd-server-cli/` 目录因权限无法 mkdir
- **THEN** install 不抛错、不中断
- **AND** stderr 输出 `warning: failed to mkdir ~/.claude/commands/tapd-server-cli/ (EACCES)`
- **AND** install summary 输出 `✗ user-scope commands install failed (mkdir EACCES); install otherwise complete`
- **AND** install 总 outcome 仍为 `wrote`、整体 exit code 0

#### Scenario: dry-run 时不真拷贝 commands

- **WHEN** 用户运行 `npx tapd-server-cli install claude-code --dry-run`
- **THEN** install 仅打印计划（包括拟拷贝的 commands 文件清单），不实际写盘
- **AND** `~/.claude/commands/tapd-server-cli/` 不被创建

### Requirement: uninstall claude-code 反向清理 user-scope commands 目录

`tapd-server-cli uninstall claude-code` 在 mcp.json 中的 `mcpServers.tapd` 条目被移除后，MUST 额外删除 `~/.claude/commands/tapd-server-cli/` 整目录（含目录内所有文件）。

具体行为：

1. 仅 `claude-code` 客户端触发清理；codex / opencode / cursor 三家不动
2. 清理时机：mcp.json 修改成功之后；mcp.json 修改失败仍可清理（解耦）
3. 清理动作：`fs.rm(dir, { recursive: true, force: true })`——递归删整目录、目录不存在时静默成功
4. 用户在该目录下塞的自定义 .md 文件**会被一并删除**——namespace 视为本工具私有的契约
5. `--purge` flag 不影响此行为（commands 一律清理）
6. 失败 graceful：删除失败打 stderr warning 不抛

#### Scenario: uninstall 后 ~/.claude/commands/tapd-server-cli/ 整目录消失

- **WHEN** 用户已 install 过、`~/.claude/commands/tapd-server-cli/` 含 login.md/logout.md/update.md
- **AND** 运行 `npx tapd-server-cli uninstall claude-code`
- **THEN** mcp.json 中 `mcpServers.tapd` 被移除
- **AND** `~/.claude/commands/tapd-server-cli/` 整目录被删除
- **AND** uninstall summary 含 `✓ user-scope commands removed`

#### Scenario: 用户在目录里加过自定义文件——uninstall 一并删除

- **WHEN** 用户的 `~/.claude/commands/tapd-server-cli/` 含 `login.md` + `my-helper.md`（自加）
- **AND** 运行 `npx tapd-server-cli uninstall claude-code`
- **THEN** 整目录被删除（`my-helper.md` 也被删）

#### Scenario: 之前没 install 过——uninstall 不抛错

- **WHEN** `~/.claude/commands/tapd-server-cli/` 目录不存在
- **AND** 运行 `npx tapd-server-cli uninstall claude-code`
- **THEN** uninstall 静默跳过此步、不抛错
- **AND** uninstall summary 不显示 commands 移除条目（或显示 `= no user-scope commands to remove`）

#### Scenario: --purge flag 不影响 commands 清理

- **WHEN** 用户运行 `npx tapd-server-cli uninstall claude-code --purge`
- **THEN** commands 目录被删除（与不带 `--purge` 行为一致）
- **AND** 同时 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token` 被清理（既有 `--purge` 行为）

### Requirement: commands/ 目录纳入 npm 包发布产物

npm 包发布的 tarball MUST 含 `commands/` 目录及其下所有 .md 文件，让 `install claude-code` 命令能从 npm 包内拷贝。

具体配置：

1. `package.json.files` 白名单含 `"commands"`
2. `.npmignore` 不排除 `commands/`
3. `.github/workflows/release.yml` 的 `Verify npm package excludes plugin files` step 的 grep 模式不含 `^commands/`（其它如 `\.claude-plugin/|\.mcp\.json|^skills/|^openspec/|^docs/` 保留）
4. `npm pack --dry-run` 输出 Tarball Contents 含 `commands/login.md` `commands/logout.md` `commands/update.md`

#### Scenario: npm pack --dry-run 输出含 commands/

- **WHEN** maintainer 跑 `npm pack --dry-run`
- **THEN** 输出 `Tarball Contents` 含 `commands/login.md` 行
- **AND** 含 `commands/logout.md` 行
- **AND** 含 `commands/update.md` 行
- **AND** 不含 `\.claude-plugin/` 任何条目（这些被 `remove-claude-code-plugin` change 删了）
- **AND** 不含 `\.mcp\.json` 条目
- **AND** 不含 `^openspec/` 条目
- **AND** 不含 `^docs/` 条目

#### Scenario: CI Verify npm package excludes plugin files step 通过

- **WHEN** release CI 跑 `Verify npm package excludes plugin files` step
- **AND** 该 step 的 grep 模式更新为不含 `^commands/`
- **THEN** step 输出 `✓ npm package clean`
- **AND** step exit code 0

### Requirement: CLI 子命令 login / logout / update 在终端独立可用

`tapd-server-cli` CLI MUST 提供三个子命令 `login` / `logout` / `update`，让终端用户不依赖任何 IDE 也能完成 plugin 时代的同款任务（cookie 抓取 / cookie 清理 / 版本检查 + 升级建议）。

子命令路由通过 commander 实现，与现有 `install <client>` `uninstall <client>` 对称——commander 解析 argv、dispatch 到 `src/commands/<name>-handler.ts` 的 handler。

#### Scenario: tapd-server-cli login 弹浏览器抓 cookie

- **WHEN** 用户在终端跑 `npx tapd-server-cli login`
- **THEN** CLI 调 `src/auth/browser-login.ts` 的 `loginAndCaptureCookie()`，弹独立 Chrome / Edge 窗口打开 TAPD 登录页
- **AND** 用户在浏览器登录后，CLI 抓取 `.tapd.cn` 域 cookie 写入 `~/.config/tapd-mcp/cookie`（POSIX mode 600）
- **AND** stdout 输出友好消息（如 `✓ Logged in. Cookie saved to ~/.config/tapd-mcp/cookie`）
- **AND** exit code 0

#### Scenario: tapd-server-cli login 浏览器超时——退出码 1 + 友好错误

- **WHEN** 用户跑 `npx tapd-server-cli login --timeout 5`（5 秒超时）
- **AND** 5 秒内未完成登录
- **THEN** stderr 输出 `Error: browser login timeout (5s); see ~/.config/tapd-mcp/...` 类似消息
- **AND** exit code 1
- **AND** stderr 不含 PAT 明文（虽然 login 流程不持 PAT，仍按 redactError 风格保持）

#### Scenario: tapd-server-cli logout 清除 cookie

- **WHEN** 用户跑 `npx tapd-server-cli logout`
- **THEN** CLI 调 `src/auth/cookie-store.ts` 的 `clearCookie()`，删除 `~/.config/tapd-mcp/cookie`
- **AND** stdout 输出 `✓ Logged out. Cookie cleared.`
- **AND** exit code 0

#### Scenario: tapd-server-cli logout 在没 cookie 时不抛错

- **WHEN** 用户跑 `npx tapd-server-cli logout` 且 `~/.config/tapd-mcp/cookie` 不存在
- **THEN** CLI 静默成功
- **AND** stdout 输出 `= No cookie file found, nothing to clear.`
- **AND** exit code 0

#### Scenario: tapd-server-cli update 当前是最新——up-to-date 输出

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** `package.json.version` = `0.3.0` 且 `npm view tapd-server-cli version` 返回 `0.3.0`
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  0.3.0 (npm registry)

  ✓ Up to date.
  ```
- **AND** exit code 0

#### Scenario: tapd-server-cli update 有新版——给升级建议

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** current = `0.3.0`、latest = `0.3.1`
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  0.3.1 (npm registry)

  ! Update available.

  To upgrade:
    npm install -g tapd-server-cli@latest
  or:
    npx tapd-server-cli@latest install claude-code   # 重新装到 Claude Code 含 user-scope commands 同步
  ```
- **AND** exit code 0（信息查询，不是动作失败）

#### Scenario: tapd-server-cli update --json 输出结构化

- **WHEN** 用户跑 `npx tapd-server-cli update --json`
- **THEN** stdout 输出单行 JSON：
  ```json
  {"current":"0.3.0","latest":"0.3.1","comparison":"outdated","upgrade_commands":["npm install -g tapd-server-cli@latest","npx tapd-server-cli@latest install claude-code"]}
  ```
- **AND** exit code 0

#### Scenario: tapd-server-cli update 网络不可达——permissive 退出 0

- **WHEN** 用户跑 `npx tapd-server-cli update`
- **AND** `npm view` 因网络/registry 不可达/npm 不在 PATH 失败
- **THEN** stdout 输出形如：
  ```
  Current: 0.3.0 (this binary)
  Latest:  <unable to fetch from npm registry: ...>

  ! Network error; cannot check for updates.
  ```
- **AND** exit code 0（**不**是 1——update 是信息查询，网络错误不算动作失败）

#### Scenario: tapd-server-cli update --json 网络不可达——fetch_error 字段

- **WHEN** 同上但加 `--json`
- **THEN** stdout 输出 JSON 含 `fetch_error` 字段：
  ```json
  {"current":"0.3.0","latest":null,"fetch_error":"npm view command failed: ..."}
  ```
- **AND** exit code 0

### Requirement: commands/update.md 指引用户去终端运行 CLI update 子命令

`commands/update.md`（slash 命令源文件，由 `install-claude-code-user-scope-commands` change 拷到 `~/.claude/commands/tapd-server-cli/update.md`）的内文 MUST 指引用户在终端跑 `npx tapd-server-cli update`，而非调用已删除的 `tapd.update` MCP 工具。

frontmatter 含 `description` 字段，简短说明 slash 命令用途（自动补全列表显示）。

#### Scenario: /tapd-server-cli:update slash 命令在 Claude Code 内被触发

- **WHEN** 用户在 Claude Code 会话里输入 `/tapd-server-cli:update`
- **THEN** Claude Code 把 `commands/update.md` 正文作为 prompt 注入对话
- **AND** Claude 看到指引"用户想检查 tapd-server-cli 版本"
- **AND** Claude 用 Bash 工具运行 `npx tapd-server-cli update` 或建议用户在终端跑该命令
- **AND** Claude 把输出格式化展示给用户

#### Scenario: commands/update.md 不再引用 tapd.update MCP 工具

- **WHEN** 任何代码扫描或文档审计读 `commands/update.md`
- **THEN** 文件内容**不**含字符串 `tapd.update`（不能引用已删工具）
- **AND** 文件内容含字符串 `npx tapd-server-cli update`

