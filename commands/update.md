---
description: 检查 tapd-server-cli 是否有新版（指引在终端运行 npx tapd-server-cli update）
---

请引导用户在**终端**运行：

```bash
npx tapd-server-cli update
```

工具行为：

1. 读本地 `tapd-server-cli` 当前版本
2. `npm view tapd-server-cli version` 拿 npm registry 上的最新版（5s 超时）
3. 输出三种结论之一：
   - `✓ Up to date` —— 已是最新
   - `↑ Update available: a → b` + 升级建议两行
   - `× Network error` —— 仍 exit 0，不阻断（请求 npm 失败常因 GFW）
4. 不自动升级——多客户端环境下 maintainer 自己掌控升级时机

加 `--json` 出 JSON（脚本消费）：

```bash
npx tapd-server-cli update --json
```

> v0.3.0 起，旧 MCP 工具 `tapd.update` 已删除；本命令是替代入口。
