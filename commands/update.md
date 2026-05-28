---
description: 检查 tapd-server-cli 是否有新版本，并按你的安装路径给出升级指令
---

请调用 MCP 工具 `tapd.update` 完成版本检查与升级建议：

1. 工具会返回：
   - `current`：当前 server 进程的版本
   - `latest`：npm registry 上最新发布的版本（网络受限时为 null）
   - `comparison`：`up-to-date` / `update-available` / `unknown`
   - `installed_via`：`plugin` 或 `npx`，由 server 进程的环境变量 / argv 推断
   - `upgrade_commands`：按当前安装路径量身的升级步骤数组
   - `note` / `fetch_error`：可选诊断信息

2. 把结果渲染给用户：
   - 一行总结：`current vs latest`，明确说明 up-to-date / update-available / unknown
   - 如果 `comparison === 'update-available'`，把 `upgrade_commands[0].steps` 渲染为代码块让用户复制
   - 如果 `comparison === 'unknown'`，把 `fetch_error`（如有）和 `upgrade_commands` 里的"如何手动检查"步骤一起呈现
   - 如果有 `note`，作为 warning 附加（最常见场景：plugin 与 npx 路径并存，建议优先走 plugin 升级）

3. 不要替用户执行升级命令——这些命令多数需要 `/plugin` 在 Claude Code 内运行或在终端跑 `npx`，由用户自己决定时机。
