## ADDED Requirements

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
