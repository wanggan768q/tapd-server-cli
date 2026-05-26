## Why

`add-tapd-login-tool` 把 `tapd.login` / `tapd.logout` 做成了 MCP 工具，但
非技术用户进来要分别记得调多个工具才能完成"安装后第一次设置"：
`whoami` 验 token → `list_capabilities` 看 cookie 状态 → 看情况调 `login`。

让 MCP server 暴露一个 **slash command**（在 Claude Code 里渲染为
`/mcp__tapd__setup`）作为新手向导：用户安装完只需要打一个 slash 命令，
AI 按 prompt 指令依次完成验证 + 登录 + 验收，不再需要记任何工具名。

cookie 过期后再次说"重新登录"或重跑同一个 slash 命令也能恢复。

## What Changes

- **新增 MCP prompt `setup`**：通过 `McpServer.registerPrompt` 注册，
  内容固定写一段中文向导 user message，引导 AI:
  1. 调 `tapd.whoami` 验证 PAT，失败给出 `~/.claude.json` 排错指引
  2. 调 `tapd.list_capabilities`，只摘 `web_client` + `attachment_tools` 字段
  3. 分支：
     - `web_client.enabled=false` → 告知"即将弹出浏览器"，调 `tapd.login` →
       成功后再次 `list_capabilities` 确认 `tapd.attachments.download` 已上线
     - `web_client.enabled=true` → 报告已就绪 + 给出 download 调用示例 +
       提示"如需重新登录请说'重新登录 TAPD'"
  4. 最后一行简短总结当前状态
- **Prompt 模块**：新增 `src/prompts/setup.ts`，导出
  `registerSetupPrompt(server: McpServer): void`。
- **runtime 接通**：`src/runtime/server.ts` 在注册 login/logout 工具之后调用
  `registerSetupPrompt(mcp)`。
- **文档**：README 新增「快速开始 → Slash 命令」小段说明
  `/mcp__tapd__setup` 的渲染规则（Claude Code 命名模式），Cursor / Codex 等
  其它客户端按其文档查看 server prompts 列表。

## Capabilities

### Modified Capabilities

- `mcp-server-runtime`：
  - 启动期 MUST 注册名为 `setup` 的 prompt
  - prompt 内容 MUST 包含 whoami / list_capabilities / login 三个工具的
    显式名称引导

## Impact

- **依赖**：无新增（用 `@modelcontextprotocol/sdk` 已有的 `registerPrompt` API）
- **配置面**：无新增；prompt 始终注册，不依赖 cookie / PAT 状态
- **客户端兼容**：MCP 协议层的 prompts/list 与 prompts/get；所有合规 MCP
  客户端都能消费，渲染形式由客户端决定（Claude Code: `/mcp__tapd__setup`，
  Cursor: `/tapd:setup`）
- **风险**：
  - prompt 文本是固定字符串 → 工具名 / 字段名变化时需要同步更新
    （单测断言关键字存在以防漂移）
  - 不暴露参数 → 想自定义 `timeout_minutes` 等只能直接说"调 tapd.login 设 timeout 8 分钟"
