---
description: 登录 TAPD（指引在终端运行 npx tapd-server-cli login，弹独立浏览器抓 cookie）
---

请引导用户在**终端**运行：

```bash
npx tapd-server-cli login
```

工具行为：

1. 启动独立 Chrome / Edge 窗口（不污染日常浏览器）
2. 用户在窗口里完成 TAPD 账号登录
3. cookie 自动写入 `~/.config/tapd-mcp/cookie`（POSIX 600）
4. 附件下载工具 `tapd.attachments.download` 通过 `tools/list_changed` 热加载，即刻可用

> v0.3.0 起改走终端 CLI；旧 MCP 工具 `tapd.login` 仍可用（向后兼容）。
> 终端入口的好处：MCP server 不在线时也能登录、不依赖 client 转发。

如有错误（如未安装 Chrome），按 CLI 输出的指引处理；常见 timeout 可用 `--timeout 600` 加长。
