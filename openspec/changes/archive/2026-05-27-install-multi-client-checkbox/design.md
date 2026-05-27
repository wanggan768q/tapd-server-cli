## Context

`tapd-server-cli install` 子命令当前在 `src/cli.ts` 通过 commander 的 `install <client>` 形态实现，必填单个位置参数。`src/installer/flow.ts` 的 `runInstall({ client, dryRun })` 也只处理一个 adapter。adapter 注册表 `ALL_ADAPTERS` 已包含四家：`claude-code` / `codex` / `opencode` / `cursor`。PAT 输入由 `promptToken`（已存在的 TTY 交互）或 `--token` / `TAPD_TOKEN` 提供。

现状的两个体验摩擦：
1. 用户同时使用 ≥2 个 MCP 客户端是常态（Claude Code + Codex / Cursor），需重复跑 N 次 install，并 N 次输入 PAT。
2. 没传 client 时 commander 直接打印参数错误退出，对初次使用者无引导。

约束：
- 需保持向后兼容旧 CI / 脚本：`install claude-code` 形态语义不变。
- stdin 非 TTY 场景（CI、被父进程 pipe）不能弹交互。
- 工程是 ESM + commander，禁止引入 CommonJS-only 的依赖。

## Goals / Non-Goals

**Goals:**
- 不传 client 且 TTY → 弹 checkbox（空格选、回车确认）多选客户端。
- 命令行接受可变长 client 列表：`install claude-code codex`。
- 一次 install 多家时，PAT 仅输入/读取一次并复用。
- 任意一家失败时跳过继续，最后汇总报告，整体 exit code 为非 0。
- `--dry-run` 在多 client 下逐家 dry-run。
- 所有改动可被现有 vitest 单测覆盖（含 mock TTY、mock prompt）。

**Non-Goals:**
- 不引入"全选 / 全清除"快捷键以外的高级选择器特性（如分组、搜索、记忆上次选择）。
- 不修改 adapter 接口（`ClientAdapter` / `TapdServerEntry` / `buildTapdEntry` 不动）。
- 不改 PAT 输入机制本身（继续走 `promptToken` / env / `--token`）。
- 不改 MCP server 运行时行为。
- 不改备份与 atomic 写入策略。

## Decisions

### D1 — 选用 `@inquirer/checkbox` 作为多选器

**选择**：在 `dependencies` 添加 `@inquirer/checkbox`。

**理由**：
- 官方维护、活跃、纯 ESM、按需引入（不像旧 `inquirer` 整包拖入），符合工程的 ESM-only 约束。
- API 直观（`await checkbox({ message, choices })`），落地代码 < 30 行。
- 自带 TTY 探测；非 TTY 时其 `Promise` 会 reject，配合我们前置的 `process.stdin.isTTY` 判断双保险。

**备选**：
- `prompts`：单包、轻量，但维护频次较低，且 ESM 兼容历史上有过坑。
- `enquirer`：功能丰富但活跃度下滑。
- 自撸：复用 readline 自己渲染 UI，维护成本远高于收益。

### D2 — `<client>` 升级为可变长可选 `[clients...]`

**选择**：commander variadic 可选位置参数。

**理由**：
- commander 原生支持，零额外依赖。
- 同时覆盖三种场景：零参（→ 交互）、单参（→ 兼容旧用法）、多参（→ 新用法）。
- 命令行解析阶段就能完成校验（每个 token 必须在 `SUPPORTED_CLIENTS` 内），错误信息清晰。

**备选**：
- 保留 `<client>` 必填 + 引入 `--clients a,b`：CLI 风格分裂、解析逻辑两条路、用户难记。
- 保留 `<client>` 必填 + 多次 `--client a --client b`：commander 支持但语义重，比 variadic 啰嗦。

### D3 — 交互��口的触发规则

**选择**：

| `clients.length` | `process.stdin.isTTY` | `process.stdout.isTTY` | 行为 |
|---|---|---|---|
| ≥ 1 | 任意 | 任意 | 跳过交互，按列表顺序逐家安装 |
| 0 | true | true | 弹 checkbox 多选 |
| 0 | false **或** stdout 非 TTY | — | 报错退出，提示用法（保护 CI） |

**理由**：
- 必须 stdin **和** stdout 都是 TTY 才弹 prompt，避免被 pipe 时 UI 错乱。
- 报错信息要明确给出"请显式传 client 或在 TTY 下运行"。

**备选**：
- 仅判 stdin TTY：实测 stdout 被重定向时 `@inquirer` 会渲染异常，不取。
- 用 `--interactive` 显式开关：增加用户负担，零参 TTY 场景的体验反而退化。

### D4 — PAT 共享策略

**选择**：在 `runInstall` 入口、进入循环之前**只解析一次** PAT，传入循环。`opts.tokenOverride` / `TAPD_TOKEN` env 优先级不变。

**实现要点**：
- 把 `runInstall(opts: RunInstallOptions)` 内部对 `promptToken` 的调用从 adapter 循环外提取出来，得到一次性的 `token` 字符串。
- 现有 `tapdEnv` 构造逻辑（`{ TAPD_TOKEN, TAPD_LOG_LEVEL: 'info' }`）保持不变，循环内每家复用同一份 `tapdEnv`。

**理由**：
- 用户体验（避免反复粘贴 PAT）。
- 安全/一致性（同一会话装多家时不应出现不同 token）。

**备选**：每家分别问。被否，理由如上。

### D5 — 失败处理与汇总

**选择**：
- 循环单 try/catch 包裹每�� adapter 的 `read → merge → write` 路径。
- 每家产出一条 `PerClientResult { client, outcome: 'wrote' | 'noop' | 'dry-run' | 'failed', path, backup?, error? }`。
- 循环结束后输出汇总：`✔ claude-code`/`= codex (no-op)`/`✗ opencode (<reason>)` 三段式。
- 整体 exit code：任一 `failed` 即为 1，其余为 0。

**理由**：
- 用户最痛的不是"装失败"，而是"前面装好的也跟着回滚或被中断"。跳过继续 + 汇总最直观。
- 单家失败不污染另一家：每家 adapter 自己负责备份与 atomic 写入，互相隔离。

**备选**：fail-fast。被否——多家场景下中断成本太高，与 D4 的"PAT 已收"语义不符。

### D6 — `RunInstallOptions` 的签名变化与向后兼容

**选择**：
- `RunInstallOptions.client: string` → `clients: string[]`（必填，可空数组**仅在 main 里**临时；`runInstall` 进入时若为空则让 `select-clients` 模块决定走交互或报错）。
- 实际把"决定 clients 列表"这一步抽到 `runInstall` 的最前置，函数主体只接受**已确定**的非空数组，便于测试。
- 拆出 `src/installer/select-clients.ts`，导出 `resolveClients(parsedClients: string[], opts?: { isStdinTty, isStdoutTty, prompt }): Promise<string[]>`，其中 `prompt` 默认调用 `@inquirer/checkbox`，测试时可注入 fake。

**理由**：
- 把"列表来源"和"安装编排"分层，单测可独立 mock prompt。
- 测试可覆盖：变长 CLI 输入解析、无参 + TTY、无参 + 非 TTY、用户取消选择（Ctrl-C）。

### D7 — 用户在 checkbox 里不选任何项的处理

**选择**：报错退出，提示"未选择任何客户端，已退出"，exit code 1。
**理由**：和"未传任何 client 且 TTY 但用户回车不选"区分开纯属过度设计，统一按"无操作"对待，且有清楚反馈。

### D8 — 提示文案与汇总输出语言

**选择**：与现有 install 流程文案保持中文一致（README 与 commander description 已是中文）。

## Risks / Trade-offs

- **新增依赖** `@inquirer/checkbox` → 增加体积。Mitigation：仅生产依赖中加一项，按需 import；其传递依赖也是 `@inquirer/core`/`yoctocolors`，体积可控。
- **TTY 检测在 Windows 部分终端的边角情况**（如 Git Bash、ConEmu）→ 个别终端 `isTTY` 反馈不准。Mitigation：D3 同时判 stdin+stdout，且报错信息引导用户显式传 client。
- **commander variadic + `--dry-run` 的解析顺序** → 用户写 `install --dry-run claude-code codex` 时 commander 会把 `--dry-run` 视作选项（OK），但 `install claude-code --dry-run codex` 在某些 commander 版本下会把 `codex` 也当 variadic 收集（OK）。Mitigation：在 README 用法示例里推荐"选项放最后或最前"，并在测试中覆盖几种顺序。
- **跨家 PAT 复用的安全语义** → 用户主观可能希望"给 codex 装一个测试 token、给 claude-code 装生产 token"。Mitigation：本次明确不支持，文档写清楚；后续若有需求另立 change。
- **失败汇总的退出码** 改变 → 旧脚本调用 `install <client>` 出错时拿到的具体码可能从 1 变成混合。Mitigation：单家时退出码语义保持（成功 0、PAT 错 1、未识别 client 2），多家时统一"任一失败即非 0"，README 标注。

## Migration Plan

无外部数据迁移。代码层面：
1. 加依赖、加 `select-clients.ts`、改 `cli.ts`、改 `flow.ts`、改 `index.ts`。
2. 单测：变长解析、`resolveClients` 三��支、循环 + 部分失败、PAT 复用。
3. README 安装段更新，commander `--help` 自动随签名变化。
4. 不需要任何 deprecation 期：新签名是旧签名的真超集。

回滚：纯代码 revert 即可，配置文件/PAT 持久化未涉及。

## Open Questions

- 是否需要在 checkbox 里展示"已检测到的客户端"标记（比如已存在配置文件的家加一个 ✓）？本次先**不做**，保持选择器最小可用。如需后续增强，可让 adapter 实现 `detectInstalled(): Promise<boolean>` 并在 `choices` 里加 hint。
