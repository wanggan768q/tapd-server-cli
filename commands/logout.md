---
description: 登出 TAPD（清除 server 端 cookie，撤销附件下载工具）
---

请调用 MCP 工具 `tapd.logout` 清除 TAPD 浏览器 cookie：

1. 删除 `~/.config/tapd-mcp/cookie` 文件
2. `tapd.attachments.download` 工具通过 `tools/list_changed` 撤销
3. 后续如需下载附件，需重新调用 `tapd.login`

注意：`tapd.logout` 不会撤销 TAPD 服务端的 PAT；要完全卸载 plugin 与本地凭据，去 `/plugin uninstall tapd-server-cli` + `npx -y tapd-server-cli uninstall claude-code --purge`。
