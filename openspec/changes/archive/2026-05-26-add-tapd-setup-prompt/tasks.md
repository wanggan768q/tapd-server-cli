## 1. Prompt 模块

- [x] 1.1 新增 `src/prompts/setup.ts`：导出 `registerSetupPrompt(server: McpServer)`
- [x] 1.2 prompt 名 `setup`、title `TAPD 首次设置 / 状态诊断向导`、description 一句话说明用途
- [x] 1.3 prompt 内容：单条 user message，按 D3 描述编号列出 whoami → list_capabilities → 视情况 login → 总结
- [x] 1.4 文本里显式写出 `tapd.whoami` / `tapd.list_capabilities` / `tapd.login` 工具名
- [x] 1.5 包含 PAT 无效、找不到 Chrome、HTTP 模式三个常见失败的处理提示

## 2. Runtime 接通

- [x] 2.1 `src/runtime/server.ts` 引入 `registerSetupPrompt`
- [x] 2.2 在注册 login/logout 之后调用，启动日志加 `setup_prompt: 'registered'`

## 3. 单测

- [x] 3.1 新增 `test/unit/prompts-setup.test.ts`
- [x] 3.2 断言 `_registeredPrompts['setup']` 存在
- [x] 3.3 断言 prompt callback 返回的 messages[0].role === 'user'
- [x] 3.4 断言 message 文本包含 `tapd.whoami` / `tapd.list_capabilities` / `tapd.login` 三个工具名

## 4. 文档

- [x] 4.1 README「快速开始」末尾或「附件下载」章节首段增加 Slash 命令说明：在 Claude Code 输入 `/mcp__tapd__setup` 即可一键完成首次设置
- [x] 4.2 注明 Cursor / Codex 等其它客户端的渲染形式由客户端决定，可在客户端的 prompts 列表里找到 `setup`

## 5. 验证与归档

- [x] 5.1 typecheck + npm test + npm run build 全绿
- [x] 5.2 `openspec validate add-tapd-setup-prompt --strict`
- [ ] 5.3 重启 MCP server 后在 Claude Code 输入 `/mcp__tapd__setup` 验证可见 + 触发能按预期一路走通
- [ ] 5.4 `openspec archive add-tapd-setup-prompt`
