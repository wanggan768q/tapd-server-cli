## Context

发到 npm + 写一个 install 子命令听起来简单，但要落地踩稳要先收紧几个边界：
- **包名 / bin 名一致性**：避免用户记两个名字
- **客户端配置文件路径与 schema**：每家不同，要可测试可扩展
- **PAT 输入路径**：cli flag → shell history 泄漏；env → docker / CI 友好；交互式 → npx 一次性安装友好。三者都需要，但默认走哪个？
- **CI 发版安全模型**：npm token、tag 校验、自动 publish 的回滚策略

## Goals / Non-Goals

**Goals**：
1. 一个 npm 包，4 家客户端首发支持 `install <client>` 一键安装
2. PAT 默认交互式输入，可被 `TAPD_TOKEN` env 覆盖（适配 CI / dotfiles 场景）
3. `install` 幂等：重复运行同一命令不会破坏既有配置
4. 写入前自动备份原配置（`<path>.bak.<timestamp>`）
5. push `v*.*.*` tag → CI 自动 publish

**Non-Goals**：
- 不实现 GUI 安装器（这个仓库定位 CLI）
- 不实现 `uninstall` 子命令（用户自己删 mcpServers.tapd 条目即可，加这个反而扩面攻击）
- 不实现自动检测当前用户在用哪家客户端（让用户显式声明，避免猜错）
- 不发 prerelease / beta 通道（首发只发 latest tag）
- 不做对 Claude Code plugin marketplace 的提交（那是另一个生态）

## Decisions

### D1. 包名 & bin 名都用 `tapd-server-cli`

- 包名：`tapd-server-cli`（npm 上 404，可用）
- bin 名：`tapd-server-cli`（与包名一致，避免 `npx tapd-server-cli` 时
  npm 重新解析 bin 映射的边角问题）
- 用户两种调用形态：
  ```bash
  # 跑 MCP server（被 MCP 客户端 spawn）
  npx -y tapd-server-cli
  # 跑 install 子命令（用户主动）
  npx -y tapd-server-cli install claude-code
  ```

Why 不叫 `tapd-mcp` / `tapd-mcp-server`：两个都被占了。

### D2. CLI 路由：保留向后兼容

现有 CLI 入口 `dist/index.js` 是直接启动 server 的。改造为：

```
tapd-server-cli              # 等价当前行为：启动 server
tapd-server-cli install <c>  # 走 installer
tapd-server-cli --help       # commander 渲染帮助
tapd-server-cli --version    # 版本号
```

实现：在 `src/index.ts` 用 commander 多命令模式，default action 仍是
"启动 server"（保持现有 MCP 客户端 spawn 路径不变）。`install` 作为
subcommand。

### D3. 客户端适配器接口

```ts
export interface ClientAdapter {
  /** CLI 里 install <client> 的 <client> 值 */
  readonly key: string;
  /** 用户可读名 */
  readonly displayName: string;
  /** 配置文件绝对路径 */
  configPath(): string;
  /** 读取并解析配置，文件不存在返回 {} */
  read(): Promise<unknown>;
  /** 把 tapd 条目合并到给定配置对象里，返回新对象（pure） */
  merge(config: unknown, tapdEnv: Record<string, string>): unknown;
  /** atomic 写回文件，写之前备份原文件 */
  write(config: unknown): Promise<{ path: string; backup: string | undefined }>;
}
```

四个适配器各自的实现策略：

| 客户端 | 配置文件路径 | 格式 | 路径要点 |
|---|---|---|---|
| `claude-code` | `~/.claude.json` | JSON | `projects[<cwd>].mcpServers.tapd` |
| `codex` | `~/.codex/config.toml` | TOML | `[mcp_servers.tapd]` 节 |
| `opencode` | `~/.config/opencode/mcp.json` | JSON | `mcpServers.tapd` |
| `cursor` | `~/.cursor/mcp.json` | JSON | `mcpServers.tapd` |

**Why** `~/.claude.json` 的 `projects[<cwd>]`：Claude Code 把 MCP 配置按
工程路径切片。但 `install` 命令是用户自己跑的（不知道用户在哪个工程），
所以走 **`mcpServers.tapd`**（用户级全局，所有工程共享）—— 这是 Claude Code
也支持的位置，且对 npx-installed 用户更合理。

旧的 `projects[<cwd>].mcpServers.tapd` 配置不动（让用户自己迁移或两者并存）。

### D4. install 子命令的 UX 流程

```
$ npx -y tapd-server-cli install claude-code
TAPD 个人访问令牌（PAT）: ******** (隐藏输入)

已检测到现有 ~/.claude.json，备份到 ~/.claude.json.bak.1779800123456
已写入 mcpServers.tapd 条目。

下一步：
  1) 重启 Claude Code
  2) 在新会话里输入 /mcp__tapd__setup 完成 cookie 登录
```

- PAT 输入用 Node 自带 `readline.createInterface` + `output` muted；
  不引入 `prompts` 或 `inquirer` 依赖
- `stdin.isTTY === false` 时检测 `TAPD_TOKEN` env：env 存在用 env；
  否则报错并提示 `--token-from-env` 用法

### D5. 已存在 tapd 配置的行为

- **存在但 command/args 与预期完全一致** → no-op，仅打印"已是最新配置"
- **存在但不一致**（用户从源码本地构建、或装过老版本）→ 备份 + 覆盖，
  打印 diff 摘要
- **不存在** → 写入

### D6. CI 发版工作流

```yaml
on:
  push:
    tags: ['v*.*.*']

jobs:
  publish:
    steps:
      - checkout
      - setup-node@v4 (registry-url=npm)
      - npm ci
      - npm run typecheck
      - npm test
      - npm run build
      - update package.json version from tag (verify match)
      - npm publish --access public --provenance
      - gh release create $TAG --generate-notes
```

- `NPM_TOKEN` 通过 repo secret 注入
- `--provenance` 启用 sigstore 签名，提升用户对发布的信任
- tag 版本必须与 `package.json` 当前版本号一致（CI 校验），否则失败
- 发版前在本地 bump 版本 + commit + tag，CI 只负责"看到 tag 就发"

### D7. PAT 安全模型

- **不接受 `--token <pat>` CLI flag**：避免 PAT 进 shell history / 进程列表
- **接受 `TAPD_TOKEN` env**：CI / docker 场景使用
- **交互式输入**：tty 场景默认走这条路径
- **写入文件后**：PAT 在客户端配置文件中以明文存在（这是 MCP 客户端的
  通用形态，我们不发明新机制）。日志中按现有 `maskToken` 规则脱敏

### D8. 模块边界

```
src/installer/
  ├── index.ts         # 注册 install subcommand 到 commander
  ├── adapter.ts       # ClientAdapter 接口 + 工厂
  ├── adapters/
  │   ├── claude-code.ts
  │   ├── codex.ts
  │   ├── opencode.ts
  │   └── cursor.ts
  ├── prompt.ts        # readline 交互式输入 PAT（muted）
  └── flow.ts          # 主流程：选适配器 → 输入 PAT → 备份 → 写入 → 提示
```

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Codex 配置是 TOML，引入 TOML parser 依赖 | 用极小依赖 `@iarna/toml`（无传递依赖，纯 JS） |
| 用户配置文件超大，写入有竞争 | 写 `.tmp` + rename；写之前先 `fs.stat` 校验文件未在写入瞬间被改 |
| 适配器在客户端升级后 schema 变化 | 适配器保留未识别字段（不 strip），只 merge tapd 节 |
| `npx` 拉取超时 / 网络差 | README 给出 `npm i -g` 备选 |
| 用户 PATH 中已有同名 `tapd-server-cli`（不太可能但） | bin 路径冲突由 npm/npx 处理，不在本仓库范围 |
| CI `NPM_TOKEN` 泄漏 | repo secret + 仅在 publish job 注入；不打印到日志 |
| 用户在非 tty 环境（如 docker exec 自动化）跑 install | 检测 isTTY → 报错 + 提示走 env |

## Migration Plan

- 包名变更（`tapd-mcp-server` → `tapd-server-cli`）：因为前者从未真正
  publish 过（仓库私有），无破坏性
- 用户旧的本地 `node E:/Git/.../dist/index.js` 配置仍然工作（command 直接
  指向文件，不依赖包名）
- `~/.claude.json` 中 `projects[<cwd>].mcpServers.tapd` 老配置不被
  installer 触碰，用户可以自行删除或保留

## Open Questions

1. **`install` 是否要支持 `--global` vs `--project` 选择**？
   决定：先不做。默认全局（用户级配置），文档里说"如需仅在某个工程生效，
   手动改 `~/.claude.json` 的 projects[]"。

2. **是否提供 dry-run**？
   决定：做。`--dry-run` 不写文件，只打印 diff + 目标路径。

3. **是否支持一次性 install 到多个客户端**（`install all`）？
   决定：先不做。一次只能一个客户端，明确意图。
