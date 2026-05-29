---
description: 登出 TAPD（指引在终端运行 npx tapd-server-cli logout，删除本地 cookie）
---

请引导用户在**终端**运行：

```bash
npx tapd-server-cli logout
```

工具行为：

1. 删除 `~/.config/tapd-mcp/cookie`（如存在）
2. 文件不存在不算错，输出 `= No cookie file found, nothing to clear.`
3. 删完即生效；下次需要附件下载时重新跑 `npx tapd-server-cli login`

> v0.3.0 起改走终端 CLI；旧 MCP 工具 `tapd.logout` 仍可用（向后兼容）。
> 环境变量 `TAPD_WEB_COOKIE` 不在管辖范围——如有设，请用户自己 `unset TAPD_WEB_COOKIE`。

要彻底卸载本工具：`npx -y tapd-server-cli uninstall claude-code --purge`。
