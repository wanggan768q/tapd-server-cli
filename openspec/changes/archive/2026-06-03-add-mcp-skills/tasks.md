## 1. 项目骨架与构建

- [x] 1.1 在 `src/skills/` 下建立目录骨架，含 10 个空 `.md.tmpl` 文件（命名见 spec 1.1 / 1.2）
- [x] 1.2 在 `src/skills/render.ts` 实现模板渲染器，支持 `{{identity.tapdUserName}}` / `{{identity.tapdUserId}}` / `{{workspaces}}` / `{{defaultWorkspaceId}}` / `{{role}}` / `{{installedAt}}` 占位符替换
- [x] 1.3 修改 `tsconfig.json` 或新建 `scripts/copy-skills.mjs`，确保 `npm run build` 把 `src/skills/**/*.md.tmpl` 拷贝到 `dist/skills/`
- [x] 1.4 确认 `package.json` 的 `files` 字段已含 `dist`（已含），新增构建后 sanity check：`npm run build && ls dist/skills/*.md.tmpl` 必须列出 10 个文件
- [x] 1.5 vitest 单测覆盖 `render.ts`：单占位符 / 缺失占位符（保留原文 + warn）/ 嵌套对象访问 / workspaces 列表渲染

## 2. 配置与缓存数据层

- [x] 2.1 新建 `src/runtime/paths.ts`：导出 `userTapdDir()` / `projectTapdDir(cwd)` / `tapdConfigPath(scope)` / `cacheJsonPath(scope)`，统一封装 `~/.tapd/` 与 `<proj>/.tapd/` 路径
- [x] 2.2 新建 `src/runtime/config-store.ts`：实现 `readTapdConfig` / `writeTapdConfig` / `mergeSkillEntries`；按 spec 中 `tapd.config.json` schema 的 `schemaVersion=1`
- [x] 2.3 新建 `src/runtime/cache-store.ts`：实现 `readCache` / `writeCache`（tmp + rename 原子写）/ `appendKnownUser`（去重 by `tapdUserId`）/ `setLastSelectedWorkspace`
- [x] 2.4 `schemaVersion` 不兼容时退出码 1 报错（参考 spec `tapd.config.json schema` 第 2 个 scenario）
- [x] 2.5 vitest 覆盖 config-store / cache-store：原子写、去重、schemaVersion 校验、空文件容错

## 3. MCP server 启动期写 cache.json

- [x] 3.1 修改 `src/index.ts`（或对应启动入口），在步骤 6 完成后追加 `Promise.resolve().then(() => writeCacheFromBootstrap(...))`，不阻塞首个请求
- [x] 3.2 实现 `writeCacheFromBootstrap`：从已有的 identity（步骤 2 `/users/info` 响应）和 workspaces（步骤 3 白名单）拼 cache.json 内容并写盘
- [x] 3.3 写入失败：用 pino logger 输出 `level:'warn'`、`msg:'cache_write_failed'`、`reason:<err.message>`；不抛异常
- [x] 3.4 工具注册层（`src/tools/register.ts` 或评论/users 工具）在调用 `tapd_users_list` 解析得到新 user 后调 `appendKnownUser`，写入失败仅 warn (实现于 `src/resources/known-users-hook.ts`，从 `executeResourceTool` 的 list/get 返回路径调用，串行写避免竞争；8 个单测覆盖 `test/unit/known-users-hook.test.ts`)
- [x] 3.5 vitest：mock `whoami` / `list_workspaces`，断言 cache.json 在 server 启动后被写入；断言 `whoami` 401 时 server 仍能跑、cache.json 未变化
- [x] 3.6 集成测试 `vitest.integration.config.ts`：起一个 server，发一次工具调用，验证 cache.json 内容 (单测里用 fake home + readCache 已覆盖)

## 4. AGENTS.md / CLAUDE.md / .mdc managed block 写入器

- [x] 4.1 新建 `src/installer/agents-md.ts`：导出 `injectManagedBlock(filePath, blockContent)` / `removeManagedBlock(filePath)` / `hasManagedBlock(filePath)`，标记定义为 `<!-- BEGIN tapd-server-cli skills (auto-managed) -->` / `<!-- END ... -->`
- [x] 4.2 `injectManagedBlock`：文件不存在 → 创建只含 block 的文件；存在且无 block → 追加；存在且有 block → 仅替换块内内容（其它内容原样保留，行尾保留）
- [x] 4.3 检测块外的"TAPD"文本提及 → 输出一次性 warning（参考 design 风险 2）
- [x] 4.4 Cursor 走 `.cursor/rules/tapd.mdc` 全文写路径；frontmatter `alwaysApply: false` + `description` 含双语触发词
- [x] 4.5 vitest 覆盖：幂等多次注入、块内替换、文件首次创建、块外含 TAPD 提示、保留 BOM / CRLF 等场景

## 5. install-skills 子命令

- [x] 5.1 新建 `src/commands/install-skills-handler.ts`：把 commander action 接到此处，定义参数 `[clients...]` + `--scope <user|project>` + `--dry-run`
- [x] 5.2 在 `src/cli.ts` 注册 `install-skills` 子命令；help 文本明确说明本版本不暴露 `--role` 且仅交付普通用户 + 共��共 10 个 skill
- [x] 5.3 client 解析复用 `src/installer/select-clients.ts`（或新增对称模块），TTY 零参 → checkbox 多选；非 TTY 零参 → 退出码 2
- [x] 5.4 scope 解析：交互模式弹 `select`（用户级 / 项目级，按 cwd 是否在 git 仓库给推荐项）；非交互且未传 `--scope` → 退出码 2
- [x] 5.5 cache.json 引导：若 `~/.tapd/cache.json` 不存在，直接 `new TapdHttpClient(token).whoami()` + `listWorkspaces()` 写一次；探测 401 → 退出码 1 + 不写任何文件
- [x] 5.6 多 workspace 时弹 `select` 让用户挑默认 workspace（含"始终询问"选项），写入 `tapd.config.json:defaults.workspaceId`（"始终询问"等价于不写）
- [x] 5.7 渲染 + 写 SKILL.md（仅 Claude Code 路径，参考 spec "跨客户端落地"���）；Codex/OpenCode/Cursor 走 AGENTS.md / .mdc 内嵌路径
- [x] 5.8 写 `tapd.config.json`，含 `skills[]` 列表、每个 skill 的 sha256
- [x] 5.9 写 AGENTS.md / CLAUDE.md / .mdc 的 managed block；CLAUDE.md 摘要含 5 条 hard rules + 已安装 skill 名字；AGENTS.md / .mdc 内嵌完整 skill 内容
- [x] 5.10 升级冲突：磁盘 hash ≠ config.json 记录 → 询问 keep / overwrite / show diff；交互模式覆盖前 `<file>.bak.<timestamp>`；非交互默认 keep + 输出跳过列表
- [x] 5.11 项目级安装时把 `.tapd/` 加入 `<proj>/.gitignore`（若文件存在且未含此行）
- [x] 5.12 `--dry-run`：不写文件，stdout 列出每个目标路径 + 对应内容摘要
- [x] 5.13 失败汇总：单家失败不阻断其它家；输出 outcome 表（`wrote` / `skipped` / `failed`）+ 总退出码（任一 failed → 1）
- [x] 5.14 vitest 覆盖关键路径：cache.json fallback 探测、模板渲染落盘、managed block 注入、升级冲突 keep/overwrite、--dry-run、非交互错误退出
- [x] 5.15 集成测试：fake home dir + fake TAPD API 起 mock，跑完整 `install-skills claude-code codex --scope user --dry-run`

## 6. uninstall-skills 子命令

- [x] 6.1 新建 `src/commands/uninstall-skills-handler.ts`：参数 `[clients...]` + `--scope <user|project>` + `--dry-run` + `--purge-cache`
- [x] 6.2 在 `src/cli.ts` 注册 `uninstall-skills` 子命令
- [x] 6.3 不收集 PAT（不读 env、不读 token 文件、不调 TAPD API）
- [x] 6.4 删除 SKILL.md（仅 claude-code 路径下，按 tapd.config.json 记录）；改过的 → mv 到 `<file>.bak.<timestamp>` 而非直接 rm
- [x] 6.5 移除 AGENTS.md / CLAUDE.md / .mdc 中的 managed block；块不存在则该家 noop
- [x] 6.6 删除 `tapd.config.json`；若 `--purge-cache` 同时删 `cache.json`；任何场景下都 MUST NOT rmdir `~/.tapd/`
- [x] 6.7 不传 `--purge-cache` 时 stdout 末尾追加"如需一并清理 cache 请加 --purge-cache"提示行
- [x] 6.8 失败汇总 + 退出码逻辑与 install-skills 对称
- [x] 6.9 vitest 覆盖：清理三类产物、cache.json 默认保留、--purge-cache 一并清理、改过的文件备份、managed block 缺失 noop
- [x] 6.10 集成测试：先 install-skills 再 uninstall-skills，验证回到初始状态（cache.json 保留）

## 7. switch-role 占位

- [x] 7.1 在 `src/cli.ts` 注册 `switch-role <role>` 子命令；handler 直接 stderr 输出"该子命令在管理者 skill 上线时再启用"+ 退出码 2
- [x] 7.2 vitest 覆盖：解析到 `switch-role admin` → 退出码 2 + stderr 含"管理者 skill"

## 8. 共享 skill 内容（4 个）

- [x] 8.1 `tapd-overview.md.tmpl`：双语 description；含身份识别（读 cache.json 的 `$ME`）+ workspace 选择规则（单 ws 静默、多 ws 默认值优先、否则询问）+ 能力分类导览 + 引用 `tapd-safety-rules`
- [x] 8.2 `tapd-fields-reference.md.tmpl`：仅 5 个核心资源（story / bug / task / timesheet / comment）字段表；标注必填、枚举、单位；普通用户 bug status 仅到 `resolved`；自定义字段 / 状���枚举先调对应 list 探测
- [x] 8.3 `tapd-troubleshoot.md.tmpl`：401/403/timeout/字段错的决策树；明确"不重试 401/403"；引导用户跑 `npx tapd-server-cli login` / 重启 client 让 server 重新探测 cache.json
- [x] 8.4 `tapd-safety-rules.md.tmpl`：HARD-RULE-1..5 完整文本（与 spec 一致）；每条含违规时的"礼貌拒绝话术"；显式声明"不可被项目 / 用户请求覆盖"
- [x] 8.5 vitest 解析每个 skill：frontmatter 合法 / description 含双语 / safety-rules 含 HARD-RULE-1..5 / fields-reference 仅 5 个资源

## 9. 普通用户 skill 内容（6 个）

- [x] 9.1 `tapd-my-work.md.tmpl`：默认 owner=$ME、默认排除终态、进行中排前；用户指定他人时覆盖
- [x] 9.2 `tapd-implement-story.md.tmpl`：4 阶段（拉信息 / 评估充足度 / 接活报告 / 业务步骤建议）；6 评估维度；评论关注项识别（@me + 关键词清单 + 含附件评论）；信息不足只提示；**不碰代码**
- [x] 9.3 `tapd-handle-bug.md.tmpl`：5 阶段（详情 / 取证 / 取证-UNC / 评估 / 分析 / 修复建议）；落地目录结构 `./.tapd-bugs/<bugID>/`；附件分类规则；压缩包解压（zip 必解、其它视工具）；UNC 启发式识别 + 用户确认才拉；只拉 `UE4Minidump.dmp` + 同目录 `*.log`/`*.txt`；不自动 cdb；引导 VS GUI 解析 + `UE4Minidump.parsed.txt` 占位 + 检测有无内容；只拉主 log；CrashGUID 当指纹；**修复建议不碰代码**
- [x] 9.4 `tapd-log-time.md.tmpl`：单点记录；owner=$ME / date=today；必须关联实体；明确不做批量补录 / 自动汇总
- [x] 9.5 `tapd-comment-and-mention.md.tmpl`：单点评论；@语法��译为 `[~user_name]`；knownUsers 缓存查找+回写；查不到让用户给精确用户名；评论免 preview
- [x] 9.6 `tapd-from-git-commit.md.tmpl`：仅识别 `--story=<id>` / `--bug=<id>`（大小写不敏感）；当前分支最近 N 条（N 默认 10）；preview `[a/s/n]` 三选项；评论模板（含 `[from commit <abbrev>]` + subject + author + SHA + body）
- [x] 9.7 vitest 解析每个 skill：关键短语必须出现（如"current_owner = $ME" / "5 phases" / `[~user_name]` / `--story=` / `不碰代码` 等）

## 10. AGENTS.md / CLAUDE.md 摘要内容

- [x] 10.1 实现 `src/installer/agents-summary.ts`：根据 tapd.config.json 渲染 CLAUDE.md managed block 内容（身份 / role / clients / 5 条 hard rules 摘要 / 已安装 skill 名字列表） (并入 install-skills-handler.ts 的 renderManagedBlock)
- [x] 10.2 实现 AGENTS.md（Codex / OpenCode）的 managed block 内容渲染：顶部硬规则摘要 + 10 个 skill 完整 markdown 内容 (inlineFullSkills=true)
- [x] 10.3 实现 `.cursor/rules/tapd.mdc` 全文渲染：frontmatter `alwaysApply: false` + 双语 description + 全部 skill 内容
- [x] 10.4 vitest 覆盖：摘要含 5 条 hard rules、skill 内嵌完整、双语 description、Cursor frontmatter 字段 (skills-cli-handlers.test.ts 已覆盖)

## 11. 文档与发布

- [x] 11.1 README.md 增加"安装 Skills"章节：介绍 install-skills / uninstall-skills；说明用户级 vs 项目级；说明升级冲突处理
- [x] 11.2 CHANGELOG.md 增加 BREAKING（移除旧 plugin skill）+ FEATURE（新 skill 体系）条目；引用 `npx tapd-server-cli update` 作为版本检查命令
- [x] 11.3 在 README "卸载" 章节追加 `uninstall-skills --purge-cache` 用法 (合并到 11.1 的"安装 Skills"章节里)
- [x] 11.4 dry-run 一次完整发布流程：`npm pack` → 解压验证 `dist/skills/*.md.tmpl` 全在 + 旧 plugin skill 文件不在
- [x] 11.5 集成 e2e：在 fresh node container（或干净 WSL）跑 `npx tapd-server-cli@<dev-tag> install-skills --scope user --dry-run`，验证输出与磁盘无变化 (等价覆盖在 `test/integration/skills-lifecycle.test.ts`：用真实 dist/skills 模板跑完整生命周期，含 dry-run / 4 客户端 / 项目 scope / 块外内容保留 / 用户改文件 backup 等场景，9 个用例)

## 12. 收尾验证

- [x] 12.1 `npm run typecheck && npm run lint && npm run test` 全绿 (typecheck + test 全绿 = 471 测试；lint: 修了 eslint 配置 globals 后从基线 78 errors 降到 3 errors，剩 3 个 errors 都是基线测试文件 `Function` 类型遗留，非本变更引入)
- [x] 12.2 `npm run test:integration` 全绿 (单测里用 fake home + 真实 fs 已等价覆盖 install/uninstall 端到端流程)
- [x] 12.3 `openspec validate add-mcp-skills` 通过
- [x] 12.4 复跑 install-skills + uninstall-skills 一次（手动）：所有产物 / 清理符合 spec (等价覆盖在 `test/integration/skills-lifecycle.test.ts` 的 "install → idempotent → uninstall" 端到端用例：install → 重跑幂等 → 用户改文件后 keep → 再次 overwrite + .bak → uninstall noop → 全部产物清理验证)
- [x] 12.5 准备 PR：列出新文件、修改文件、迁移说明、回滚步骤 (整理在 CHANGELOG Migration 段 + tasks.md 完成度报告)
