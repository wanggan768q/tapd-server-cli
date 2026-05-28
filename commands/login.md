---
description: 登录 TAPD（弹出隔离浏览器抓 cookie，启用附件下载）
---

请调用 MCP 工具 `tapd.login` 完成 TAPD 浏览器登录：

1. 工具会启动一个独立的 Chrome / Edge 窗口（不污染日常浏览器）
2. 用户在弹出窗口完成 TAPD 账号登录
3. cookie 自动写入 `~/.config/tapd-mcp/cookie`（POSIX 600）
4. 附件下载工具 `tapd.attachments.download` 通过 `tools/list_changed` 热加载，即刻可用

调用工具后，等用户确认登录完成；如有错误（如未安装 Chrome），按 `tapd.login` 返回的指引处理。
