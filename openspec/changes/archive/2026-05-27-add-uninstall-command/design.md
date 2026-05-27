## Context

`install` 子命令在 4 家 MCP 客户端上一键写入 `mcpServers.tapd`(或 `mcp_servers.tapd`)条目,并把 PAT 注入 env;同时 `tapd.login` 工具会持久化浏览器 cookie 到 `~/.config/tapd-mcp/cookie`,PAT 也可能保存在 `~/.config/tapd-mcp/token`。这些副作用形成了一组分布在多文件、多目录的状态。当前缺一个对称的撤销入口。

现有 install 架构(`src/installer/`)已经把"adapter 抽象 + 编排 flow + 多选交互层 + atomic 写"切得很干净:

- `ClientAdapter` 接口封装 read/merge/write/idempotent 检测与摘要描述。
- `flow.ts` 统一编排 PAT 收集、per-client try/catch 隔离、汇总报告、退出码。
- `select-clients.ts` 处理 TTY 多选 / 非 TTY 报错 / Ctrl-C 取消。
- `io.ts::backupAndWrite` 提供"写前备份 → tmp + rename"原子写。

uninstall 不需要 PAT,核心动作是"反向 merge"——把 tapd 条目从配置中移除。本设计的关键是:**最大化复用上述脚手架,把新增代码集中在 adapter 接口扩展、`uninstall-flow.ts`、CLI 路由三处**;不重写多选交互、不重写备份/原子写。

## Goals / Non-Goals

**Goals:**

1. CLI 形态与 `install` 完全对称(命令名、参数顺序、`--dry-run`、TTY/非 TTY 行为、退出码语义、汇总报告格式)。
2. Per-client 隔离 + 备份 + 原子写 + idempotent noop,行为承诺与 install 一致。
3. 仅删除 `mcpServers.tapd`(或 `mcp_servers.tapd`)节点,**保留同节下其它 server 条目** + **保留文件其它顶层字段**。
4. `--purge` 让卸载语义可"完全清零":除客户端配置外,顺带清掉 `~/.config/tapd-mcp/cookie` 和 `~/.config/tapd-mcp/token`。
5. 不引入新依赖,不破坏现有 `install` 行为。
6. 增量改 `ClientAdapter` 接口的方式不打乱现有 adapter 已实现方法的语义。

**Non-Goals:**

1. **不**删除全局 npm 包(`npm uninstall -g tapd-server-cli` 由用户自行执行,不在本命令范围)——uninstall 只清"配置 + 持久化文件",不动 npm registry 或可执行文件。
2. **不**自动调用 `tapd.logout` 工具——`tapd.logout` 是 server 端运行时工具,需要 server 进程存在;CLI uninstall 不假设有运行中的 server。`--purge` 的清理走文件系统,与 `tapd.logout` 路径一致(都是删 `~/.config/tapd-mcp/cookie`)但实现独立。
3. **不**替用户清理 `.bak.<timestamp>` 备份文件——那是 install 留下的安全垫,uninstall 不该自作主张删。
4. **不**支持"卸载某些 env 但保留其它 env"这样的细粒度操作——uninstall 是粗粒度的"整段 tapd 条目移除"。
5. **不**修改 `tapd.logout` 工具实现(其语义保持原状,服务于运行时 cookie 撤销场景)。

## Decisions

### Decision 1: `ClientAdapter` 接口扩展为新增 2 个方法,而不是新建 `UninstallAdapter` 接口

为接口加 `hasTapdEntry(existing)` + `removeEntry(existing)`。

- **替代方案 A**:另起一个 `UninstallAdapter` 接口,4 家各实现一份。 → 拒。adapter 已经按客户端切分,再按 install/uninstall 切一次会让 4 家变成 8 个对象,且 read/write 路径会重复。
- **替代方案 B**:在 `ClientAdapter` 上加一个超大的 `applyChange(op: 'install' | 'uninstall', ...)` 方法。 → 拒。语义混杂,内部还是要 if/else 分支。
- **选定**:接口加 2 个方法,各 adapter 内部就近读现有 `parseEntry` 复用判定逻辑。`hasTapdEntry` 与 `removeEntry` 都是纯函数,跟现有 `merge` / `isUpToDate` / `describeCurrent` 同语义层级。
- **可选第 3 个方法**:`isEmptyAfterRemove?(after)`,当 `mcpServers` 节移除 tapd 后变成空对象 `{}`,可由 adapter 决定是否进一步删空节。**选项**:留接口但本次实现都返回 `false`(保留空对象),保守不替用户清理无关字段。

### Decision 2: `--purge` 默认关闭

- **替代方案**:默认开启,`--keep-credentials` 反向开关。 → 拒。卸载不该顺手删除可能仍有价值的凭据(用户可能稍后又装回来;cookie 里也包含其它非本工具用途的浏览器登录态片段——虽然我们只读 `.tapd.cn` 域,但用户可能视作敏感)。最小破坏原则。
- **选定**:`--purge` 显式 opt-in。文档明确说明它会删 `~/.config/tapd-mcp/cookie` 和 `~/.config/tapd-mcp/token`(整文件删,不做内容比对)。

### Decision 3: `--purge` 的清理时机:**先清客户端配置,再清持久化文件**

顺序:对每个目标客户端 `removeEntry → backup → atomic write`,完成后再(若 `--purge`)删 cookie/token 文件。

- **理由**:即使 `--purge` 失败(权限、并发占用),客户端配置上的 `tapd` 已经摘除——用户体感"至少 install 这一层撤了"。反过来,先删凭据再改配置,中途失败会留下"配置在但凭据无"的不一致状态,客户端启动会立刻报 unauthenticated。
- **失败处理**:`--purge` 阶段单文件删除失败(非 ENOENT)→ 在汇总中追加 `purge: failed (cookie)` 或 `purge: failed (token)` 一行,**不影响整体退出码**(因为 client 配置已成功移除)——除非用户期望的"完全清零"未达成,这点在文档里说明。**修订**:为避免用户误判"全部成功",改为:任一 `--purge` 文件删除失败 → 整体退出码 = 1。
- ENOENT(文件本来就不存在)→ 视作"已是想要的状态",输出 `purge: cookie not present (skipped)`,不计 failure。

### Decision 4: outcome 命名 = `removed`(不复用 `wrote`)

- **替代方案**:复用 install 的 `wrote`,统一字面值。 → 拒。`wrote` 在 install 语义下是"写入了 tapd 条目",在 uninstall 下含义反过来,会让日志/测试断言模糊。
- **选定**:新增 `removed`。其它 3 个值(`noop` / `dry-run` / `failed`)语义自洽,直接复用。

| outcome | install 语义 | uninstall 语义 |
|---|---|---|
| `wrote` | 已写入 tapd 条目 | (不使用) |
| `removed` | (不使用) | 已移除 tapd 条目 |
| `noop` | tapd 条目已是预期 | 文件不存在 / tapd 条目本来就不在 |
| `dry-run` | 预览未写入 | 预览未移除 |
| `failed` | 失败 | 失败 |

### Decision 5: `select-clients.resolveClients` 改造为接受可选 `message` 参数

当前 `prompt` 内的 `message` 是硬编码"选择要安装到的 MCP 客户端…"。uninstall 复用时需改成"选择要卸载的 MCP 客户端…"。

- **方案**:`ResolveClientsOptions` 加 `message?: string`(默认值保持原文案,确保 install 行为零变化)。
- **`NonInteractiveNoClientError` 文案**也改为接受 `commandName`(`install` 或 `uninstall`),用于错误信息里的示例命令(`示例:tapd-server-cli uninstall claude-code`)。

### Decision 6: 备份策略 = 沿用 `backupAndWrite`,不区分 install/uninstall

uninstall 改写后的配置文件依然走 `backupAndWrite` → `<path>.bak.<ts>`。这样"误删了别的字段"也能从备份回滚。备份路径前缀与 install 一致,便于运维一眼识别。

### Decision 7: `--dry-run` 的 dry-run 信息粒度

dry-run 输出包含:目标路径、当前 tapd 条目摘要(`describeCurrent` 现成)、`移除后 mcpServers 剩余 keys: [...]`(让用户预知是否会留下空节)、是否会执行 `--purge` 清理(列出实际将删除的文件路径)。

### Decision 8: 持久化文件清理实现位置

新增 `src/auth/persistent-files.ts`(或集中到现有 `cookie-store.ts` 加导出函数 `purgePersistentFiles()`),返回一份结构化结果 `{cookie: 'removed' | 'not_present' | 'failed', token: ...}`,由 uninstall-flow 渲染到汇总。

- **理由**:把"知道哪些文件归我管"封装在 auth 模块内,避免 uninstall-flow 硬编码路径。`tapd.logout` 工具未来若也要调,可共享同一函数。

### Decision 9: 退出码

| 场景 | exit code |
|---|---|
| 全部 noop / removed / dry-run,且 purge 全成功(或未启用) | 0 |
| 任一客户端 failed | 1 |
| 任一 `--purge` 文件删除失败(非 ENOENT) | 1 |
| 未识别客户端(cli 解析阶段) | 2 |
| 用户取消多选(Ctrl-C / ExitPromptError) | 130 |
| 非 TTY 零参 | 2(沿用 install) |

## Risks / Trade-offs

- **[Risk] Codex 的 TOML 写回会丢注释。** → Mitigation:与 install 现有问题完全一致,不新增风险。在 design 与 README「卸载」章节复述同款 trade-off,提示用户备份文件可用作回滚。

- **[Risk] 用户配置里 `mcpServers.tapd` 是非标 schema(比如 args 是字符串而非数组),`hasTapdEntry` 误判为不存在。** → Mitigation:`hasTapdEntry` 实现采用"键存在即返回 true"的宽松判定,不复用 install 的 `parseEntry`(那个对 schema 严格,只用于 `isUpToDate`)。这样手改坏的配置也能被 uninstall 正确识别并移除。

- **[Risk] 用户 `--purge` 时 cookie 文件被另一个进程持有(罕见,Windows 上更可能)。** → Mitigation:删除失败按 Decision 3 的规则,以 outcome=failed 报告,exit code = 1。文档提示"重试或手动删除"。

- **[Risk] 误删:`--purge` 把用户其它工具放在 `~/.config/tapd-mcp/` 下的私有文件也删了。** → Mitigation:**只删 server 自己写过的两个固定文件名 `cookie` 和 `token`**,不递归删整个目录。即使目录里还有第三方文件,我们也不动。

- **[Risk] uninstall 完成后,用户配置文件中的 `mcpServers` 节变成空对象 `{}`,某些客户端对此敏感(报 schema 错或视作��用全部)。** → Mitigation:本次保守保留空 `{}`(Decision 1 的 `isEmptyAfterRemove` 默认 false)。在 README 卸载章节加一句"如希望连空节一并移除,请手动编辑或重新 install 别的 server"。后续如收到反馈可在某 adapter 上 opt-in 改为 true。

- **[Risk] 用户在 install 之后手动加过别的 mcpServer(如 `mcpServers.gitlab`),uninstall 误伤。** → Mitigation:`removeEntry` 必须只对 `tapd` 这一个 key 做 `delete`,**单测覆盖**:输入含其它 key 的 `mcpServers` → 输出保留它们。这是核心不变量,4 家 adapter 各自必测。

- **[Risk] `select-clients.resolveClients` 改签名(加 `message`)→ 现有 install 调用点未传 → 文案丢失。** → Mitigation:`message` 是 optional 且有默认值 = 现有硬编码字符串。同时 install 调用点显式传 install 文案,以防默认值未来漂移。

- **[Trade-off] `--purge` 是显式 opt-in,默认行为对大部分用户来说"不够干净"。** 用户可能误以为 `uninstall` 已完全清干净,下次 `install` 时却复用了旧 cookie。 → Mitigation:`uninstall` 的最终汇总里始终输出一行类似 `提示:cookie/token 文件未清除(如需清除请加 --purge)`,使用户对剩余状态有感知。

## Migration Plan

无运行时迁移。纯代码增量。发布即可用。

发版后 README 加章节,告知存量用户可用 `npx -y tapd-server-cli uninstall` 清理。
