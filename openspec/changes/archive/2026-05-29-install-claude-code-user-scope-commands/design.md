## Context

Claude Code 的 user-scope commands 机制：放置在 `~/.claude/commands/<namespace>/<name>.md` 的 markdown 文件会被自动注册为 `/<namespace>:<name>` slash 命令——文件 frontmatter 的 `description` 字段显示在 `/` 自动补全列表里，文件正文作为 prompt 注入对话。这是不依赖 plugin 的原生机制，跨 Claude Code 会话/版本稳定。

`remove-claude-code-plugin` change 撤掉 plugin 体系后，`commands/login.md` `logout.md` `update.md` 这些用户教过 Claude 的 slash 命令需要新承接路径。本 change 让 `npx tapd-server-cli install claude-code` 自动把这三个文件拷到 `~/.claude/commands/tapd-server-cli/`——npx install 的副产物，零额外用户操作。

## Goals / Non-Goals

**Goals:**

- 让 `npx tapd-server-cli install claude-code` **额外**做一步：把 npm 包内 `commands/*.md` 拷到 `~/.claude/commands/tapd-server-cli/<file>.md`
- `npx tapd-server-cli uninstall claude-code` 反向清理 `~/.claude/commands/tapd-server-cli/` 整目录
- commands/ 文件进入 npm tarball（package.json files 白名单 + .npmignore + CI npm pack excludes 三处协调）
- 失败 graceful——拷贝失败不阻塞 mcp.json 写入；某个 commands/*.md 不存在时跳过（让本 change 与 `add-cli-subcommands-login-logout-update` change 间无 archive 顺序耦合）
- 测试覆盖 install / uninstall / 文件不存在 / 目录已存在 / 目录有用户其它文件 等场景

**Non-Goals:**

- 不为 codex / opencode / cursor 三家 adapter 做等价拷贝（它们没 user-scope commands 机制；这是 Claude Code 特有原生功能）
- 不改 `commands/login.md` `commands/logout.md` 文本内容（Q2.a 决定：内文写"调 MCP 工具 tapd.login"对 user-scope 路径仍合适）
- 不实现 `commands/update.md` 内容（由 `add-cli-subcommands-login-logout-update` change 重写）；本 change 只负责"如果文件存在就拷"
- 不动 `~/.claude.json` 写入逻辑（plugin 时代的 `claude mcp add-json --scope user` CLI prefer 路径完全保留）

## Decisions

### Decision 1：namespace = `tapd-server-cli`，与 plugin 时代一致

`~/.claude/commands/<namespace>/<name>.md` 的 namespace 决定 slash 命令前缀：

- **选 `tapd-server-cli`**：slash 命令仍是 `/tapd-server-cli:login` `/logout` `/update`（14 字符前缀，靠 Tab 补全）；与 plugin 时代字面一致，老用户零学习成本
- 备选 `tapd`（短）：撞名风险高（未来其它 tapd 工具 plugin / commands）；plugin 时代已选 `tapd-server-cli`，趁机改短不值得

走 `tapd-server-cli`（brainstorm Q1 决定）。

### Decision 2：拷贝时机——install 流程末尾，与 mcp.json 写入分阶段

`flow.ts` 的 install 循环现在是：`adapter.read → isUpToDate → merge → write`（per-client 失败隔离）。本 change 在 `claude-code` 客户端的 write 成功**之后**调 `installCommands()`：

```
write(merged) → 成功 → installCommands(commandsRoot) → 失败 graceful
```

为什么放在 write 之后：

- mcp.json 写入是核心契约（用户要 server 能跑），commands 拷贝是 UX 增强；前者失败应中断、后者失败可降级
- write 已成功 = 用户已经能跑 MCP server；commands 拷贝失败时打 stderr warning 但 install outcome 仍 `wrote`

### Decision 3：失败 graceful——分级处理

`installCommands(commandsRoot)` 内部按文件粒度处理：

- npm 包内 `commands/` 目录不存在（极端边界，理论不可能但防御一下）：跳过整步，stderr warn `commands directory not found in package, skip user-scope commands install`
- 单个 `commands/<name>.md` 不存在：跳过该文件，无 warn（这是 `commands/update.md` 在两个 change 间分阶段实施时的预期）
- `~/.claude/commands/tapd-server-cli/` 创建失败（权限）：stderr warn 整目录路径 + errno；不抛
- 单文件 copyFile 失败（权限/磁盘满）：stderr warn 该文件 + errno；继续下一文件

install summary 末尾若有任何 commands 拷贝 warning，结尾打 `(commands install incomplete: see warnings above; rerun install or check permissions)` 提示。

### Decision 4：uninstall 直接 `rm -rf ~/.claude/commands/tapd-server-cli/`

uninstall 路径**不**做"按 install 时拷过哪些文件反向"——直接删整目录：

- 用户可能手工改过 commands 内容；删整目录 = 清干净
- 用户可能在 commands 目录下塞了自己的文件（如 `tapd-server-cli/my-helper.md`）—— `rm -rf` 会一起删；这是 by-design 的（namespace 是本工具私有的）
- 实现简单：`fs.rm(dir, { recursive: true, force: true })`

`--purge` flag 不需要特殊处理——commands 目录本就是 install 副产物，uninstall 时一律清干净。

### Decision 5：commands/ 进 npm tarball 但不进 package 运行时依赖

npm 包内 `node_modules/tapd-server-cli/commands/*.md` 仅给 install 流程拷贝用——server 运行时不读这些文件、不 import。所以：

- `package.json.files` 加 `"commands"` 让 npm publish 把它打进 tarball
- `.npmignore` 删除 `commands/` 排除项
- `package.json` 的 `main` `bin` `dependencies` 一律不动——这些是运行时入口
- `commands/` 不进入 `dist/`（不 build、不编译）；保留源 markdown

### Decision 6：commands 文件路径解析——找 npm package 安装位置

install 流程跑在 `npx tapd-server-cli install claude-code`——此时 process 的 `import.meta.url` 在 dist 里指向 `dist/installer/...`，npm 包根在 `..../node_modules/tapd-server-cli/`，commands 在 `commands/`。

解析方式：从 `import.meta.url` 推算 package root + 'commands'：

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);  // .../node_modules/tapd-server-cli/dist/installer/adapters/claude-code.js
const packageRoot = join(dirname(__filename), '../../..');  // node_modules/tapd-server-cli
const commandsSrc = join(packageRoot, 'commands');
```

测试时通过依赖注入把 `commandsSrc` 暴露成参数（`installCommands(targetRoot, commandsSrc?)`），便于单测覆盖。

### Decision 7：测试策略——分单元 + 集成两层

**单元层** (`test/unit/installer-adapters.test.ts` 现有 claude-code 测试加用例)：

- `installCommands` 把 mock fs 中 `commandsSrc/{login,logout,update}.md` 拷到 `targetRoot/.claude/commands/tapd-server-cli/`
- `commandsSrc/update.md` 不存在时跳过、login/logout 仍拷
- `commandsSrc/` 整目录不存在时返回 warning
- `removeCommands` 删 `targetRoot/.claude/commands/tapd-server-cli/` 整目录
- `removeCommands` 在目录不存在时静默成功

**集成层** (`test/unit/installer-flow.test.ts` 现有 prefers claude CLI describe 加用例)：

- `runInstall` 完整流程后，`mkdtemp` 的 fakeHome 下 `~/.claude/commands/tapd-server-cli/login.md` 实际存在且字节 = 仓库内 `commands/login.md`
- `runUninstall` 完整流程后，该目录被清空

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 用户已有 `~/.claude/commands/tapd-server-cli/` 目录（手工创建过 / 旧版残留），install 拷贝覆盖用户改动 | install 行为是"拷贝覆盖"——这与 mcp.json 的 backup-and-write 不同；commands 文件被认为是"我们工具私有"。如有必要后续 PR 可加 `--no-overwrite` flag 但目前 YAGNI |
| `~/.claude/commands/tapd-server-cli/` 与未来 Claude Code plugin 路径同名冲突 | namespace 是私有的；如果用户重新装回 plugin 体系（在另一个仓库重做）也只会冲突 namespace 而非物理路径——Claude Code 内部解析 plugin slash 命令应区分 plugin scope 和 user scope。这超出本 change 范围 |
| commands/ 进 npm 包后 npm pack 体积变化、CI npm pack excludes 误报 | 改 grep 模式去��� `^commands/`；保留 `\.claude-plugin/|\.mcp\.json|^skills/|^openspec/|^docs/` 守其它 |
| `add-cli-subcommands-login-logout-update` change 重写 `commands/update.md` 时本 change 的拷贝逻辑跑了"不存在的文件"——graceful 路径未触发 | 三个 change 同 PR 同 commit 顺序：A（删 commands/update.md）→ B（拷贝逻辑跳过不存在文件）→ C（重新建 commands/update.md）。任意中间状态本 change 的 graceful 行为都对 |
| Windows 路径分隔符（`\\` vs `/`）+ home 解析（`os.homedir()`） | `node:path` 模块跨平台兼容；测试覆盖 Win + POSIX 两路径形态 |
| 用户在没装过 claude-code MCP server 的环境直接 install——commands 拷了但 server 不在，slash 命令在 Claude Code 内调用会报"unknown tool tapd.login" | 本 change 的拷贝行为只在 `install claude-code` 子命令成功（mcp.json 已写入）后触发——逻辑上保证了 mcp server 已注册到 ~/.claude.json 才会拷 commands。即便用户后续手工删 mcp.json 但留 commands，错误信息也清楚（unknown tool 提示） |
