# Spec: `update-command` capability

## ADDED Requirements

### Requirement: `tapd.update` 工具必须返回当前与最新版本

工具调用时必须返回 `current`（server 进程编译时内联的 package.json version 值）与 `latest`（从 npm registry 拉到的当前 `tapd-server-cli` latest dist-tag 版本）。

#### Scenario: 正常网络下返回 current 与 latest

- **When** 用户调用 `tapd.update`
- **And** npm registry 可达
- **Then** 响应 `structuredContent` 包含 `current: string`、`latest: string`
- **And** `current` 等于 server 编译时的 `package.json.version`
- **And** `latest` 等于 `npm view tapd-server-cli version` 的输出去空白后的值

#### Scenario: 网络受限时 latest 降级为 null 而非抛错

- **When** 用户调用 `tapd.update`
- **And** `npm view` 5 秒内未返回（超时）或非零退出
- **Then** 响应 `structuredContent` 包含 `latest: null`、`fetch_error: string`（非空）
- **And** 工具 response 本身仍然成功（不抛 MCP error）

### Requirement: 必须给出 current vs latest 的对比结论

工具响应必须包含 `comparison` 字段，取值 `'up-to-date' | 'update-available' | 'unknown'`。

#### Scenario: 已是最新

- **Given** `current === latest`
- **When** 用户调用 `tapd.update`
- **Then** `comparison === 'up-to-date'`
- **And** `upgrade_commands: []`

#### Scenario: 有可用更新

- **Given** `current` 按 semver 小于 `latest`
- **When** 用户调用 `tapd.update`
- **Then** `comparison === 'update-available'`
- **And** `upgrade_commands.length >= 1`

#### Scenario: 拿不到 latest

- **Given** `latest === null`（fetch 失败）
- **When** 用户调用 `tapd.update`
- **Then** `comparison === 'unknown'`
- **And** `upgrade_commands` 至少包含一条「如何手动检查 latest」步骤

### Requirement: 必须检测并返回 server 的安装路径

工具响应必须包含 `installed_via: 'plugin' | 'npx'`，根据进程环境推断当前 server 进程是从 Claude Code plugin 路径启动还是从 npx install 路径启动。

#### Scenario: plugin 路径检测

- **Given** `process.env.CLAUDE_PLUGIN_ROOT` 已设
- **Or** `process.argv[1]` 路径包含 `.claude/plugins/` 子串
- **When** 用户调用 `tapd.update`
- **Then** `installed_via === 'plugin'`

#### Scenario: npx 路径检测（兜底）

- **Given** 既无 `CLAUDE_PLUGIN_ROOT` env，`argv[1]` 也不含 plugin 路径
- **When** 用户调用 `tapd.update`
- **Then** `installed_via === 'npx'`

### Requirement: 升级指令必须按安装路径分流

`upgrade_commands` 数组里的每条建议必须能在当前安装路径下直接执行；不该给 plugin 用户 `npx -y tapd-server-cli@latest install` 这种会写到错误 scope 的命令。

#### Scenario: plugin 路径的升级指令

- **Given** `installed_via === 'plugin'` 且 `comparison === 'update-available'`
- **When** 用户调用 `tapd.update`
- **Then** `upgrade_commands[0].label` 提到「Claude Code plugin」
- **And** `upgrade_commands[0].steps` 包含 `/plugin marketplace update` 与「重启 Claude Code」

#### Scenario: npx 路径的升级指令

- **Given** `installed_via === 'npx'` 且 `comparison === 'update-available'`
- **When** 用户调用 `tapd.update`
- **Then** `upgrade_commands[0].steps` 包含 `npx -y tapd-server-cli@latest install <client>` 形式
- **And** 步骤里明确提示替换 `<client>` 为 claude-code / codex / opencode / cursor 之一

### Requirement: 工具调用绝不能泄漏环境敏感值

无论查询 latest 是否成功，响应的任何字段（包括 `fetch_error`）都不得回显 `process.env.TAPD_TOKEN` 或其它 PR #1 follow-up #4 引入的 `SENSITIVE_KEYS` 命中的环境变量值。

#### Scenario: spawn `npm view` 错误时 PAT 不泄漏

- **Given** `process.env.TAPD_TOKEN === 'super-secret-pat-xxx'`
- **And** `npm view` 由于不可控原因抛错（环境变量被错误透传到子进程，错误信息引用了 env 值）
- **When** 用户调用 `tapd.update`
- **Then** `fetch_error` 不包含 `'super-secret-pat-xxx'` 字面值
- **And** 也不包含 `encodeURIComponent('super-secret-pat-xxx')`

（实现复用 PR #1 follow-up 引入的 `src/installer/redact.ts`）

### Requirement: slash 命令 `/tapd-server-cli:update` 必须存在并能触发 `tapd.update` 调用

`commands/update.md` 必须存在，frontmatter 含 `description` 字段，正文指示 Claude 调 `tapd.update` MCP 工具并把响应渲染给用户。

#### Scenario: slash 命令文件存在并合规

- **When** 检查 `commands/update.md`
- **Then** 文件存在
- **And** 包含 YAML frontmatter，含非空 `description`
- **And** 正文出现字符串 `tapd.update`

#### Scenario: plugin manifest 注册 commands（如果 manifest 显式列出 commands）

- **Given** `.claude-plugin/plugin.json` 含 `commands` 数组
- **Then** `commands` 数组包含 `update` 条目
- **Or** plugin host 通过扫描 `commands/` 目录自动注册（无需 manifest 改动）

（实现可选其一，但必须确保 `/tapd-server-cli:update` 在 Claude Code 里能被 autocomplete 识别）
