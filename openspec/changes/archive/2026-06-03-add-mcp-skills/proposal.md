## Why

当前 `tapd-server-cli` 把 TAPD Open API 暴露成一组 MCP 工具，但模型只看得到工具名 + 参数 schema，缺乏"什么时候用、怎么组合、字段语义、安全护栏"等上下文。结果是：用户每次都要从零讲清楚意图，模型容易踩坑（关闭 bug、批量改字段、误读字段枚举），跨客户端使用体验也不一致。

通过把 TAPD 使用知识固化为**可发布、可触发的 Skill 包**，并在安装期一次性铺到 Claude Code / Codex / Cursor / OpenCode 四家客户端，让模型在任何 MCP 上下文里都能直接拿到正确的工作流和护栏。

## What Changes

- **BREAKING**：移除已存在的三个用户级 skill（`tapd-server-cli:login`、`logout`、`update`），改由新的 skill 体系覆盖等价能力。
- 新增 10 个 MCP Skill（4 共享 + 6 普通用户），随 npm 包发布到 `dist/skills/`，安装期由 CLI 渲染落盘。
- 新增 CLI 子命令 `install-skills` 和 `uninstall-skills`（`switch-role` 暂不实现，等管理者 skill 上线时再加）。
- 新增运行期缓存文件 `~/.tapd/cache.json`：MCP server 启动时探测 `whoami` + `list_workspaces` + `knownUsers` 并写入；缓存无 TTL，401/403 时由模型按 `tapd-troubleshoot` 提示用户重新认证。
- 新增安装期配置文件 `~/.tapd/tapd.config.json`（或 `<proj>/.tapd/tapd.config.json`）：记录角色、scope、安装的 skill 清单和文件指纹。
- 自动维护各客户端的"系统提示文件"（Claude Code `CLAUDE.md`、Codex/OpenCode `AGENTS.md`、Cursor `.cursor/rules/tapd.mdc`）：使用 managed block 注入摘要 + 引用 skill 文件路径，幂等可更新。
- 升级时检测用户改动（按 hash 对比），改过的提示 keep / overwrite / show diff，覆盖前自动 `.bak`。
- ��为护栏（写进 `tapd-safety-rules`，所有写操作 skill 必须引用）：
  - HARD-RULE-1 全员禁删除任意 TAPD 条目
  - HARD-RULE-2 全员禁 `bug.status=closed`，仅到 `resolved`
  - HARD-RULE-3 普通用户禁创建任务
  - HARD-RULE-4 写操作确认网关：评论免确认；改状态/owner/创建/批量必须先 preview
  - HARD-RULE-5 单次批量写入上限 10 条

## Capabilities

### New Capabilities

- `mcp-skills`：MCP Skill 包的内容、安装/卸载子命令、运行期缓存与安装期配置、跨客户端落地与升级冲突处理的整套能力。

### Modified Capabilities

- `installer-cli`：新增子命令 `install-skills` / `uninstall-skills`，与现有 `install` 共用 token 输入/AGENTS 写入工具，但走独立流程；现有 `install` 行为不变。
- `mcp-server-runtime`：MCP server 启动时新增"探测身份并写 `~/.tapd/cache.json`"行为；调用 `whoami` / `list_workspaces` / 部分 `users_list`（用于 `knownUsers`）失败时不阻塞启动，只是不更新缓存。

## Impact

- **新代码**：`src/skills/`（skill markdown 源）、`src/commands/install-skills-handler.ts`、`uninstall-skills-handler.ts`、`src/runtime/cache.ts`（启动期写 cache.json）、AGENTS.md managed-block 写入器（可放 `src/installer/agents-md.ts`）、模板渲染器（`src/skills/render.ts`）。
- **修改代码**：`src/cli.ts` 注册新子命令；`src/index.ts` 启动流程加缓存探测；`src/installer/flow.ts` 不变，新流程独立；`scripts/publish.mjs` 把 `dist/skills/` 加进 `files` 清单（已涵盖 `dist/`，确认 build 把 markdown 拷过去）。
- **构建产物**：`tsconfig.json` 或新增构建步骤把 `src/skills/**.md` 拷贝到 `dist/skills/`；npm 包体积会增加（10 个 markdown，估计 +50KB）。
- **新文件落地**：
  - `~/.tapd/tapd.config.json` / `~/.tapd/cache.json`
  - `~/.claude/skills/tapd-*/SKILL.md` × 10（或项目级）
  - `~/.claude/CLAUDE.md` 注入 managed block
  - `~/.codex/AGENTS.md` 注入 managed block
  - `~/.config/opencode/AGENTS.md` 注入 managed block
  - `~/.cursor/rules/tapd.mdc`（全文写）
- **被替代**：原 `tapd-server-cli:login` / `logout` / `update` 三个用户级 skill 文件（如果是本仓库管理则随同删除；如果是 OMC plugin 提供则在 README/CHANGELOG 标注弃用）。
- **测试**：vitest 单测覆盖（模板渲染、AGENTS 注入幂等、hash 比对、UNC 路径解析），E2E 在 `vitest.integration.config.ts` 下覆盖一次完整 install-skills → uninstall-skills 周期。
- **文档**：`README.md` 新增"安装 skill"章节；`CHANGELOG.md` 标 BREAKING（移除旧 skill）+ FEATURE（新 skill 体系）。
- **依赖**：可能新增 `unzipper` / `tar` / `node:zlib`（处理 bug 附件压缩包），其它复用现有 `@modelcontextprotocol/sdk` / `commander` / `zod` / `pino` 栈。
