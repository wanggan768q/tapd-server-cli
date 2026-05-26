## ADDED Requirements

### Requirement: install 子命令的 PAT 输入路径
`tapd-server-cli install <client>` 子命令在收集 TAPD 个人访问令牌时 MUST 优先使用交互式提示（隐藏输入），仅在非 tty 场景下回退到 `TAPD_TOKEN` 环境变量。系统 MUST NOT 接受 `--token <pat>` CLI flag，以避免 PAT 进入 shell history 与进程参数。

#### Scenario: tty 场景默认交互式
- **WHEN** `process.stdin.isTTY === true`，用户执行 `install claude-code`
- **THEN** 进程 MUST 在 stdout 提示 `TAPD 个人访问令牌（PAT）:`
- **AND** 用户输入的字符 MUST NOT 回显（muted input）
- **AND** 输入结果 MUST 通过 trim 后写入目标客户端配置的 `env.TAPD_TOKEN` 字段

#### Scenario: 非 tty 场景使用 env
- **WHEN** `process.stdin.isTTY` 为 falsy（如 `npx ... | tee`）且 `TAPD_TOKEN` 环境变量非空
- **THEN** 进程 MUST 使用 env 值作为 PAT 写入配置
- **AND** stdout MUST 打印 "从 TAPD_TOKEN 环境变量读取 PAT"

#### Scenario: 非 tty 场景且未配置 env
- **WHEN** `process.stdin.isTTY` 为 falsy 且 `TAPD_TOKEN` 环境变量为空
- **THEN** 进程 MUST 以非零退出码终止
- **AND** stderr MUST 输出指引："在非 tty 环境下请通过 TAPD_TOKEN=<pat> tapd-server-cli install <client> 提供令牌"

#### Scenario: 拒绝 --token flag
- **WHEN** 用户执行 `tapd-server-cli install claude-code --token <pat>`
- **THEN** commander MUST 把 `--token` 识别为未知参数并退出
- **AND** stderr MUST 给出说明："出于安全考虑不接受 --token，请用交互式输入或 TAPD_TOKEN env"
