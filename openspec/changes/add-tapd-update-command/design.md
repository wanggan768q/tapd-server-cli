# Design: `/tapd:update` 升级命令 + 锁版本

## Context

延续 PR #1 的设计基调：**plugin 路径作为推荐路径**，npx 路径保持兼容。本次新增的 `tapd.update` 工具与 `/tapd-server-cli:update` slash 命令需要同时服务 plugin 用户和 npx 用户，但不要把识别用户的责任完全留给 server 代码——能识别的识别（plugin 路径有明确文件系统线索），识别不了的把决策权还给 Claude（让对话流自然追问"你是怎么装的"）。

## Decisions

### D1：`.mcp.json` 锁定到 `~0.2.0`（minor 范围）

- **Why**：拦截一切跨 minor 的变化（含 breaking 与新增工具）。patch 仍自动拿，让安全修复能无感分发。
- **Alternatives**：
  - `^0.2`（major 范围）— 风险太大，0.x 的 minor 经常带 breaking
  - `0.2.0`（完全锁死）— 安全修复也要手动升，patch 负担过重
- **Trade-off**：未来出 0.3.0 时 plugin 用户必须显式 `/plugin marketplace update` —— 但这正是这条命令的存在价值，by-design。

### D2：`tapd.update` 是 MCP 工具，不是 server 自启的"自动检查"

- **Why**：自动检查每次 server 启动都打 `npm view` 既慢又额外暴露 telemetry；用户主动调用一次就够了。
- **Why not slash command 直接 prompt**：纯 prompt 拿不到 server 真实运行时版本——用户机器上同时存在 plugin 装的 v0.2.0 与 npx 装的 v0.3.0 是常见场景，只有 server 进程自身才能确切回答"你正在跟我说话的是哪一份"。
- **决议**：组合方案——`commands/update.md` 指示 Claude 调 `tapd.update`，工具返回结构化数据，Claude 用对话方式渲染。

### D3：当前版本 = 编译时内联 `package.json.version`

- **Why**：运行时读 `package.json` 要算相对路径 + fs IO + 错误处理，复杂且脆弱（plugin 模式下 cwd 与 dist 关系不明）。
- **How**：`src/runtime/version.ts` 一次性 `export const VERSION = '0.2.0'`；写到 `scripts/sync-plugin-version.mjs` 里 `npm version` 钩子时同步更新。
- **Alternative rejected**：读 `import.meta.url` + `../../package.json`——能跑通但 plugin 沙箱里不稳定。

### D4：最新版本 = `spawnSync('npm', ['view', 'tapd-server-cli', 'version'])`

- **Why npm view**：是 npm CLI 内置子命令，几乎一定在 PATH 上（用户能 `npx -y tapd-server-cli` 就一定有 npm）。
- **Why not undici fetch registry**：`registry.npmjs.org` 的 JSON 响应 ~50KB，要解析 JSON 找 `dist-tags.latest`，比 `npm view` 慢 5-10 倍且要管 proxy / corporate registry。
- **超时与降级**：5s `spawnSync` timeout，命中即 `latest: null, fetch_error: 'timeout (5s)'`，工具**仍返成功**——让 Claude 知道有结果但 latest 拿不到，由对话决定是让用户重试还是直接给"如何手动检查"指引。
- **Windows**：复用 `claude-cli.ts` / `codex-cli.ts` 的 `resolveBinaryName()` 模式，按 `npm.cmd → npm.ps1 → npm.exe → npm` 顺序探测——npm 在 Windows 上一定是 `npm.cmd`。

### D5：安装路径检测（installed_via）

| 信号 | 推断 |
|---|---|
| `process.env.CLAUDE_PLUGIN_ROOT` 已设 | `'plugin'`（Claude Code plugin host 注入此 env） |
| `process.argv[1]` 路径包含 `/.claude/plugins/` 或 `\\.claude\\plugins\\` | `'plugin'`（兜底） |
| 都不是 | `'npx'` |

- **Why not 精细到 npx-claude / npx-codex / npx-cursor**：从 server 视角无法可靠区分（envs / argv 都一样），强行判断容易给错指令。**让 Claude 在对话里追问"你是从哪个客户端用的 tapd"** 是更稳的设计。
- **edge case**：用户既装了 plugin 又跑过 `npx install`，server 进程是哪一边启动的就报哪一边——返回结构里多带一个 `note: '检测到 plugin 和 npx 路径可能并存，使用 plugin 路径升级即可'`（plugin scope 优先级低于 user，所以 npx 写到 user scope 的 tapd 会屏蔽 plugin——这是 PR #1 README 已澄清的坑）。

### D6：升级指令（upgrade_commands）按 `installed_via` 分流

```json
{
  "installed_via": "plugin",
  "current": "0.2.0",
  "latest": "0.3.0",
  "comparison": "update-available",
  "upgrade_commands": [
    {
      "label": "Claude Code plugin 路径（推荐）",
      "steps": [
        "/plugin marketplace update tapd-server-cli",
        "/plugin install tapd-server-cli@tapd-server-cli   # 触发升级到 0.3.0",
        "完全退出并重启 Claude Code（quit, 不是 reload）"
      ]
    }
  ],
  "note": null
}
```

npx 路径：

```json
{
  "installed_via": "npx",
  "upgrade_commands": [
    {
      "label": "已用 npx install 路径（任意客户端）",
      "steps": [
        "npx -y tapd-server-cli@latest install <client>    # client 替换为 claude-code / codex / opencode / cursor",
        "重启对应客户端"
      ]
    },
    {
      "label": "Codex / Cursor / OpenCode 用户也可改用 plugin 路径（仅限 Claude Code）",
      "steps": ["参见 README「在 Claude Code 中安装（推荐）」节"]
    }
  ]
}
```

`comparison: 'up-to-date'` 时 `upgrade_commands: []`，只返回 `current` / `latest` 让 Claude 报"已是最新"。`comparison: 'unknown'`（拿不到 latest）时返回"如何手动检查"步骤。

### D7：slash 命令 prompt 简洁，不重复 server 已知信息

`commands/update.md` 只指示 Claude：

1. 调 `tapd.update` 工具
2. 把 `current` / `latest` / `comparison` 渲染为一行人类可读总结
3. 如果有 `upgrade_commands`，把第一个（推荐）路径的 `steps` 渲染成代码块给用户复制
4. 如果有 `note`，作为 warning 附加

工具返回结构良好的数据，Claude 不需要做"决策"，只做"渲染"——这是 MCP 设计的核心契约。

### D8：测试策略

| 测试层 | 文件 | 覆盖 |
|---|---|---|
| 单测：纯函数 | `test/unit/update-logic.test.ts` | 比较版本号 / installed_via 检测分支 / upgrade_commands 选择 |
| 单测：注入式 probe | `test/unit/update-tool.test.ts` | mock `npmViewProbe` 探针，验证 timeout / 网络失败降级 / latest 解析 |
| 集成：MCP 工具响应 | `test/unit/update-tool-integration.test.ts` | 注册到 McpServer 后用 sdk client 调用 `tapd.update` 看 response shape |

复用 PR #1 引入的 `TAPD_TEST_PLATFORM` 钩子覆盖 Windows 探测分支。

## Risks

| 风险 | 概率 | 缓解 |
|---|---|---|
| corporate npm registry 拒绝匿名 `npm view` | 中 | 工具返 `latest: null` + `fetch_error`，Claude 报错并指引用户手动检查 |
| `npm view` 命令本身在某些 nodejs 隔离环境（如 lambda）不可用 | 低 | 同上，try/catch 兜底 |
| Plugin host 未来重命名 `CLAUDE_PLUGIN_ROOT` env | 低 | argv 路径检测做兜底；env 名提取到常量便于一处替换 |
| 用户 plugin 装到自定义路径不含 `.claude/plugins/` | 低 | 文档里建议保留默认 plugin 安装路径；env 信号优先于路径信号 |
| 锁 minor 后 0.2.5 安全修复用户必须重启 server 才能拿到 | 中 | by-design；patch 不破坏 API，重启 server 即可，PR #1 README 卸载节已澄清 |

## Migration

- 现有 plugin 用户：升级 plugin 到本 change 发布的版本后，`.mcp.json` 自动锁定 `~0.2.x`——若 server 升级到 0.3.0，需走 `/plugin marketplace update`。Claude Code 会自动检测 marketplace 新版本提示。
- 现有 npx 用户：`tapd.update` 工具立即可用；老的"靠用户 google `npm view`" 流程不强制废弃，README 标注 `/tapd-server-cli:update` 为推荐路径。
- 零 schema 改动：现有 `.claude.json` / `~/.codex/config.toml` 文件无需迁移。
