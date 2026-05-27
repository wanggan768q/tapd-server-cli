# Changelog

本仓库所有重要变更都记录在此。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

每个版本段下分组顺序固定:`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`。
未出现的分组省略。

发版前 `scripts/publish.mjs` 与 CI 都会校验:**`CHANGELOG.md` 顶部必须含与即将发布版本号匹配的版本段**。
缺失则拒绝发版。

## [Unreleased]

<!-- 下一版本的变更草稿,合并到 main 时累积。发版时由 publish 流程移到 [<version>]。 -->

## [0.2.0] - 2026-05-27

### Added

- **`uninstall` CLI 子命令**:与 `install` 完全对称的撤销入口。
  - 零参 TTY 弹 checkbox 多选(Claude Code / Codex / OpenCode / Cursor),`select-clients.resolveClients` 通过新的 `message` / `commandName` 选项参数化复用。
  - 显式列出 `tapd-server-cli uninstall claude-code codex` 走非交互流程,与 install 命令行形态一致。
  - `--dry-run`:只预览,输出目标路径、当前 tapd 条目摘要、移除后 `mcpServers` / `mcp_servers` 剩余 keys 列表;不写文件。
  - `--purge`:在客户端配置卸载完成后,额外清理 `~/.config/tapd-mcp/cookie` 与 `~/.config/tapd-mcp/token`。**默认关闭**,需显式声明,以便用户重新 `install` 时复用旧登录态。
  - per-client 失败隔离 + 写前自动备份到 `.bak.<timestamp>` + atomic 写入,沿用 `backupAndWrite` 与 install 同款 trade-off(包括 Codex TOML 注释丢失)。
  - 退出码:0 全部成功 / noop / dry-run;1 任一 client 或 `--purge` 文件失败;2 未识别客户端 / 非 TTY 零参;130 用户 Ctrl-C 取消。
- **`ClientAdapter` 接口扩展**:新增 `hasTapdEntry()` 与 `removeEntry()` 两个纯函数方法,4 家 adapter 各自实现。`hasTapdEntry` 采用宽松判定(键存在即视作存在),便于清理用户手改的非标 schema 条目。
- **`src/auth/persistent-files.ts`**:新增 `purgePersistentFiles()` 与 `hasAnyPersistentFile()` 辅助函数。仅清理两个固定文件名 `cookie` 与 `token`,不递归删除目录,不读取文件内容(避免日志泄露)。
- **README 「卸载」章节**:对称呈现于「快速开始」之后,含 4 种用法示例、`--purge` 默认关闭说明、退出码表与 3 条注意事项;「附件下载(cookie 模式)」末尾追加 cross-link 指向 uninstall + `--purge` 作为完整清理路径。

### Changed

- **`select-clients.resolveClients` 选项参数化**:`ResolveClientsOptions` 增加可选 `message` 与 `commandName`;`NonInteractiveNoClientError` 增加 `commandName` 字段。默认值保持 install 文案,install 调用点显式传入"install"以防默认值未来漂移。

### Spec(OpenSpec)

- `installer-cli`:新增 9 条 requirements 覆盖 uninstall 子命令的解析、TTY/非 TTY 行为、不收 PAT、移除条目并保留其它内容、idempotent noop、per-client 隔离汇总、`--purge` 清理边界、`ClientAdapter` 接口扩展。
- `tapd-auth`:新增 2 条 requirements 覆盖 `--purge` 的凭据清理边界(仅清固定文件名、不调 `tapd.logout` MCP 工具)与 `purgePersistentFiles` 辅助函数语义。
- 变更已归档到 `openspec/changes/archive/2026-05-27-add-uninstall-command/`。

### Tests

新增 41 个测试,旧测试零回归(总计 25 文件 / 264 tests 全绿):

- `installer-adapters.test.ts`:`describe.each` 参数化 4 家 adapter × (`hasTapdEntry` 8 cases + `removeEntry` 5 cases)。
- `persistent-files.test.ts`:两文件存在/不存在/单存在、隔离失败、不调 `readFile`、不动其他文件、目录不删。
- `select-clients.test.ts`:默认 vs 自定义 message、`commandName` 字段断言。
- `uninstall-flow.test.ts`:防御 / noop(文件或条目不存在)/ 实写 / dry-run / 多家 per-client 失败隔离 / `--purge` 全成功 / `--purge` 单文件失败导致 exit=1 / 残留提示 / 汇总格式四态。
- `cli-uninstall.test.ts`:commander 解析 11 种参数组合。
- `cli-uninstall-integration.test.ts`:fork 子进程跑 `tsx src/index.ts uninstall ...`,断言端到端链路联通。

## [0.1.0] - 初始版本

### Added

- TAPD MCP Server 初始版本,通过个人访问令牌(PAT)暴露 TAPD Open API。
- 资源工具:stories / bugs / tasks / iterations / releases / timesheets / comments / attachments / workflows / users / categories / modules / custom-fields。
- 元工具:`tapd.whoami` / `tapd.list_workspaces` / `tapd.list_capabilities` / `tapd.refresh_permissions` / `tapd.login` / `tapd.logout`。
- 一键安装到 MCP 客户端:`tapd-server-cli install` 子命令,支持 Claude Code / Codex / OpenCode / Cursor 四家 checkbox 多选。
- Slash 命令向导:`/mcp__tapd__setup` 一键完成 PAT 验证、cookie 登录、附件下载工具装配。
- stdio + streamable HTTP 双传输;HTTP 模式带 `/healthz`。
- 限流与重试:429 ≤3 次、5xx ≤2 次、指数退避;并发上限默认 8。
- 令牌脱敏:日志强制脱敏(前 4 + `***` + 后 4),令牌不落盘。
- 附件下载 cookie 模式:浏览器登录态 cookie 持久化到 `~/.config/tapd-mcp/cookie`(POSIX mode 600),装配 `tapd.attachments.download` 工具。

[Unreleased]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wanggan768q/tapd-server-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/wanggan768q/tapd-server-cli/releases/tag/v0.1.0
