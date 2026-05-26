## ADDED Requirements

### Requirement: 令牌来源与优先级
系统 SHALL 按以下优先级解析 TAPD 个人访问令牌（PAT）：
1) 命令行参数 `--token`；
2) 环境变量 `TAPD_TOKEN`；
3) 用户级配置文件 `~/.config/tapd-mcp/token`（仅当该文件 mode 为 600 时读取）。

#### Scenario: 命令行参数覆盖环境变量
- **WHEN** 启动命令同时提供 `--token A` 与环境变量 `TAPD_TOKEN=B`
- **THEN** 服务 MUST 使用令牌 A

#### Scenario: 文件权限不安全时拒绝读取
- **WHEN** 仅存在配置文件且其权限不是 600（如 644）
- **THEN** 服务 MUST 退出并在 stderr 提示 "配置文件权限不安全，请 chmod 600"

#### Scenario: 完全未提供令牌
- **WHEN** 命令行、环境变量、配置文件均无令牌
- **THEN** 服务 MUST 以非零退出码（78 EX_CONFIG）终止，并在 stderr 输出清晰的获取令牌指引

### Requirement: 启动时令牌验证
服务 SHALL 在启动阶段调用 `GET /users/info` 验证令牌有效性，失败则立即终止进程。

#### Scenario: 令牌有效
- **WHEN** 令牌正确
- **THEN** 服务 MUST 缓存返回的 `user.id`、`user.name`、`user.current_company_id` 并继续启动

#### Scenario: 令牌无效
- **WHEN** `/users/info` 返回 status=401
- **THEN** 服务 MUST 以退出码 78 终止，并在 stderr 提示 "TAPD 令牌无效或已过期"

### Requirement: 令牌脱敏
系统 MUST NOT 在日志、错误信息、`tapd.whoami` 等输出中暴露完整令牌；展示形式为 "前 4 字符 + `***` + 后 4 字符"。

#### Scenario: 在 debug 日志中输出令牌相关信息
- **WHEN** 日志级别为 debug 且记录到鉴权头
- **THEN** 输出 MUST 形如 `b572***1f73`，不得包含完整 PAT

### Requirement: 令牌不落盘
系统 MUST NOT 将令牌写入服务自身的任何文件、缓存或持久存储；只允许在内存中保存且生命周期不超过进程。

#### Scenario: 进程退出
- **WHEN** 进程因任何原因终止
- **THEN** 令牌的所有副本 MUST 随之释放，无任何临时文件残留

### Requirement: 身份内省工具
系统 SHALL 注册 MCP 工具 `tapd.whoami`，返回当前令牌对应的用户身份（id、name、email、current_company_id），令牌本身脱敏。

#### Scenario: 调用 tapd.whoami
- **WHEN** MCP 客户端调用 `tapd.whoami`
- **THEN** 返回字段必须包含 `user_id`、`user_name`、`current_company_id` 与脱敏后的 `token_preview`
