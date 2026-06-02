## ADDED Requirements

### Requirement: MVP 范围内交付的 Skill 清单

系统 SHALL 在本次变更中交付 10 个 MCP skill，分为 4 个共享基座和 6 个普通用户剧本。每个 skill MUST 以独立 markdown 文件形式存在于 `dist/skills/<name>.md`（npm 包内），且 MUST 拥有 YAML frontmatter（含 `name` 与 `description` 字段）。

#### Scenario: 共享基座 4 个 skill 全部存在

- **WHEN** 用户安装最新版 `tapd-server-cli`
- **THEN** `dist/skills/` 目录 MUST 包含以下 4 个文件：`tapd-overview.md` / `tapd-fields-reference.md` / `tapd-troubleshoot.md` / `tapd-safety-rules.md`
- **AND** 每个文件 MUST 以 `---\nname: tapd-<...>\ndescription: |\n  ...` 起始

#### Scenario: 普通用户剧本 6 个 skill 全部存在

- **WHEN** 用户安装最新版 `tapd-server-cli`
- **THEN** `dist/skills/` 目录 MUST 包含：`tapd-my-work.md` / `tapd-implement-story.md` / `tapd-handle-bug.md` / `tapd-log-time.md` / `tapd-comment-and-mention.md` / `tapd-from-git-commit.md`

#### Scenario: 不交付管理者 skill

- **WHEN** 用户安装最新版 `tapd-server-cli`
- **THEN** `dist/skills/` 目录 MUST NOT 包含任何以下文件：`tapd-iteration-planning.md` / `tapd-iteration-review.md` / `tapd-bug-dashboard.md` / `tapd-create-task.md` / `tapd-batch-assign.md` / `tapd-release-management.md`

### Requirement: Skill description 双语触发词

每个 skill 的 frontmatter `description` 字段 MUST 同时包含英文触发词和中文触发词。英文触发词列在 `English triggers:` 标签下，中文触发词列在 `中文触发：` 标签下。

#### Scenario: 双语触发词都存在

- **WHEN** 任意 skill 文件被解析
- **THEN** `description` 字段 MUST 包含子串 `English triggers:`
- **AND** MUST 包含子串 `中文触发：`
- **AND** 两个部分各自 MUST 至少给出 3 个触发词或短语

### Requirement: tapd-safety-rules 含 5 条 hard rules

`tapd-safety-rules.md` MUST 在正文中显式声明以下 5 条 hard rules，且 MUST 标注"不可被项目配置或用户请求覆盖"：

1. 全员禁止删除任何 TAPD 条目（不调任何 `tapd_*_delete` 工具）。
2. 全员禁止把 bug 状态改为 `closed`，仅可到 `resolved`。
3. 普通用户（`role == user`）禁止调 `tapd_tasks_create`。
4. 写操作确认网关：评论可直接发；改状态 / 改 owner / 创建实体 / 批量操作必须先输出 preview block 并等待用户显式确认（`yes` / `确认` / `ok` / `go`）。
5. 单次批量写操作上限 10 条；超出 MUST 拆批。

#### Scenario: hard rules 全部出现在 skill 正文

- **WHEN** 解析 `tapd-safety-rules.md` 的正文
- **THEN** 文本 MUST 包含 `HARD-RULE-1` 至 `HARD-RULE-5` 五处标记
- **AND** MUST 包含 `cannot be overridden` 或 `不可绕过` / `不可被项目覆盖` 之类显式声明

#### Scenario: 评论免确认仍属硬规则

- **WHEN** 解析 `tapd-safety-rules.md`
- **THEN** HARD-RULE-4 MUST 显式列出"评论免 preview"作为唯一豁免项
- **AND** MUST 列出 status 改动 / owner 改动 / 创建 / 批量四类需 preview

### Requirement: 默认查询 owner = $ME

涉及"我的"语义的 skill（首先是 `tapd-my-work`）MUST 在工作流中显式说明：当用户未指定查询对象时，默认使用 `~/.tapd/cache.json` 中的 `identity.tapdUserName` 作为 `current_owner` filter；当用户明确指定他人时（如"张三的需求"）才覆盖。

#### Scenario: 默认查我

- **WHEN** 模型加载 `tapd-my-work` 后处理"看下我手头的 bug"
- **THEN** skill 文本 MUST 引导���型把 `current_owner` 设为 `$ME`（来自 cache.json）
- **AND** MUST 不主动询问"是查谁"

#### Scenario: 用户显式指定他人

- **WHEN** 模型处理"看下张三的需求"
- **THEN** skill 文本 MUST 引导模型把 `current_owner` 设为 `张三`，而非 `$ME`

### Requirement: tapd-my-work 默认状态过滤与排序

`tapd-my-work` skill 在查询 stories / bugs 时，默认 MUST 过滤掉已完成态（`status` 不等于 `resolved` / `closed` / `completed` / `已解决` / `已关闭` / `已完成` 等终态值）；结果排序 MUST 把"进行中"状态（`in_progress` / `developing` / `处理中` / `开发中`）排在最前。

#### Scenario: 默认过滤终态

- **WHEN** 用户问"看下我的需求 / bug"
- **THEN** skill 工作流 MUST 默认排除终态实体
- **AND** skill 文本 MUST 给出可识别的终态值清单（中英文均覆盖）

#### Scenario: 用户要求包含已完成

- **WHEN** 用户问"包括已完成的也列一下"
- **THEN** skill 文本 MUST 引导模型放开终态过滤

#### Scenario: 进行中排前

- **WHEN** 列表里同时含"进行中""未开始""已暂停"
- **THEN** skill 文本 MUST 引导模型把"进行中"排在结果最前

### Requirement: tapd-implement-story 接活前评估

`tapd-implement-story` skill 工作流 MUST 包含 4 个阶段：(1) 拉全信息（story 详情 + 评论 + 附件）；(2) 信息充足度评估（业务背景、验收标准、输入输出、边界、评论关注项、关联实体六个维度）；(3) 输出"接活报告"含缺失信息清单；(4) 仅当信息充足时给出**业务步骤建议，且 MUST NOT 涉及代码实现**。

评论关注项识别 MUST 至少覆盖：`@当前用户`、关键词（"重要" / "注意" / "改了" / "推翻" / "依赖" / "阻塞" / "等"）、含附件的评论。

信息不足时 MUST 仅提示用户"缺什么"，MUST NOT 主动写评论询问需求方，MUST NOT 阻断用户决定。

#### Scenario: 4 阶段在 skill 正文

- **WHEN** 解析 `tapd-implement-story.md`
- **THEN** 正文 MUST 显式标注 4 个 Phase
- **AND** 6 个评估维度 MUST 全部出现

#### Scenario: 信息不足只提示

- **WHEN** 模型加载 skill 后判断信息不足
- **THEN** skill 文本 MUST 引导模型仅"列缺失项 + 建议补充方式"
- **AND** MUST NOT 引导模型自动调 `tapd_comments_create` 写询问评论

#### Scenario: 不碰代码

- **WHEN** 解析 skill 第 4 阶段
- **THEN** 正文 MUST 显式声明仅给业务步骤
- **AND** MUST 显式声明不涉及代码文件 / 测试 / 风险评估等

### Requirement: tapd-handle-bug 取证 + 分析 + 修复建议

`tapd-handle-bug` skill 工作流 MUST 包含 5 个阶段：(1) 拉 bug 详情 + 评论 + 附件清单；(2) 取证 — 下载附件并按规则分类落到 `./.tapd-bugs/<bugID>/`；(2.5) 取证 — 解析评论 / 描述里的 UNC 崩溃归档路径，询问用户后拉取 `UE4Minidump.dmp` + `*.log` + `CrashContext.runtime-xml`；(3) 信息充足度评估；(4) bug 分析；(5) 修复建议（仅业务/逻辑层，**MUST NOT 涉及代码**）。

#### Scenario: 落地目录结构

- **WHEN** 解析 `tapd-handle-bug.md`
- **THEN** 正文 MUST 给出落地目录结构：
  - `./.tapd-bugs/<bugID>/description.md`
  - `./.tapd-bugs/<bugID>/stack/`（含 `from-description.txt` / `from-comment-N.txt` / `crash-summary.md` / `critical-error.txt` / `UE4Minidump.dmp` / `UE4Minidump.parsed.txt` / `HOW-TO-PARSE.md`）
  - `./.tapd-bugs/<bugID>/logs/`
  - `./.tapd-bugs/<bugID>/other-attachments/`

#### Scenario: 附件分类规则

- **WHEN** 解析 skill 第 2 阶段
- **THEN** 正文 MUST 列出按扩展名 + 文件名关键词分类的具体规则：
  - `*.log` / `*.txt` 或文件名含 `log` / `trace` / `console` → `logs/`
  - `*.dmp` 或描述/评论里的堆栈文本 → `stack/`
  - 其它 → `other-attachments/`
- **AND** MUST 列出压缩包解压规则（`.zip` / `.tar.gz` / `.tgz` 必解，`.rar` / `.7z` 视系统工具尝试解，失败不阻断流程）

#### Scenario: UNC 路径识别

- **WHEN** 解析 skill 第 2.5 阶段
- **THEN** 正文 MUST 描述启发式识别规则：路径形如 `\\<host>\<share>\...` 或 `//10.x.x.x/...`，且路径关键词含 `crash` / `dump` / `minidump` / `UE4` / 形如年月日的数字
- **AND** MUST 要求识别后**询问用户确认**才拉取（不自动拉）
- **AND** MUST 限定提取范围为 `UE4Minidump.dmp` + 同目录所有 `.log` / `.txt`，不递归整个目录

#### Scenario: CrashContext.runtime-xml 抽取

- **WHEN** 取证阶段拿到 `CrashContext.runtime-xml`
- **THEN** skill 文本 MUST 引导抽取以下字段写入 `crash-summary.md`：`CrashType` / `CrashGUID` / `ErrorMessage` / `EngineVersion` / `GameName` / `Symbols` / 机器/CPU/GPU 指纹 / 源文件 / 源行号
- **AND** CrashGUID MUST 作为指纹显示，提示用户"可与历史 bug 比对去重"

#### Scenario: 不自动 cdb 解析

- **WHEN** 解析 skill 修复建议阶段
- **THEN** 正文 MUST NOT 包含调用 `cdb` / `windbg` 的命令
- **AND** MUST 引导用户用 VS GUI 双击 dmp 解析后把结果粘到 `UE4Minidump.parsed.txt`
- **AND** skill 文本 MUST 描述检测 `UE4Minidump.parsed.txt` 是否有内容的逻辑：有则用解析后的堆栈分析，无则用 `critical-error.txt` 的 raw callstack 给粗结论
- **AND** MUST 显式说明 raw callstack 分析时不阻塞流程，并提示"如需更精准请用 VS 解析后回贴"

#### Scenario: 多日志策略

- **WHEN** UNC 路径下存在主 log + `today_logs/*-backup-*.log`
- **THEN** skill 文本 MUST 限定仅拉主 log，不主动拉 backup
- **AND** MUST 在 `crash-summary.md` 里保留原 UNC 路径，方便用户手动取其它日志

#### Scenario: 修复建议不碰代码

- **WHEN** 解析第 5 阶段
- **THEN** 正文 MUST 显式声明只给业务/逻辑层建议
- **AND** MUST NOT 引导模型读代码文件 / 给修改示例

### Requirement: tapd-log-time 单点记录

`tapd-log-time` skill 工作流 MUST 仅做"按用户描述记一条 timesheet"。owner 默认 `$ME`；date 默认今天；必须关联 `story_id` / `bug_id` / `task_id` 之一。skill 文本 MUST NOT 包含批量补录、自动汇总、自动关联上下文实体等扩展能力。

#### Scenario: 默认值

- **WHEN** 解析 `tapd-log-time.md`
- **THEN** 正文 MUST 显式列出 `owner = $ME`、`date = today`
- **AND** MUST 强调必须显式带上一个关联实体 ID

#### Scenario: 不做扩展

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST NOT 包含批量补录工作流
- **AND** MUST NOT 包含周报/日报自动汇总逻辑

### Requirement: tapd-comment-and-mention 单点评论 + @ 缓存

`tapd-comment-and-mention` skill MUST 提供把"自然语言评论 + @某人"映射为 `tapd_comments_create` 调用的单点工作流。@ 语法 MUST 翻译为 TAPD 自家格式 `[~user_name]`。第一次 @ 某人时 MUST 调 `tapd_users_list` 查询用户名并把结果缓存到 `~/.tapd/cache.json:knownUsers`，后续直接复用；查不到时 MUST 让用户手动给精确用户名。

按 hard rules，评论 MUST 直接发出（无需 preview 网关）。

#### Scenario: @ 语法翻译

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST 给出"@张三 → `[~zhangsan]`"格式映射示例

#### Scenario: knownUsers 缓存

- **WHEN** 第一次 @ 某用户名
- **THEN** skill 文本 MUST 引导模型先查 `cache.json:knownUsers`，未命中再调 `tapd_users_list`
- **AND** MUST 引导模型把命中结果写回 `knownUsers`

#### Scenario: 查不到时让用户给

- **WHEN** `tapd_users_list` 也未返回匹配的用户
- **THEN** skill 文本 MUST 引导模型停下来询问用户精确用户名，MUST NOT 猜测

#### Scenario: 评论免 preview

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST 显式说明评论是 hard-rule-4 中"无需 preview"的唯一一类

### Requirement: tapd-from-git-commit 解析约束

`tapd-from-git-commit` skill MUST 仅解析 commit message 中的 `--story=<id>` / `--bug=<id>` 两种引用格式（大小写不敏感），MUST NOT 解析 `#1234` / `TAPD-1234` / `fix #` 等其它格式。MUST 仅扫当前分支最近 N 条 commit（N 默认 10，用户可改）。MUST 在写评论前输出 preview 列表让用户选 `[a] 全发 / [s] 挑选 / [n] 取消`。

写评论本身复用 `tapd-comment-and-mention`（即免 preview，发完报告路径）。

#### Scenario: 仅识别两种格式

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST 列出仅支持 `--story=<id>` / `--bug=<id>` 两种格式
- **AND** MUST 显式声明不识别 `#` / `TAPD-` 等其它格式

#### Scenario: 仅当前分支

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST 显式说明只扫当前分支
- **AND** MUST NOT 包含跨分支扫描指引

#### Scenario: preview 三选项

- **WHEN** 模型解析出多条引用
- **THEN** skill 文本 MUST 引导模型输出 `[a] 全发 / [s] 挑选 / [n] 取消` 三选项

#### Scenario: 评论模板

- **WHEN** 解析 skill 正文
- **THEN** 正文 MUST 给出评论模板：包含 `[from commit <abbrev>]`、commit subject、author、SHA、commit body（如有）

### Requirement: install-skills 子命令

CLI MUST 提供 `tapd-server-cli install-skills` 子命令，用于把 skill 文件 + AGENTS.md managed block + 配置写入用户机器。

子命令必须支持的位置参数与选项：
- 位置参数 `<client...>`：可变长，取值集合 `claude-code` / `codex` / `cursor` / `opencode`；零参 + TTY 时进入交互式 checkbox 多选；零参 + 非 TTY 时退出码 2 报错。
- `--scope <user|project>`：默认值由交互或当前目录是否在 git 仓库决定；非交互模式下 MUST 显式指定。
- `--dry-run`：不写文件，输出将要做的事情。
- 暂不暴露 `--role` 参数。

#### Scenario: 显式多客户端 + 用户级

- **WHEN** 用户执行 `tapd-server-cli install-skills claude-code codex --scope user`
- **THEN** CLI MUST 把 10 个 skill 文件写到 `~/.claude/skills/tapd-*/SKILL.md`（claude-code 路径）
- **AND** MUST 注入 managed block 到 `~/.claude/CLAUDE.md` 与 `~/.codex/AGENTS.md`
- **AND** MUST 写入 `~/.tapd/tapd.config.json` 与 `~/.tapd/cache.json`（cache 来自 server 探测或 install-skills 自己探测）

#### Scenario: 项目级安装

- **WHEN** 用户执行 `tapd-server-cli install-skills claude-code --scope project`（cwd 在 git 仓库根）
- **THEN** CLI MUST 写到 `<proj>/.claude/skills/`、`<proj>/CLAUDE.md`、`<proj>/.tapd/tapd.config.json`、`<proj>/.tapd/cache.json`
- **AND** MUST 把 `.tapd/` 目录加入 `<proj>/.gitignore`（若该文件存在且未含此条目）

#### Scenario: 零参 TTY 进入交互

- **WHEN** 用户在 TTY 终端执行 `tapd-server-cli install-skills`
- **THEN** CLI MUST 先弹 `<scope>` 选择（用户级 / 项目级）
- **AND** MUST 弹客户端 checkbox 多选
- **AND** 多 workspace 时 MUST 弹"默认 workspace"选择（含"始终询问"选项）

#### Scenario: 零参非 TTY 报错

- **WHEN** `process.stdin.isTTY` 为 false 或 `process.stdout.isTTY` 为 false
- **AND** 用户执行 `tapd-server-cli install-skills`（无任何参数）
- **THEN** CLI MUST 退出码 2
- **AND** stderr MUST 给出非交互环境下必须显式指定 scope 和 client 列表的指引

#### Scenario: --dry-run 不写文件

- **WHEN** 用户执行 `tapd-server-cli install-skills claude-code --dry-run`
- **THEN** MUST NOT 写任何文件
- **AND** stdout MUST 列出每一个将要写入的目标路径与摘要

#### Scenario: 不暴露 --role

- **WHEN** 用户执行 `tapd-server-cli install-skills --help`
- **THEN** 输出 MUST NOT 包含 `--role` 选项
- **AND** stdout 提示 MUST 说明本版本只交付普通用户 + 共享共 10 个 skill

### Requirement: install-skills 模板渲染

`install-skills` 写 SKILL.md 时 MUST 把模板里的占位符替换为运行时值。占位符 MUST 至少支持：
- `{{identity.tapdUserName}}` / `{{identity.tapdUserId}}`：来自 cache.json
- `{{workspaces}}`：来自 cache.json，渲染为 markdown 列表
- `{{defaultWorkspaceId}}`：用户在交互中选定的默认 workspace
- `{{role}}`：本 MVP 固定写 `user`
- `{{installedAt}}`：ISO 8601 时间字符串

cache.json 不存在时 MUST fallback 调 `whoami` + `list_workspaces` 探测后写入。

#### Scenario: 占位符全部被替换

- **WHEN** 模板含 `{{identity.tapdUserName}}` 且 cache.json 中 `identity.tapdUserName == "张三"`
- **THEN** 渲染后的 SKILL.md MUST 含字符串 `张三`
- **AND** MUST NOT 含字符串 `{{identity.tapdUserName}}`

#### Scenario: cache.json 缺失时 fallback 探测

- **WHEN** `~/.tapd/cache.json` 不存在
- **AND** 用户跑 `install-skills`
- **THEN** CLI MUST 用现有 `TAPD_TOKEN` 创建 `TapdHttpClient` 跑一次 `whoami` + `list_workspaces`
- **AND** MUST 把结果写入 cache.json 后再渲染模板

#### Scenario: 探测失败时报错退出

- **WHEN** fallback 探测时 `whoami` 返回 401
- **THEN** install-skills MUST 退出码 1，stderr 给出"PAT 无效，无法初始化 cache.json"提示
- **AND** MUST NOT 写任何 skill 文件 / AGENTS.md / config.json

### Requirement: install-skills 升级冲突处理

当 SKILL.md 已存在于目标路径，`install-skills` MUST 比对当前磁盘内容的 sha256 与 `tapd.config.json:skills[].writtenSha256`：
- 一致：视为"未被用户修改"，直接覆盖。
- 不一致：视为"用户改过"，**MUST 询问** `keep` / `overwrite` / `show diff`；选 `overwrite` 前 MUST 把原文件备份到 `<file>.bak.<timestamp>`。
- 非交互模式（`--yes` 或 `process.stdin.isTTY === false`）下默认 `keep` 改过的文件，且 stdout MUST 输出"以下文件被跳过: …"清单。

#### Scenario: 干净覆盖

- **WHEN** 磁盘上 `~/.claude/skills/tapd-overview/SKILL.md` 的 hash 等于 config.json 记录值
- **AND** 用户跑 `install-skills`
- **THEN** CLI MUST 直接覆写文件
- **AND** MUST NOT 创建 .bak

#### Scenario: 用户改过 + 交互式选 overwrite

- **WHEN** 磁盘 hash 不等于 config.json 记录值
- **AND** 用户在交互中选 `overwrite`
- **THEN** CLI MUST 先创建 `<file>.bak.<timestamp>`
- **AND** 然后覆写新内容
- **AND** 写完后 MUST 更新 config.json 中该 skill 的 `writtenSha256`

#### Scenario: 用户改过 + 选 keep

- **WHEN** 用户选 `keep`
- **THEN** CLI MUST 不写文件
- **AND** MUST 在汇总输出里标注该 skill 被用户保留
- **AND** config.json 中该 skill 的 `writtenSha256` MUST 保持不变（仍指向上次写入版本）

#### Scenario: 非交互默认 keep

- **WHEN** 在 CI 或非 TTY 环境下跑 `install-skills`，磁盘有 N 个改过的文件
- **THEN** CLI MUST 跳过改过的文件
- **AND** stdout MUST 输出"已跳过 N 个被本地修改的 skill 文件"清单
- **AND** 退出码 MUST 仍是 0

### Requirement: install-skills 跨客户端落地

`install-skills` MUST 按 4 家客户端的不同协议落地内容：

| 客户端 | 用户级目标 | 项目级目标 |
|---|---|---|
| Claude Code | `~/.claude/skills/tapd-*/SKILL.md` + `~/.claude/CLAUDE.md` managed block | `<proj>/.claude/skills/tapd-*/SKILL.md` + `<proj>/CLAUDE.md` managed block |
| Codex | `~/.codex/AGENTS.md` managed block（仅 block；skill 内容内嵌） | `<proj>/AGENTS.md` managed block |
| OpenCode | `~/.config/opencode/AGENTS.md` managed block | `<proj>/AGENTS.md` managed block（与 Codex 共享 AGENTS.md 时合并） |
| Cursor | `~/.cursor/rules/tapd.mdc` 全文写 | `<proj>/.cursor/rules/tapd.mdc` 全文写 |

Managed block 标记 MUST 是：
```
<!-- BEGIN tapd-server-cli skills (auto-managed) -->
...
<!-- END tapd-server-cli skills -->
```

#### Scenario: Claude Code 写 SKILL.md + CLAUDE.md

- **WHEN** 安装目标含 `claude-code`
- **THEN** CLI MUST 把每个 skill 写入对应 `tapd-<name>/SKILL.md` 文件
- **AND** MUST 在 CLAUDE.md 注入 managed block，含：身份、role、客户端清单、5 条 hard rules 摘要、已安装 skill 列表（仅名字）

#### Scenario: Codex / OpenCode 内嵌 skill 内容

- **WHEN** 安装目标含 `codex` 或 `opencode`
- **THEN** CLI MUST 在 AGENTS.md 的 managed block 内**内嵌**所有 10 个 skill 的完整 markdown（因为这两家无原生 skill 协议）
- **AND** managed block 顶部 MUST 含"硬规则摘要"段，便于即使 skill 内容被截断也有兜底

#### Scenario: Cursor 全文写 .mdc

- **WHEN** 安装目标含 `cursor`
- **THEN** CLI MUST 把"硬规则摘要 + 10 个 skill 全文"写入 `.cursor/rules/tapd.mdc`
- **AND** Cursor rules 的 frontmatter MUST 设为 `alwaysApply: false`、`description` 含双语触发词

#### Scenario: 项目级 AGENTS.md 共享

- **WHEN** 同一项目同时安装 Codex 和 OpenCode
- **THEN** CLI MUST 写入同一份 `<proj>/AGENTS.md` 的同一 managed block
- **AND** 已有 block 时 MUST 仅替换块内内容，不重复创建

#### Scenario: Managed block 幂等

- **WHEN** 用户连续两次跑 `install-skills` 且 skill 内容未升级
- **THEN** AGENTS.md / CLAUDE.md / .mdc 的内容 MUST 完全一致（hash 相等）
- **AND** managed block 的位置 MUST 不变（不会每次追加到末尾）

### Requirement: uninstall-skills 子命令

CLI MUST 提供 `tapd-server-cli uninstall-skills` 子命令，反向清理 install-skills 的所有产物。位置参数与 `install-skills` 对称（接受 `<client...>`，零参 TTY 进交互），但 MUST NOT 收集 PAT，MUST NOT 触发任何 TAPD API 调用。

uninstall 的清理范围（默认）：
1. 删除 SKILL.md 文件（Claude Code 路径下）。
2. 移除各客户端 AGENTS.md / CLAUDE.md / .mdc 中的 managed block（保留块外内容原样）。
3. 删除 `~/.tapd/tapd.config.json`（或项目级对应文件）。

cache.json 是否也清理 MUST 通过 `--purge-cache` 选项控制（默认不清，因为 server 启动时还会用）。

#### Scenario: 清理三类产物

- **WHEN** 用户跑 `tapd-server-cli uninstall-skills claude-code codex`
- **THEN** SKILL.md 文件 MUST 被删除（claude-code 部分）
- **AND** CLAUDE.md / AGENTS.md 中的 managed block MUST 被移除
- **AND** `~/.tapd/tapd.config.json` MUST 被删除

#### Scenario: cache.json 默认保留

- **WHEN** 未传 `--purge-cache`
- **THEN** `~/.tapd/cache.json` MUST 保持不变
- **AND** 汇总 stdout MUST 提示用户"如需一并清理 cache 请加 --purge-cache"

#### Scenario: --purge-cache 一并清理

- **WHEN** 用户传 `--purge-cache`
- **THEN** `~/.tapd/cache.json` MUST 被删除
- **AND** `~/.tapd/` 目录若变空 MUST NOT 被删除（保守，避免误碰用户在该目录下的其它文件）

#### Scenario: 用户改过的 SKILL.md 自动备份

- **WHEN** uninstall 时检测到 `~/.claude/skills/tapd-overview/SKILL.md` 的 hash 不等于 config.json 记录
- **THEN** CLI MUST 把文件移动到 `<file>.bak.<timestamp>`，而非直接删除
- **AND** 汇总 stdout MUST 提示"以下文件被改过，已备份到 .bak"

#### Scenario: managed block 不存在时 noop

- **WHEN** AGENTS.md 中不含 managed block 标记
- **THEN** CLI MUST NOT 报错
- **AND** 汇总 outcome MUST 是该家 noop

#### Scenario: 不收 PAT

- **WHEN** 用户跑 `uninstall-skills` 且 `TAPD_TOKEN` 环境变量未设置
- **THEN** CLI MUST NOT 提示 PAT 输入
- **AND** MUST NOT 因缺 PAT 退出
- **AND** MUST NOT 调任何 TAPD API

### Requirement: 不交付 switch-role

本变更 MUST NOT 实现 `switch-role` 子命令。CLI 即使解析到 `tapd-server-cli switch-role` 也 MUST 输出"该子命令在管理者 skill 上线时再启用"提示并退出码 2。

#### Scenario: switch-role 当前不可用

- **WHEN** 用户执行 `tapd-server-cli switch-role admin`
- **THEN** CLI MUST 退出码 2
- **AND** stderr MUST 提示"管理者 skill 上线后此命令��用"

### Requirement: tapd.config.json schema

`~/.tapd/tapd.config.json`（或项目级 `<proj>/.tapd/tapd.config.json`）MUST 是 UTF-8 JSON，schema 至少包含以下字段：

```jsonc
{
  "schemaVersion": 1,
  "version": "<package version>",   // 来自写入时的 tapd-server-cli 版本
  "installedAt": "<ISO 8601>",
  "scope": "user" | "project",
  "role": "user",                    // MVP 阶段固定
  "clients": ["claude-code", "codex", "cursor", "opencode"],  // 已安装的客户端子集
  "skills": [
    {
      "name": "tapd-overview",
      "version": "<package version>",
      "writtenSha256": "<sha256>",
      "path": "<absolute path>"
    }
  ]
}
```

#### Scenario: 必选字段全在

- **WHEN** install-skills 写入 tapd.config.json
- **THEN** 文件 MUST 含 `schemaVersion` / `version` / `installedAt` / `scope` / `role` / `clients` / `skills` 全部字段
- **AND** `skills` 数组每一项 MUST 含 `name` / `version` / `writtenSha256` / `path`

#### Scenario: schemaVersion 升级前向兼容

- **WHEN** install-skills 读到 `schemaVersion` 大于自身代码支持的版本
- **THEN** CLI MUST 退出码 1
- **AND** stderr 给出"配置文件版本过新，请升级 tapd-server-cli"

### Requirement: cache.json schema 与启动期写入

MCP server 启动 MUST 在配置/认证完成后异步探测 `whoami` + `list_workspaces`，并把结果写入 `~/.tapd/cache.json`。schema 至少包含：

```jsonc
{
  "schemaVersion": 1,
  "writtenAt": "<ISO 8601>",
  "identity": { "tapdUserName": "...", "tapdUserId": "...", "tapdEmail"?: "..." },
  "workspaces": [{ "id": "...", "name": "...", "role"?: "..." }],
  "lastSelectedWorkspace"?: "<ws id>",
  "knownUsers"?: [{ "tapdUserName": "...", "tapdUserId": "..." }]
}
```

cache.json 写入 MUST NOT 阻塞 MCP 协议握手；写入失败 MUST 仅 warn 日志，不影响 server 可用性。

#### Scenario: 启动期写入

- **WHEN** server 启动且 `whoami` / `list_workspaces` 都成功返回
- **THEN** `~/.tapd/cache.json` MUST 被写入或更新
- **AND** 写入 MUST 在 stdio 握手就绪后异步进行，不延迟 server 响应

#### Scenario: 探测失败不影响 server

- **WHEN** server 启动期 `whoami` 返回 401
- **THEN** server MUST 仍正常注册工具（与现有行为一致）
- **AND** cache.json MUST NOT 被写入（保留旧版本若存在）
- **AND** stderr 日志 MUST 含 `cache_probe_failed` 标记

#### Scenario: knownUsers 增量写入

- **WHEN** 模型通过 skill 第一次 @ 某用户名并查到 user
- **THEN** server 端的 comment 工具 MUST 顺带把该 user 写入 `cache.json:knownUsers`（去重）
- **AND** 写入 MUST 是原子的（tmp + rename）

### Requirement: 401/403 错误驱动重新认证

无论 install-skills、cache.json 探测，还是模型通过 skill 调 TAPD 工具，遇到 401 / 403 / `unauthenticated` 时 MUST 走"提示用户重新认证"路径，**MUST NOT** 自动重试同一次调用。

#### Scenario: skill 工具调用失败

- **WHEN** 模型加载 `tapd-troubleshoot` 后处理一次 401
- **THEN** skill 文本 MUST 引导模型告诉用户：
  1. PAT 可能过期或失效
  2. 重新生成 PAT 后更新 MCP 配置中的 `TAPD_TOKEN`
  3. 重启 MCP 客户端让 server 重新探测 cache.json
- **AND** MUST NOT 自动重试

#### Scenario: cookie 过期专用路径

- **WHEN** 错误来自 `tapd_attachments_download` 且响应里含 `unauthenticated` / cookie 相关字样
- **THEN** skill 文本 MUST 提示用户跑 `npx tapd-server-cli login`

### Requirement: 删除旧 plugin 级 skill

本变更 MUST NOT 在 npm 包中打包以下旧 skill（如果之前有）：`tapd-server-cli:login` / `tapd-server-cli:logout` / `tapd-server-cli:update`。这三者的等价能力 MUST 在新 skill 中提示用户用对应 CLI 命令完成（`tapd-troubleshoot` 提及登录 / 登出；CHANGELOG 提及 update）。

#### Scenario: 旧 skill 不在包里

- **WHEN** 用户安装最新版 `tapd-server-cli` 并运行 `npm pack`
- **THEN** 包内 `dist/skills/` MUST NOT 包含 `tapd-server-cli-login.md` / `tapd-server-cli-logout.md` / `tapd-server-cli-update.md` 之类文件

#### Scenario: 等价能力的引导

- **WHEN** 解析 `tapd-troubleshoot.md`
- **THEN** 正文 MUST 包含 `npx tapd-server-cli login` / `logout` 命令引导
- **AND** CHANGELOG.md MUST 引用 `npx tapd-server-cli update` 作为版本检查命令
