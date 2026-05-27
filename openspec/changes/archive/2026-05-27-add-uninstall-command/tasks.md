## 1. ClientAdapter 接口扩展

- [x] 1.1 在 `src/installer/adapter.ts` 的 `ClientAdapter` 接口上新增 `hasTapdEntry(existing: unknown | undefined): boolean` 与 `removeEntry(existing: unknown): unknown` 两个方法签名,补 JSDoc 说明纯函数语义
- [x] 1.2 不改动现有方法签名(`read` / `merge` / `write` / `isUpToDate` / `describeCurrent` / `describeNext` / `configPath`),只追加,确保 install 路径零回归

## 2. 4 家 adapter 实现新方法

- [x] 2.1 `src/installer/adapters/claude-code.ts`:实现 `hasTapdEntry`(检测 `cfg.mcpServers?.tapd != null`,宽松判定不调 `parseEntry`)与 `removeEntry`(返回新对象,深拷贝 mcpServers 节并删 tapd 键,顶层其它字段保留)
- [x] 2.2 `src/installer/adapters/codex.ts`:实现 `hasTapdEntry`(检测 `cfg.mcp_servers?.tapd != null`)与 `removeEntry`(操作 `mcp_servers` 节)
- [x] 2.3 `src/installer/adapters/opencode.ts`:复用 claude-code 同款实现(键路径都是 `mcpServers.tapd`)
- [x] 2.4 `src/installer/adapters/cursor.ts`:复用 claude-code 同款实现
- [x] 2.5 单测覆盖 4 家 adapter 的 `hasTapdEntry` / `removeEntry`(包含:undefined 输入、空对象、含 tapd 与其它 server 共存、tapd 是非标值如字符串、删除后保留同节其它 key、保留顶层其它字段、纯函数不修改输入)

## 3. 凭据清理辅助函数(tapd-auth)

- [x] 3.1 在 `src/auth/` 下新增 `persistent-files.ts`(或在 `cookie-store.ts` 加导出),实现 `purgePersistentFiles()` 函数:并行删除 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`,ENOENT → `not_present`,其它错 → `failed` 携带 reason
- [x] 3.2 函数签名返回 `{ cookie: PurgeOutcome; token: PurgeOutcome }`,其中 `PurgeOutcome = 'removed' | 'not_present' | { status: 'failed'; error: string }`
- [x] 3.3 单测:cookie 存在 + token 存在、cookie 存在 + token 不存在、cookie 删失败 + token 删成功、两者都不存在,且断言不读取文件内容(spy `fs.readFile` 未被调用)

## 4. select-clients 文案参数化

- [x] 4.1 修改 `src/installer/select-clients.ts`:`ResolveClientsOptions` 加可选 `message?: string`,`NonInteractiveNoClientError` 加可选 `commandName?: string`(用于错误提示中的示例命令)
- [x] 4.2 默认值保持现有"选择要安装到的 MCP 客户端…"文案,确保 install 行为零变化
- [x] 4.3 install 调用点(`src/index.ts`)显式传入 install 文案,以防默认值未来漂移
- [x] 4.4 单测覆盖:不传 message → 默认文案、传 message → 自定义文案、`NonInteractiveNoClientError` 错误信息中包含正确的子命令名

## 5. uninstall-flow 模块

- [x] 5.1 新建 `src/installer/uninstall-flow.ts`,定义 `RunUninstallOptions { clients, dryRun, purge, stdout?, stderr? }` 与 `RunUninstallResult { exitCode, results }`
- [x] 5.2 定义 `PerClientUninstallOutcome = 'removed' | 'noop' | 'dry-run' | 'failed'`,`PerClientUninstallResult { client, outcome, path, backup?, error? }`
- [x] 5.3 主流程:对每个 client → adapter.read() → adapter.hasTapdEntry → 若 false 则 outcome=`noop`;若 true 则 dry-run 分支输出预览,实写分支调 `adapter.removeEntry` + `adapter.write`(后者内部走 `backupAndWrite`)
- [x] 5.4 dry-run 输出:目标路径、当前 tapd 条目摘要(`describeCurrent`)、移除后 mcpServers/mcp_servers 剩余 keys 列表、若 `--purge` 列出待清理的两个文件路径
- [x] 5.5 客户端循环结束后,若 `opts.purge` 为 true 则调 `purgePersistentFiles()`,把每个文件的结果渲染为汇总行(`purge: cookie removed` / `purge: token not present (skipped)` / `purge: cookie failed (<reason>)`)
- [x] 5.6 退出码计算:任一 client failed → 1;`--purge` 阶段任一文件 failed → 1;其它情况 → 0
- [x] 5.7 未开 `--purge` 时,若实际检测到 cookie 或 token 文件存在(用 `fs.access` 探测),在汇总末尾输出提示行:`提示:cookie/token 文件未清除(如需清除请加 --purge)`
- [x] 5.8 汇总输出格式与 install 对齐(`✔` removed / `=` noop / `[dry-run]` / `✗` failed)
- [x] 5.9 单测:全部成功、单家失败其它成功(确认隔离)、idempotent noop(文件不存在 / tapd 条目不存在)、dry-run 多家、`--purge` 全成功、`--purge` 单文件失败导致 exit=1、未开 `--purge` 但凭据存在时的提示行、`--purge` 与 `--dry-run` 同时启用(不实际删任何东西)

## 6. CLI 解析层

- [x] 6.1 修改 `src/cli.ts`:`ParsedCli` 联合类型加 `| { mode: 'uninstall'; clients: string[]; dryRun: boolean; purge: boolean }`
- [x] 6.2 用 commander 注册 `uninstall [clients...]` 子命令,挂 `--dry-run` 与 `--purge` flag,复用 `SUPPORTED_CLIENTS` 与 `UnknownClientError` 校验
- [x] 6.3 子命令 description 文案对称参考 install,明确"卸载"语义并提示 `--purge` 的副作用("额外清理 ~/.config/tapd-mcp/cookie 与 token 文件")
- [x] 6.4 单测:`uninstall`、`uninstall claude-code`、`uninstall claude-code codex`、`--dry-run` 与 client 列表混合顺序、`--purge` 与 client 列表混合顺序、`--dry-run --purge` 同时启用、未识别 client 触发 `UnknownClientError`

## 7. 顶层入口路由

- [x] 7.1 修改 `src/index.ts`:在 `parsed.mode === 'install'` 分支后追加 `parsed.mode === 'uninstall'` 分支
- [x] 7.2 路由内调 `resolveClients(parsed.clients, { adapters, message: '选择要卸载的 MCP 客户端(空格选择,回车确认)', commandName: 'uninstall' })`
- [x] 7.3 异常处理(`NonInteractiveNoClientError` → exit 2 含 uninstall 示例、`NoClientsSelectedError` → exit 1、`UserCancelledError` → exit 130)与 install 镜像
- [x] 7.4 调 `runUninstall({ clients, dryRun: parsed.dryRun, purge: parsed.purge })` 并 `process.exit(result.exitCode)`
- [x] 7.5 集成测试:完整 fork 子进程跑 `tapd-server-cli uninstall claude-code --dry-run`,断言 exit=0 + stdout 包含预期内容

## 8. README 文档

- [x] 8.1 在「快速开始(推荐:一键安装)」章节后,新增「卸载」章节,含交互/显式/`--dry-run`/`--purge` 四个用法示例
- [x] 8.2 强调 `--purge` 的副作用,与默认行为(保留 cookie/token 以备再装)对比说明
- [x] 8.3 提示 TOML 注释丢失风险与 `.bak.<timestamp>` 备份回滚路径(沿用 install 同款 trade-off)
- [x] 8.4 在「附件下载(cookie 模式)」章节末尾,加一句指向 uninstall + `--purge` 作为完整清理路径的 cross-link

## 9. 验收

- [x] 9.1 `npm test` 全绿,新增测试覆盖率不低于现有 installer 模块基线
- [x] 9.2 手动验证四家客户端真实文件场景(可在临时 HOME 下跑):安装→卸载→检查文件 diff,确认仅 tapd 条目被移除
- [x] 9.3 `--purge` 手动验证:在临时 HOME 下放假 cookie / token 文件,跑 `--purge` 后断言文件被删、目录保留、其它文件不动
- [x] 9.4 跑 `openspec verify add-uninstall-command` 校验 spec 与实现一致
- [ ] 9.5 跑 `openspec archive add-uninstall-command` 归档(变更落入 main specs)
