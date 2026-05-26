## Context

MCP 协议除了 tools，还提供 **prompts** —— 由 server 注册、由客户端渲染成
slash 命令的预定义对话起点。Claude Code 把 server `tapd` 注册的 prompt
`setup` 渲染为 `/mcp__tapd__setup`。

本变更只新增一个 prompt，作为新用户的"安装后零记忆向导"。

## Goals / Non-Goals

**Goals：**
1. 用户安装完 MCP server 后，在客户端里只输入 `/mcp__tapd__setup` 即可完成
   全部首次配置 —— 不必记 `tapd.whoami` / `tapd.login` 等工具名。
2. cookie 过期后再次跑同一个命令能恢复（向导文本自然引导用户重登）。
3. 不增加任何依赖、不破坏任何现有工具行为。

**Non-Goals：**
- 不实现多个 slash 命令（`/login` / `/logout` / `/whoami` 等分别一个）—
  一个 `setup` 已经覆盖。重新登录靠用户说"重新登录 TAPD" 让 AI 调
  `tapd.login`，或者再跑一次 `/mcp__tapd__setup`。
- 不在 prompt 里接受参数（如 `timeout_minutes`）—— 想自定义就直接说自然语言。
- 不试图自动检测客户端类型并改变 prompt 文本 —— prompt 是 server 侧静态字符串。

## Decisions

### D1. prompt 命名

- 名字：`setup`（短，对所有客户端都友好）
- 客户端渲染（不归本仓库控制）：
  - Claude Code: `/mcp__tapd__setup`（前缀 `mcp__<server>__` 由客户端拼）
  - Cursor: `/tapd:setup`
  - 其它 MCP 客户端按 spec 自行决定

**Why not `tapd-setup`**：客户端会自动加 server 名前缀，再加 `tapd-` 是双重。

### D2. prompt 内容形态

返回单条 user 角色 message，内容是一段中文指令，按编号列出 AI 应执行的工具
调用步骤。AI 看到后会按顺序调工具并组装答复。

```ts
return {
  messages: [
    {
      role: 'user',
      content: { type: 'text', text: SETUP_PROMPT_TEXT },
    },
  ],
};
```

**Why user role**：MCP prompts 的 messages 会被客户端注入到对话中作为该
turn 的提示。用 user role 让 AI 视为来自用户的明确请求，会更可靠地
按列表执行；用 assistant role 会让 AI 误以为是自己之前说的话。

### D3. prompt 文本结构

- 段 1：声明这是 TAPD MCP 首次设置 / 状态检查向导
- 段 2：编号 1..4 列出步骤（whoami → list_capabilities → 视情况 login →
  最终确认 + 总结）
- 段 3：失败兜底（PAT 无效 / 找不到 Chrome / HTTP 模式）的人话提示

文本里 MUST 明确写出工具名：`tapd.whoami` / `tapd.list_capabilities` /
`tapd.login` —— AI 在 prompts/get 拿到这段文字后，会按字面去调对应工具。

### D4. 不依赖 cookie 状态注册

prompt 始终注册（与 login/logout 工具一致），方便用户在任何状态下跑同一个
命令做 "诊断 + 修复"。

### D5. 模块边界

新增独立模块 `src/prompts/setup.ts`，导出 `registerSetupPrompt(server)`。
不放进 `src/tools/`，因为 MCP 协议层 tools 与 prompts 是两个独立 endpoint，
逻辑解耦更清晰。

如果后续还要加 prompt（例如 `/troubleshoot`），目录 `src/prompts/` 已经
预留好。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| prompt 文本里的工具名漂移（重命名工具但忘了改 prompt） | 单测断言 prompt 文本含 `tapd.whoami` / `tapd.list_capabilities` / `tapd.login` 关键字 |
| AI 不严格按编号执行 → 漏掉某步 | prompt 文本写得很显式 + 每一步给出预期判断条件；AI 会按 user message 字面执行 |
| 客户端不支持 prompts 协议 | 不影响其它功能，用户回退到直接调工具即可（已在 README 写清） |
| 用户跑命令时 `tapd.login` 触发的浏览器弹窗在远程 SSH / 容器场景出错 | prompt 文本里包含"如果 server 是 HTTP 模式或无桌面环境，请改用 TAPD_WEB_COOKIE env" 的指引 |

## Open Questions

1. 是否需要 prompt 参数 `force_relogin: boolean` 强制重登？
   决定：不做。重登可以让用户说"重新登录"，AI 直接调 `tapd.login`；
   或者跑 `tapd.logout` + 再跑一次 setup。引入参数会让 prompt 模板更复杂。
2. 是否需要 i18n？
   决定：不做。本仓库中文优先（CLAUDE.md 全中文），用户群明确。
