## MODIFIED Requirements

### Requirement: 令牌脱敏
系统 MUST NOT 在日志、错误信息、`tapd.whoami` 等输出中暴露完整令牌；展示形式为 "前 4 字符 + `***` + 后 4 字符"。

本要求同时适用于 `TAPD_WEB_COOKIE` 凭据，但因 cookie 通常超过 200 字符且不便提供识别性预览，cookie 在所有输出中 MUST 完全替换为 `***`，不展示任何字符片段。

#### Scenario: 在 debug 日志中输出令牌相关信息
- **WHEN** 日志级别为 debug 且记录到鉴权头
- **THEN** 输出 MUST 形如 `b572***1f73`，不得包含完整 PAT

#### Scenario: 在 debug 日志中输出 Cookie 请求头
- **WHEN** 日志级别为 debug 且 web client 发出一次请求
- **THEN** 输出中 `Cookie` 字段值 MUST 是 `***`，不得包含 cookie 任何字符

### Requirement: 令牌不落盘
系统 MUST NOT 将令牌或 `TAPD_WEB_COOKIE` 写入服务自身的任何文件、缓存或持久存储；只允许在内存中保存且生命周期不超过进程。

#### Scenario: 进程退出
- **WHEN** 进程因任何原因终止
- **THEN** 令牌与 cookie 的所有副本 MUST 随之释放，无任何临时文件残留
