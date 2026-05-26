## 1. 包名 & package.json

- [x] 1.1 `package.json` name → `tapd-server-cli`
- [x] 1.2 `bin` 字段 → `{"tapd-server-cli": "dist/index.js"}`
- [x] 1.3 `files` 收紧到 `["dist", "README.md", "LICENSE"]`
- [x] 1.4 补 `repository` / `homepage` / `bugs` / `keywords`
- [x] 1.5 README 里所有提到 `tapd-mcp` / `tapd-mcp-server` 处全部替换

## 2. CLI 路由

- [x] 2.1 `src/index.ts` 改为 commander 多命令模式，default action 仍跑 server
- [x] 2.2 注册 `install <client>` subcommand（保留 `--http-port` 等现有 flag 在 default 命令上）
- [x] 2.3 `--help` / `--version` 输出与 npm package 对齐

## 3. Installer 模块

- [x] 3.1 新增 `src/installer/adapter.ts`：导出 `ClientAdapter` 接口
- [x] 3.2 `src/installer/adapters/claude-code.ts`：写 `~/.claude.json` 的 user-level `mcpServers.tapd`
- [x] 3.3 `src/installer/adapters/codex.ts`：写 `~/.codex/config.toml` 的 `[mcp_servers.tapd]` 节
- [x] 3.4 `src/installer/adapters/opencode.ts`：写 `~/.config/opencode/mcp.json`
- [x] 3.5 `src/installer/adapters/cursor.ts`：写 `~/.cursor/mcp.json`
- [x] 3.6 `src/installer/prompt.ts`：用 readline 实现 muted PAT 输入
- [x] 3.7 `src/installer/flow.ts`：选适配器 → 收 PAT → 备份 → 写入 → 友好输出
- [x] 3.8 `src/installer/index.ts`：commander subcommand 注册
- [x] 3.9 实现 `--dry-run` flag
- [x] 3.10 实现 `TAPD_TOKEN` env 在非 tty 场景下兜底

## 4. 单测

- [x] 4.1 每个适配器：merge 不改动其它字段；幂等；命令一致时 no-op
- [x] 4.2 atomic write：tmp → rename，目录不存在自动 mkdir
- [x] 4.3 备份命名格式 `<path>.bak.<timestamp>`
- [x] 4.4 prompt：tty 走交互式；非 tty + 有 env 用 env；非 tty 无 env 报错
- [x] 4.5 CLI 路由：default 启动 server；install 走 installer；--help 含 install

## 5. CI 自动发版

- [x] 5.1 `.github/workflows/release.yml`：tag `v*.*.*` 触发
- [x] 5.2 jobs：checkout → setup-node → npm ci → typecheck → test → build → publish → gh release
- [x] 5.3 校验 tag 版本与 package.json version 一致，否则失败
- [x] 5.4 `npm publish --access public --provenance`
- [x] 5.5 NPM_TOKEN secret 文档化（README 加发版指引段）

## 6. README

- [x] 6.1 「快速开始」首屏改为 `npx -y tapd-server-cli install <client>` 四行示例
- [x] 6.2 `/mcp__tapd__setup` 流程置顶
- [x] 6.3 各客户端手动 JSON 配置块下移到「高级配置」
- [x] 6.4 添加「我用的客户端不在列表」段落，给通用 JSON 片段
- [x] 6.5 添加「发版」段落，写 maintainer 怎么 push tag 触发 CI

## 7. 验证与归档

- [x] 7.1 typecheck + npm test + npm run build 全绿
- [x] 7.2 `openspec validate add-cli-installer --strict`
- [x] 7.3 本地 dry-run 四家适配器，确认输出符合预期
- [x] 7.4 `openspec archive add-cli-installer`（CI 发版不阻塞归档）
