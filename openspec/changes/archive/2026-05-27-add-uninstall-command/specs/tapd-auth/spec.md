## ADDED Requirements

### Requirement: uninstall --purge 的凭据清理边界

`tapd-server-cli uninstall --purge` 在清理 server 私有目录的凭据文件时,清理范围 MUST 严格限定为以下两个固定文件:

1. `~/.config/tapd-mcp/cookie` —— 由 `CookieStore` 持久化的浏览器 cookie 文件;
2. `~/.config/tapd-mcp/token` —— 由 PAT 文件落盘路径定义的可选 token 文件。

CLI MUST NOT:
- 递归删除 `~/.config/tapd-mcp/` 目录;
- 删除该目录下的任何其它文件(用户私有备份、未来扩展产物等);
- 调用 `tapd.logout` 工具(那是 MCP server 运行时工具,假设 server 进程已在运行,与 CLI uninstall 路径正交);
- 修改 PAT 在 MCP 客户端配置中的 env 字段以外的存储位置 —— 客户端配置中的 `env.TAPD_TOKEN` 字段随 `tapd` 条目整体移除,由 `installer-cli` 能力负责。

非 `--purge` 模式下,CLI MUST NOT 触碰上述任何持久化文件。

#### Scenario: 仅清理两个固定文���名

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code --purge`
- **AND** `~/.config/tapd-mcp/` 目录下存在 `cookie`、`token`、`backup.json` 三个文件
- **THEN** 实际被删除的文件 MUST 是且仅是 `cookie` 与 `token`
- **AND** `backup.json` MUST 原样保留
- **AND** `~/.config/tapd-mcp/` 目录本身 MUST 保留

#### Scenario: 不调用 tapd.logout 工具

- **WHEN** uninstall --purge 执行过程中需要清理 cookie
- **THEN** 实现 MUST 通过文件系统 API(如 `fs.unlink`)直接删除
- **AND** MUST NOT 通过 MCP 协议或 spawn 子进程调用 `tapd.logout`

#### Scenario: 默认行为保留持久化文件

- **WHEN** 用户执行 `tapd-server-cli uninstall claude-code`(未加 `--purge`)
- **THEN** `~/.config/tapd-mcp/cookie` MUST 不被触碰(如存在)
- **AND** `~/.config/tapd-mcp/token` MUST 不被触碰(如存在)
- **AND** 文件 mode 与权限状态 MUST 与卸载前一致

#### Scenario: PAT 在客户端配置中随 tapd 条目移除

- **WHEN** `~/.claude.json` 的 `mcpServers.tapd.env.TAPD_TOKEN` 存在
- **AND** 用户执行 `tapd-server-cli uninstall claude-code`(无 `--purge`)
- **THEN** 整个 `mcpServers.tapd` 节(含 env.TAPD_TOKEN)MUST 被移除
- **AND** 该过程视为 installer-cli 能力的副作用,不依赖 `--purge`

### Requirement: 凭据清理辅助函数

系统 SHALL 在 auth 模块(`cookie-store` 或同级新增 `persistent-files`)中暴露一个统一的辅助函数 `purgePersistentFiles()`,封装"删除 cookie 文件 + 删除 token 文件"两个动作,返回每个文件的结构化结果(`'removed' | 'not_present' | 'failed'` 及 failed 时的错误信息),供 uninstall-flow 渲染汇总。

该辅助函数 MUST:
1. 对每个目标文件独立执行删除,单文件失败不影响另一个;
2. 把 ENOENT 错误识别为 `not_present`(视作已是预期状态),其它错误识别为 `failed`;
3. ��写入任何文件,不执行除 unlink 外的文件系统操作;
4. 不读取或解析被删除文件的内容(避免日志意外泄露)。

#### Scenario: cookie 删除成功、token 不存在

- **WHEN** `~/.config/tapd-mcp/cookie` 存在且可删,`~/.config/tapd-mcp/token` 不存在
- **THEN** `purgePersistentFiles()` 返回 `{ cookie: 'removed', token: 'not_present' }`
- **AND** ENOENT 错误 MUST NOT 抛出到调用方

#### Scenario: cookie 删除失败、token 删除成功

- **WHEN** `~/.config/tapd-mcp/cookie` 删除遇到 EACCES 错误
- **AND** `~/.config/tapd-mcp/token` 删除成功
- **THEN** 返回结构 MUST 是 `{ cookie: { status: 'failed', error: '<reason>' }, token: 'removed' }`
- **AND** token 的删除 MUST 已经完成,与 cookie 错误隔离

#### Scenario: 不读取文件内容

- **WHEN** `purgePersistentFiles()` 被调用
- **THEN** 实现 MUST NOT 调用 `readFile` 或 `createReadStream`
- **AND** 日志中 MUST NOT 出现被删除文件的内容片段
