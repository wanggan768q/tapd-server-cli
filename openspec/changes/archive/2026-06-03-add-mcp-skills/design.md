## Context

`tapd-server-cli` 当前以 MCP server 形态把 TAPD Open API 暴露为~70 个工具，靠工具名 + zod schema 描述自我介绍。在缺少使用知识沉淀的情况下：

- 模型不知道**何时该用**哪一组工具（"我的需求"该走哪些 list）。
- 模型不知道**怎样正确填字段**（status 枚举随 workspace 变；@ 语法是 `[~user]`）。
- 模型容易踩坑（关 bug、批量删除、误解工时单位）。
- 跨客户端体验不一致——Claude Code 有原生 skill 协议，Codex/Cursor/OpenCode 只能用拼接到系统提示的 markdown。

讨论阶段已经把 13 个候选 skill 削减到 MVP 的 10 个（4 共享 + 6 普通用户），管理者剧本 6 个推迟。所有"行为护栏"——禁删除、禁关闭 bug、禁普通用户创建任务、批量上限 10、确认网关——固化为 `tapd-safety-rules` 的 hard rules，且 hard rules 不可被项目覆盖。

涉及的相关历史决策：
- `~/.config/tapd-mcp/cookie` 已是现存认证持久化路径，本次不动；新增 `~/.tapd/` 作为本变更专属目录。
- `whoami` / `list_workspaces` / `users_list` 等 MCP 工具已实现，可被 server 启动期复用。
- 现有 `install` / `uninstall` 子命令保持原状，本次新增 `install-skills` / `uninstall-skills` 走独立流程。

## Goals / Non-Goals

**Goals:**

- 为 4 家客户端（Claude Code / Codex / Cursor / OpenCode）一键铺设 10 个 skill，使模型在通用提问下能自主触发并按规则执行。
- 把"识别用户"和"识别 workspace"前置——MCP server 启动即缓存，后续 skill 直接复用。
- 通过 markdown 模板 + 安装期渲染让 skill 内容与运行环境（用户/workspace）解耦，内容随 npm 包升级。
- 提供升级冲突保护：用户改过的 skill 文件 → 询问保留 / 覆盖 / diff，避免静默吃掉手改。
- 跨客户端落地策略一致：都通过自动维护的 managed block（CLAUDE.md / AGENTS.md / .cursor/rules/tapd.mdc），幂等可复跑。

**Non-Goals:**

- 不在本变更里实现管理者 skill（11–16 号），也不实现 `switch-role` 子命令。
- 不实现自动 cdb / dump 解析——`tapd-handle-bug` 仅做证据归档 + 文本分析，dump 解析交给用户在 VS GUI 完成后回贴。
- 不引入"按角色限权"的服务端机制——所有"普通用户禁止"靠 skill 文本约束模型行为，不在 MCP tool 层面拒绝。
- 不重写现有 `install` / `uninstall` 子命令；不修改 `~/.config/tapd-mcp/cookie` 既有逻辑。
- 不做对 prompts/list / resources/list 等 MCP 协议级 skill 暴露——目标客户端用 markdown 注入路径即可。

## Decisions

### 决策 1：单 capability 容纳全部，而不是拆成多个

**选择**：把 skill 内容、CLI 子命令、缓存 / 配置文件、跨客户端落地都放进新 capability `mcp-skills` 一份 spec。
**理由**：MVP 需求量适中（10 个 skill + 2 个子命令 + 2 个数据文件），需求间高度耦合（skill 内容引用 cache.json、AGENTS.md 注入 skill 路径）。拆 3 个 capability（content/installer/runtime）会让需求频繁跨文件引用，archive 时维护成本上升。  
**替代方案**：
- 拆三块：`mcp-skills-content` / `mcp-skills-installer` / `mcp-skills-runtime`。维护明确但当前体量不值得。
- 全塞进 `installer-cli`。但安装期/运行期/内容三类需求混合后单文件失焦。
**触发拆分的信号**：当 skill 数量 > 25，或新增"管理者"角色拼接逻辑时，再拆 `content` 与 `installer`。

### 决策 2：`~/.tapd/` 作为独立目录而非复用 `~/.config/tapd-mcp/`

**选择**：新建 `~/.tapd/`（用户级）和 `<proj>/.tapd/`（项目级），存 `tapd.config.json` 与 `cache.json`。
**理由**：`~/.config/tapd-mcp/` 当前定义为"持久化凭据"（cookie / token），让 `--purge` 清理时语义聚焦；本变更引入的是"配置 + 缓存"，性质不同，混在一起会让 `--purge` 决策更复杂。`~/.tapd/` 也方便项目级 `.tapd/` 对称命名。
**替代方案**：
- 沿用 `~/.config/tapd-mcp/`：`uninstall --purge` 会需要新增"是否一并清理 skill 配置"开关。
- 用 `~/.claude/tapd/`：绑死 Claude Code，与"四家客户端"的设计冲突。

### 决策 3：缓存无 TTL，错误驱动重新认证

**选择**：`~/.tapd/cache.json` 一旦写入永久使用；MCP 工具调用拿到 401/403/`unauthenticated` 时 → skill 提示用户重新认证，用户重启客户端后 server 重新探测覆盖缓存。
**理由**：TTL 方案需要后台异步刷新 + "过期但能用"的降级路径，复杂度高；身份变化的实际触发场景就是"换 PAT / cookie 过期"，错误信号本身已经是最强信号。
**替代方案**：
- 24h TTL。代码量更大，且 24h 也不解决"用户中途换账号"问题。
- 每次启动强制刷。冷启动慢，断网时 server 起不来。
**主动刷新触发点**：(a) MCP server 启动且 cache.json 不存在、(b) 用户跑 `install-skills` / `uninstall-skills`、(c) 用户跑 `tapd-server-cli login`（成功后顺带刷）。

### 决策 4：跨客户端用 managed block 注入而不是各家原生协议

**选择**：四家客户端的"系统提示文件"用同一段 `<!-- BEGIN/END tapd-server-cli skills (auto-managed) -->` 标记块统一注入；Claude Code 额外有 SKILL.md 走原生触发。
**理由**：只有 Claude Code 有真正的 skill 协议，其它三家本质都是 markdown 拼系统提示。统一用 managed block 保证：升级时识别块边界做幂等替换，不破坏用户在块外的内容。Claude Code 的 SKILL.md 是 bonus，让原生触发器更精准。
**替代方案**：
- 全文覆写客户端配置文件。会破坏用户的其它配置。
- 走 MCP prompts/list 协议。Codex / Cursor / OpenCode 对 prompts 的展示方式不一，统一性差，且需要在 server 内维护；本质是把同一份内容用两种协议给同一群模型。

### 决策 5：写操作的"确认网关"分级

**选择**：评论免确认；改状态/owner/创建/批量必须先输出 preview block 等用户回 `yes`。批量上限单次 10 条。
**理由**：评论是"加内容、不破坏"，多一轮 preview 反而拖慢；改状态/owner/创建是"改世界状态"，必须 preview。批量 10 条平衡了管理者使用效率（大于 5）和审阅可视性（小于 50）。
**替代方案**：
- 全量确认。单条评论也要 2 轮，体感差。
- 全部免确认。删除 / 关闭虽然有 hard rule 兜底，但状态错改的代价仍然真实。

### 决策 6：Skill 内容形态 = 双语 description + 英文正文

**选择**：YAML frontmatter `description` 同时写英文触发词和中文触发词；正文（工作流、代码示例、字段表）用英文。
**理由**：模型在判断"这个 skill 该不该加载"时算的是 description 与用户输入的语义相似度，纯英文 description 对中文 prompt 命中率会下降 10-30%。正文用英文是因为字段名（`current_owner` / `iteration_id`）天然就是英文，混排难看；英文工作流更短更准。
**替代方案**：
- 全中文。description 触发率高，但 TAPD 字段名混排混乱。
- 全英文。description 在中文 prompt 下漏触发。

### 决策 7：UE4 崩溃处理只做证据归档，不做 dump 解析

**选择**：`tapd-handle-bug` 在评论 / 描述里发现 UNC 路径（含 crash/dump/minidump 关键词）→ 询问用户后从网络盘拉 `UE4Minidump.dmp` + `*.log` + `CrashContext.runtime-xml` → 落到 `./.tapd-bugs/<bugID>/`，并预留 `UE4Minidump.parsed.txt` 给用户用 VS GUI 解析后回贴。
**理由**：实测验证（subagent 真实跑过 `\\10.53.0.7\gst\GST\crash\trunk\2026-03-27\1774580152\`）：
- 用户机普遍没装 cdb / WinDbg。
- 业务模块 PDB 存在于 CI 构建机，跨机器拿不到。
- 即使配齐 cdb 跑 `!analyze -v`，输出与 `Gangstar.log` 里的 raw callstack 几乎一致（都是 hex+模块名）。
- xml 已结构化包含 90% 的崩溃元数据，纯文本可读。
- VS GUI 解析路径是双击 dmp，命令行替代不了。

所以 skill 落到"把证据放好 + 抽 xml 关键字段 + 引导人工解析"，比"试图自动化 dump 解析"现实得多。
**替代方案**：
- 内置 cdb 调用 + 配置 PDB 路径。失败率极高，复杂度大，零增益。
- 提供"解析命令模板让用户自己跑"。每个项目 PDB 路径不同，模板写不准，最终用户还是回到 VS GUI。

### 决策 8：用户改动检测用 hash + .bak

**选择**：每次写 SKILL.md 时把内容的 sha256 记在 `tapd.config.json:skills[].writtenSha256`；下次写之前比对磁盘文件的 hash，不一致即"用户改过"。改过的文件升级时询问 keep/overwrite/diff，覆盖前自动写 `<file>.bak.<timestamp>`。
**理由**：hash 不依赖 mtime，在 git checkout / 同步软件里也能工作；`.bak` 是用户找回手改的兜底。
**替代方案**：
- 比对 mtime。会被 git/IDE 重写时间戳干扰。
- 在文件头嵌入 `<!-- managed: do not edit -->` 标记。用户删了就破功，且不友好。

### 决策 9：模板渲染时机在安装期而非 server 启动期

**选择**：`src/skills/*.md.tmpl` 模板里包含占位符（如 `{{identity.name}}`、`{{workspaces}}`、`{{role}}`），`install-skills` 时读 cache.json 渲染并落盘。
**理由**：识别用户 / workspace 的探测放在 server 启动期已经做了；`install-skills` 直接读 cache.json 渲染（如 cache.json 不存在则向 server 触发一次探测）。这样：
- skill 文件落盘后是静态 markdown，模型读起来稳定。
- server 不需要在每次工具调用里实时拼模板。
- 用户 PAT / workspace 改了 → 重跑 `install-skills` 即可重新渲染。
**替代方案**：
- 运行时渲染（每次 skill 加载都模板替换）。脱离 markdown 写法的纯静态优势。
- 构建时渲染（npm publish 时就敲死）。完全行不通——无法预知用户身份。

## Risks / Trade-offs

[**风险 1：hard rule 不可绕过 vs 模型仍然可能违反**] 
hard rules 写在 markdown 里，本质是行为规范，不是硬约束。模型在 jailbreak / 用户施压 / 上下文丢失时仍可能尝试违反。
**Mitigation**：
- `tapd-safety-rules` 的硬规则用最显眼的格式 + 重复多次。
- 在每个写操作 skill 开头都引用 safety-rules。
- AGENTS.md / CLAUDE.md 摘要里把 5 条硬规则原文复刻一份，确保即使 skill 没加载也有兜底。
- 长期看：可在 server 端为高危工具（`tapd_*_delete`）加 server-side feature flag 默认关闭，但本变更不做。

[**风险 2：跨客户端 AGENTS.md 注入冲突**]
用户可能已经在 AGENTS.md 里手写了 TAPD 相关内容，managed block 注入会让两份内容并存。
**Mitigation**：
- 注入前检测：若文件中已存在 `tapd` / `TAPD` 提及但**不在** managed block 内，warning 提示用户"你的 AGENTS.md 已含 TAPD 内容，managed block 仍会追加，建议手动清理重复"。
- 不主动删除用户的手写内容。

[**风险 3：UNC 路径不可达打断流程**]
评论里贴的 `\\10.53.0.7\...` 在 macOS / 不在域内的 Linux 机器上不可达。
**Mitigation**：
- skill 工作流里"拉 dmp/log/xml"是询问用户后才执行；不可达时优雅降级，仍能用 description / 评论里的文本继续 bug 分析。
- 失败信息里给出"如何挂载共享盘 / 如何在 Windows 上拷贝到本地"的指引。

[**风险 4：knownUsers 缓存陈旧导致 @ 错人**]
新人入职 / 离职后 knownUsers 没刷新，模型 @ 时找不到 / 找错。
**Mitigation**：
- 第一次 @ 新人查不到 → 调一次 `tapd_users_list` 刷新缓存。
- skill 文本里要求模型在 @ 失败时显式问用户："这个用户名我查不到，你能确认 TAPD 里的精确用户名吗？"

[**权衡：发布包体积**]
10 个 markdown + 模板 + AGENTS 注入器 + 命令处理器 ≈ +60–80KB 源码，dist 后约 +50KB。可接受。

[**权衡：cache.json 与 server 启动耦合**]
让 server 启动写 cache.json，意味着首次 `install-skills` 必须先启动过 server（或者 install-skills 自己 fallback 探测）。
**Mitigation**：`install-skills` 检测到 cache.json 不存在时，自己用 `TapdHttpClient` 跑一次 `whoami` + `list_workspaces` 写入。两条路径都能初始化缓存。

## Migration Plan

1. **删除旧 skill**（plugin 提供的 `tapd-server-cli:login/logout/update`）：
   - 在 README.md 标注 BREAKING；
   - CHANGELOG.md 写明新 skill 的等价能力位置（troubleshoot 提及登录命令，install-skills 自动维护）；
   - 不在 npm 包里打包旧 skill 文件（如果原本打包了）。
2. **发布顺序**：
   - 发布带 `install-skills` / `uninstall-skills` 的新版本。
   - 用户跑 `npm install -g tapd-server-cli@latest` 升级。
   - 用户跑 `tapd-server-cli install-skills`（首次）/ 自动检测升级冲突。
3. **回滚路径**：
   - 用户跑 `tapd-server-cli uninstall-skills` → 清理 skill 文件 + AGENTS.md managed block + tapd.config.json。
   - 旧 plugin skill 不会自动恢复，但 MCP server 的工具能力不受影响。

## Open Questions

- **Q1**：项目级安装时，`<proj>/.tapd/cache.json` 是否需要纳入 `.gitignore` 模板？倾向是。安装期由 CLI 自动写入 `.gitignore`（若未含）。
- **Q2**：`tapd-from-git-commit` 解析 `--story=1234` / `--bug=1234` 是否区分大小写？倾向不区分（`--Story=` 也认）。
- **Q3**：multi-workspace 下"安装时设默认"的 UI 是 inquirer checkbox 还是 select？倾向 select（单选），因为多 workspace 场景里默认值就是单一的"主 workspace"。
- **Q4**：UE4 崩溃归档落到项目目录 `./.tapd-bugs/<bugID>/`，多 bug 同时排查时的并发取证会不会冲突？倾向不会——目录按 bugID 隔离；但文档需提示"不要在同一 bugID 下并行跑两个分析"。

这些问题不阻塞设计，留给实现阶段在 tasks.md 里收���。
