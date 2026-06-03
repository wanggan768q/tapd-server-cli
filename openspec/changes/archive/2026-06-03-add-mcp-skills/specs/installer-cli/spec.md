## ADDED Requirements

### Requirement: install 与 install-skills 流程隔离

`install` 子命令的写入范围 MUST 仍然只限于客户端的 `mcpServers.tapd` / `mcp_servers.tapd` 条目；MUST NOT 写入 `~/.claude/skills/` / `~/.tapd/` / 任何 AGENTS.md managed block。skill 安装/卸载流程 MUST 由独立子命令 `install-skills` / `uninstall-skills` 承担（详见 `mcp-skills` capability）。

#### Scenario: install 不写 skill 产物

- **WHEN** 用户执行 `tapd-server-cli install claude-code`
- **THEN** CLI MUST NOT 创建或修改 `~/.claude/skills/tapd-*/SKILL.md` 任意文件
- **AND** MUST NOT 创建或修改 `~/.claude/CLAUDE.md` 中 managed block 区域
- **AND** MUST NOT 创建 `~/.tapd/tapd.config.json` 或 `~/.tapd/cache.json`
- **AND** 仅写入 `~/.claude.json` 顶层 `mcpServers.tapd`，行为与变更前一致

#### Scenario: install-skills 不收集 PAT 也不写 mcpServers 条目

- **WHEN** 用户执行 `tapd-server-cli install-skills claude-code`
- **THEN** CLI MUST NOT 因缺少 `mcpServers.tapd` 而中止（即使 `install` 从未跑过）
- **AND** MUST NOT 修改任何客户端的 `mcpServers` / `mcp_servers` 节
- **AND** install 的现有适配器 (`claudeCodeAdapter` 等) MUST 在 install-skills 流程中不被调用

#### Scenario: install 和 install-skills 各自独立的入口处理器

- **WHEN** 同时存在 `install` 与 `install-skills` 子命令
- **THEN** 两者 MUST 由不同的 commander action handler 处理（如 `src/installer/flow.ts` 与 `src/commands/install-skills-handler.ts`）
- **AND** `install-skills` MUST NOT 经由 `runInstall` 入口

### Requirement: switch-role 子命令暂不交付

`tapd-server-cli switch-role <role>` 子命令在本变更阶段 MUST NOT 实现可用功能。CLI 解析到该子命令时 MUST 退出码 2 并给出占位提示，等到管理者 skill 上线时另一个变更再启用。

#### Scenario: switch-role 占位

- **WHEN** 用户执行 `tapd-server-cli switch-role admin`
- **THEN** CLI MUST 退出码 2
- **AND** stderr MUST 含字符串 "switch-role" 与 "管理者 skill" 的提示文本
- **AND** MUST NOT 修改任何文件
