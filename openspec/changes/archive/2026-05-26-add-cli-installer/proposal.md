## Why

当前 MCP server 已经能用，但安装路径是"手动给用户一段 JSON 让他贴到
`~/.claude.json`"。对非技术用户太陡，且每家客户端的配置文件位置 / 格式
都不一样（Claude Code 的 `~/.claude.json`、Codex 的 `~/.codex/config.toml`、
OpenCode 的配置目录、Cursor 的 `~/.cursor/mcp.json`），用户根本记不住。

MCP 协议的设计前提就是"一份 server，多个客户端共用"—— 把这个 server 发到
npm，再加一个 `install <client>` 子命令把对应客户端的配置文件自动写好，
就能做到：

```bash
npx tapd-server-cli@latest install claude-code
```

一行命令完成安装。剩下的事 server 自己搞定（`/mcp__tapd__setup` slash
命令引导登录），用户全程不需要碰任何配置文件。

## What Changes

- **改包名 & 发 npm**：
  - `package.json` name 由 `tapd-mcp-server`（已被 npm 占用）改成
    `tapd-server-cli`（已查明可用）
  - `bin` 也改成 `tapd-server-cli`（与包名一致，避免冲突）
  - `files` 白名单收紧到 `dist/`、`README.md`、`LICENSE`
  - `repository` / `homepage` / `bugs` 字段补全（npm 页面渲染需要）
  - `keywords` 补 `tapd, mcp, claude, cursor, codex, opencode`
- **新增 `install` 子命令**：
  - 用法：`tapd-server-cli install <client>`
  - `<client>` 取值首发支持：`claude-code` / `codex` / `opencode` / `cursor`
  - 交互式提示输入 TAPD PAT（不接受 `--token` flag —— PAT 上行不应留在
    shell history）
  - 探测对应客户端的配置文件路径，幂等写入 `mcpServers.tapd` 条目（已存在
    时先做时间戳备份再覆盖）
  - 写入的命令统一用 `npx -y tapd-server-cli`（不依赖全局安装）
  - 完成后给出"重启 / 跑 `/mcp__tapd__setup`" 的下一步提示
- **客户端适配器层**：
  - 新增 `src/installer/` 目录，每家客户端一个适配器：
    - `ClientAdapter` 接口：`name` / `configPath()` / `read()` / `write(config)` / `mergeTapdEntry(env)`
    - `adapters/claude-code.ts`、`adapters/codex.ts`、`adapters/opencode.ts`、`adapters/cursor.ts`
  - 通用 stdin 文档：README 给出"我用的 IDE 不在列表"的兜底 JSON 片段
- **CI 自动发版**：
  - `.github/workflows/release.yml`：push `v*` tag → checkout → setup-node → `npm ci` → `npm test` → `npm run build` → `npm publish` → 创建 GitHub Release
  - 需要 `NPM_TOKEN` secret（用户后续在 GitHub 仓库设置）
- **README 重写**：
  - 「快速开始」首屏改成"一行 npx 安装 + 一句 slash 命令登录"
  - 各客户端手动配置块下移到「高级配置」章节作为兜底
  - 修掉旧 README 里 `npm i -g tapd-mcp-server` 错指引（包名已变）

## Capabilities

### Modified Capabilities

- `mcp-server-runtime`：
  - CLI MUST 接受 `install <client>` 子命令
  - install 流程 MUST 是幂等的（重复运行不损坏配置文件）
- `tapd-auth`：
  - PAT 输入 MUST 通过交互式提示（不暴露在 process.argv / shell history）

## Impact

- **依赖**：可能新增 `prompts`（轻量交互式 prompt 库）或直接用 Node 自带
  `readline`，倾向后者降依赖
- **包名变更**：从未发版前提下做，无破坏性
- **配置文件路径**：每家客户端的配置文件路径都已有公开文档，无依赖风险
- **CI 安全**：`NPM_TOKEN` 通过 GitHub repo secret 注入；版本号由 tag 驱动，
  本地不动 `package.json` version
- **风险**：
  - 不同版本的客户端配置 schema 可能变化 → 适配器要做防御性写入（保留未知字段）
  - 用户的 `~/.claude.json` 等是大配置文件，覆写要先备份 + atomic rename
  - 交互式 prompt 在 npx 非 tty 场景（如 piped）会卡住 → 检测 `stdin.isTTY`，
    非 tty 时报错并提示走 `TAPD_TOKEN` env
