# claude-code-plugin Specification

## ADDED Requirements

### Requirement: 仓库提供 Claude Code plugin manifest

仓库根 MUST 提供 `.claude-plugin/plugin.json` 作为 Claude Code plugin manifest，让用户可以通过 `/plugin marketplace add <owner>/<repo>` + `/plugin install` 在 Claude Code 内一行命令安装 TAPD MCP server。

manifest 必填字段：

- `name`：`"tapd-server-cli"`（与 npm 包名一致）
- `version`：与 `package.json.version` 严格一致
- `description`：中文描述
- `userConfig.tapd_token`：`type=string`、`sensitive=true`、`title="TAPD 个人访问令牌"`
- `mcpServers`：指向 `"./.mcp.json"`

#### Scenario: 用户安装 plugin 时弹窗收 PAT

- **WHEN** 用户在 Claude Code 内执行 `/plugin install tapd-server-cli@tapd-server-cli`
- **THEN** Claude Code 渲染 `userConfig.tapd_token` 为弹窗输入框
- **AND** 标题显示 `"TAPD 个人访问令牌"`
- **AND** 输入字段为密文类型（`sensitive=true` 触发的 muted input）
- **AND** 用户输入并提交后，PAT 进入系统 keychain（macOS/Windows）或 `~/.claude/.credentials.json`（Linux fallback）
- **AND** PAT 的明文不落到任何普通配置文件

#### Scenario: plugin.json.version 与 package.json.version 一致

- **WHEN** CI 在 release 流程中跑版本同步校验
- **THEN** `.claude-plugin/plugin.json` 的 `version` 字段与 `package.json` 的 `version` 字段**字符串相等**
- **AND** 不一致时 CI 立即 fail，不进入 `npm publish` 步骤

### Requirement: 仓库提供 marketplace manifest 让自身被发现

仓库根 MUST 提供 `.claude-plugin/marketplace.json`，使外部用户可以用 `/plugin marketplace add <owner>/<repo>` 把本仓库注册为 plugin marketplace。

marketplace 内 MUST 包含本仓库自身作为 plugin 条目，`source` 指向 `"./"`（仓库根即 plugin）。

#### Scenario: 用户注册 marketplace 后能发现 plugin

- **WHEN** 用户执行 `/plugin marketplace add wanggan768q/tapd-server-cli`
- **THEN** Claude Code 拉取 `marketplace.json`、解析其中 `plugins` 数组
- **AND** 在 `/plugin` 浏览器中显示一个名为 `tapd-server-cli` 的 plugin 条目
- **AND** 条目附 `description` 与 `category=issue-tracker`

#### Scenario: marketplace 的 version 与 plugin 一致

- **WHEN** CI 跑版本同步校验
- **THEN** `.claude-plugin/marketplace.json.plugins[0].version` 与 `.claude-plugin/plugin.json.version` 与 `package.json.version` 三者**字符串相等**
- **AND** 任一不一致 CI fail

### Requirement: bundled MCP server 通过 npx 拉起，PAT 走 user_config 占位符注入

仓库根 MUST 提供 `.mcp.json`，定义名为 `tapd` 的 stdio MCP server。配置 MUST 满足：

- `command = "npx"`
- `args = ["-y", "tapd-server-cli"]`
- `env.TAPD_TOKEN = "${user_config.tapd_token}"`
- `env.TAPD_LOG_LEVEL = "info"`

#### Scenario: plugin 启用后 MCP server 自动起，env 注入 PAT

- **WHEN** 用户在 Claude Code 内启用 plugin（`/plugin install` 或 `/plugin enable`）
- **AND** `userConfig.tapd_token` 已收齐
- **THEN** Claude Code 自动 spawn `npx -y tapd-server-cli` 进程
- **AND** 子进程 `process.env.TAPD_TOKEN` 等于用户输入的 PAT
- **AND** 子进程 `process.env.TAPD_LOG_LEVEL` 等于 `"info"`
- **AND** server 启动成功后输出 `step:"stdio_ready"`，`/mcp` 显示 `tapd ✓ Connected`

#### Scenario: server key 与 plugin name 解耦

- **WHEN** 用户在会话里调用 MCP 工具
- **THEN** 工具命名空间为 `tapd.*`（如 `tapd.whoami` `tapd.stories.list`）
- **AND** 而非 `tapd-server-cli.*`，因为 MCP server key 在 `.mcp.json` 里独立定义为 `"tapd"`

### Requirement: plugin 提供 slash 命令包装

仓库根 MUST 提供 `commands/` 目录，含 `login.md` 与 `logout.md` 两个 slash 命令文件，让用户可以通过 `/tapd-server-cli:login` 与 `/tapd-server-cli:logout` 触发 cookie 登录/登出流程。

每个 `*.md` 文件 MUST 包含：

- 文件顶部 frontmatter（`description` 字段）
- 对话型口吻的指令体（指示 Claude 调相应 MCP 工具）

#### Scenario: 用户输入 /tapd-server-cli:login 触发浏览器登录

- **WHEN** 用户在会话里输入 `/tapd-server-cli:login`
- **THEN** Claude 解析 `commands/login.md` 内容并理解需要调用 `tapd.login` MCP 工具
- **AND** Claude 调用 `tapd.login` 工具
- **AND** server 弹出隔离浏览器窗口，用户登录后 cookie 自动持久化
- **AND** `tapd.attachments.download` 工具通过 `tools/list_changed` 热加载

#### Scenario: 用户输入 /tapd-server-cli:logout 清除 cookie

- **WHEN** 用户输入 `/tapd-server-cli:logout`
- **THEN** Claude 调用 `tapd.logout` MCP 工具
- **AND** server 端 cookie 文件被删除
- **AND** `tapd.attachments.download` 工具撤销

### Requirement: plugin 文件不进入 npm publish

仓库 MUST 通过 `package.json.files` 白名单 + `.npmignore` 双保险机制，确保 plugin 相关文件不被打包进 `npm publish` 的 tarball。

被排除的路径包括（但不限于）：`.claude-plugin/`、`.codex-plugin/`、`.mcp.json`、`commands/`、`skills/`、`openspec/`、`docs/`、`test/`。

#### Scenario: npm pack --dry-run 不输出 plugin 文件

- **WHEN** CI 或开发者本地跑 `npm pack --dry-run`
- **THEN** 输出文件清单**不**含 `.claude-plugin/`、`.mcp.json`、`commands/`、`skills/`、`openspec/`、`docs/` 任意路径
- **AND** 输出仅含 `dist/`、`README.md`、`LICENSE`、`package.json` 必要文件

#### Scenario: CI 检测 plugin 文件落入包内时 fail

- **WHEN** 开发者误把 plugin 文件加到 `package.json.files` 白名单
- **AND** release CI 跑 `npm pack --dry-run` 检查
- **THEN** CI 检测到 `.claude-plugin/` 等关键字出现在打包清单
- **AND** CI 立即 fail，不进入 `npm publish` 步骤

### Requirement: 与现行 npx install 路径并存且明确优先级

Plugin 上线后，现行 `npx tapd-server-cli install claude-code` 路径 MUST 保留，不破坏老用户。README MUST 在「在 Claude Code 中安装」节明确说明 plugin 路径为推荐路径；将 `npx install` 路径降级到「在其它客户端中安装」节。

当用户**已通过** `npx install claude-code` 装过、又装 plugin 时，README 卸载节 MUST 提供清晰迁移路径（先卸载 npx 装的、再装 plugin）。

#### Scenario: README 顶部「在 Claude Code 中安装」节为 plugin 路径

- **WHEN** 新用户阅读 README
- **THEN** 顶部第一个安装节标题为「在 Claude Code 中安装（推荐）」
- **AND** 内容为 `/plugin marketplace add ...` + `/plugin install ...` + 弹窗输入 PAT 三步
- **AND** 现行 `npx install` 内容降级到下一节，标题为「在其它客户端中安装」

#### Scenario: 卸载节提供从 npx 迁移到 plugin 的路径

- **WHEN** 老用户想从 npx install 切换到 plugin
- **AND** 阅读 README 卸载节
- **THEN** 卸载节包含明确步骤：(1) `npx tapd-server-cli uninstall claude-code` 清掉 ~/.claude.json 的 mcpServers.tapd；(2) 在 Claude Code 内 `/plugin install`
