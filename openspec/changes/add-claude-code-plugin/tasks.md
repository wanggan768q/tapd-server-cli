# Tasks — add-claude-code-plugin

执行顺序：先 B0（plugin 文件 + 版本同步基建），再 B1（CLI 优先优化），最后 B3（README）。每个任务标注预估工时；TDD 任务先红再绿。

## 1. Plugin packaging（B0）

- [ ] 1.1 新增 `.claude-plugin/plugin.json`：name=`tapd-server-cli`、version 与 package.json 同步、`userConfig.tapd_token` (sensitive=true)、`mcpServers: "./.mcp.json"` —— 0.5h
- [ ] 1.2 新增 `.claude-plugin/marketplace.json`：单 plugin 入口，`source: "./"`、category=`issue-tracker` —— 0.3h
- [ ] 1.3 新增 `.mcp.json`：`mcpServers.tapd` 走 `npx -y tapd-server-cli`，env 含 `${user_config.tapd_token}` + `TAPD_LOG_LEVEL=info` —— 0.3h
- [ ] 1.4 新增 `commands/login.md`、`commands/logout.md`：对话型口吻 thin wrapper —— 0.5h
- [ ] 1.5 新增 `.npmignore`：显式排除 plugin 文件 + openspec/ + docs/ + test/ —— 0.2h
- [ ] 1.6 跑 `claude plugin validate ./` 通过，跑 `claude --plugin-dir ./` 本地加载验证 —— 0.5h

## 2. 版本同步基建（B0）

- [ ] 2.1 新增 `scripts/sync-plugin-version.mjs`：读 package.json.version，回写 plugin.json.version 与 marketplace.json.plugins[0].version —— 0.5h
- [ ] 2.2 在 `package.json.scripts` 加 `"version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json"` —— 0.2h
- [ ] 2.3 修改 `.github/workflows/release.yml`：发版前校验三处 version 一致；`npm pack --dry-run` 不含 plugin 文件 —— 0.5h
- [ ] 2.4 验证：故意改不一致版本号，跑 release dry-run，确认 fail —— 0.3h

## 3. B1 — claude-cli 模块（TDD 红→绿）

- [ ] 3.1 写 `test/unit/claude-cli.test.ts` 4 个失败用例（先红） —— 0.5h
- [ ] 3.2 实现 `src/installer/claude-cli.ts`：`ClaudeCliProbe` 接口 + `defaultClaudeCliProbe()` (spawnSync) + `preferClaudeCliInstall()` 高阶函数 —— 1h
- [ ] 3.3 跑测试至全绿 —— 0.3h
- [ ] 3.4 验证：手动跑 `npx tapd-server-cli install claude-code`（在装有 `claude` CLI 的环境），观察 `claude mcp list` 是否出现 `tapd` —— 0.3h
- [ ] 3.5 验证 fallback：临时把 `claude` 从 PATH 移走，重跑 install，观察是否回退手写 `~/.claude.json` —— 0.3h

## 4. B1 — codex-cli 模块（TDD 红→绿）

- [ ] 4.1 写 `test/unit/codex-cli.test.ts` 4 个失败用例（对称） —— 0.5h
- [ ] 4.2 实现 `src/installer/codex-cli.ts`：`CodexCliProbe` + `defaultCodexCliProbe()` + `preferCodexCliInstall()` —— 1h
- [ ] 4.3 跑测试至全绿 —— 0.3h
- [ ] 4.4 验证：手动跑 `npx tapd-server-cli install codex`（装有 `codex` CLI），观察 `~/.codex/config.toml` 是否被 codex 写入 —— 0.3h

## 5. B1 — flow.ts 集成

- [ ] 5.1 修改 `src/installer/flow.ts`：在 `claude-code` / `codex` 循环里前置 CLI 优先逻辑 —— 0.7h
- [ ] 5.2 增量写 2 个 `test/unit/installer-flow.test.ts` 集成用例（mock probe，断言 `adapter.write` 不被调） —— 0.5h
- [ ] 5.3 跑全部 `npm test`，确认现行测试不破坏 —— 0.3h

## 6. plugin-manifest 测试

- [ ] 6.1 写 `test/unit/plugin-manifest.test.ts` 3 个用例（schema / version 同步 / .mcp.json env 占位符正确） —— 0.7h
- [ ] 6.2 跑测试至全绿 —— 0.2h

## 7. README 重排（B3）

- [ ] 7.1 顶部新增「在 Claude Code 中安装（推荐）」节，1-2-3 步骤 —— 0.5h
- [ ] 7.2 现行 npx install 节降级为「在其它客户端中安装」，标注 claude-code/codex 现已优先调官方 CLI —— 0.3h
- [ ] 7.3 第 186 行附近加红字：`⚠️ Claude Code 的 MCP 配置在 ~/.claude.json（家目录顶层），不是 ~/.claude/settings.json` —— 0.2h
- [ ] 7.4 故障排查表新增 1 行：`/mcp 看不到 tapd → 检查 ~/.claude.json` —— 0.1h
- [ ] 7.5 卸载节同步：Claude Code 用户 `/plugin uninstall tapd-server-cli`；其它走 `npx ... uninstall <client> --purge` —— 0.2h
- [ ] 7.6 「Slash 命令」节加 `/tapd-server-cli:login` 与 `/tapd-server-cli:logout` —— 0.2h

## 8. 端到端 smoke

- [ ] 8.1 在干净环境（无现存 ~/.claude.json `mcpServers.tapd`）跑 `claude --plugin-dir <repo>` → `/plugin install` → `/mcp` 看 `tapd ✓ Connected` —�� 0.5h
- [ ] 8.2 调 `tapd.whoami` 返回身份；调 `tapd.list_workspaces` 返回 workspace 列表 —— 0.3h
- [ ] 8.3 跑 `/tapd-server-cli:login` → 浏览器登录 → `tapd.attachments.download` 工具出现 —— 0.5h
- [ ] 8.4 跑 `/plugin uninstall tapd-server-cli` → `/mcp` 不再有 `tapd` —— 0.2h

## 9. 发版

- [ ] 9.1 `npm version patch`（带版本同步钩子，自动 commit + tag） —— 0.1h
- [ ] 9.2 `git push --follow-tags`，触发 release CI —— 0.1h
- [ ] 9.3 等 CI 跑完，确认 npm 包发布成功且 `npm pack --dry-run` 不含 plugin 文件 —— 0.3h
- [ ] 9.4 在另一台机器跑 `/plugin marketplace add wanggan768q/tapd-server-cli` + `/plugin install`，确认能从 GitHub 拉到最新版 —— 0.5h

## 总工时估算

约 **13 小时**（不含 review 与返工时间）。建议拆 2-3 个 PR：

- **PR-1**：任务 1-2（plugin 文件 + 版本同步基建）
- **PR-2**：任务 3-6（B1 双 CLI + 测试）
- **PR-3**：任务 7-9（README + smoke + 发版）
