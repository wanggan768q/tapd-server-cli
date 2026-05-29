## Context

PR #1（v0.2.0 → v0.2.1）引入了 4 处 version 字段的同步基建：`scripts/sync-plugin-version.mjs` 在 `npm version` 钩子触发时把 `package.json.version` 写到另外 3 个文件——`.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` / `src/runtime/version.ts`。PR #12 又加了第 4 个目标：`.mcp.json.mcpServers.tapd.args[1]` 的 `~<minor>.0` 范围。

但 `package.json.scripts.version` 钩子只 `git add` 了前 2 个 manifest 文件：

```
"version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json"
```

后果：v0.2.1 发版时 sync 脚本写好的 `version.ts` / `.mcp.json` 不在自动 commit 里，HEAD 落后一个 patch。CI 从 tag commit 拉代码 build dist，于是 `tapd-server-cli@0.2.1` npm 包内 `dist/runtime/version.js` 实测 `VERSION = '0.2.0'`——经实测确认（拆 npm tarball 直接读出来）。

`tapd.update` 工具靠这个值算 `current` 字段，结果对 plugin 用户报 `current=0.2.0 / latest=0.2.1`，让他们以为没装上。

## Goals / Non-Goals

**Goals**:

- 让 `npm version <bump>` 一次走完后，HEAD 上的 4 个文件都带新版本号。
- 加测试守卫，未来如果 sync 脚本扩展再加文件、钩子忘补 git add，CI 阶段能拦下。
- 发 v0.2.2 hotfix 让 npm 上的 dist 真带 `VERSION = '0.2.1'` 的实际值（hotfix 走一次修好的钩子，自��就把 version.ts commit 进去了）。
- 在 spec 里把"4 处 version 同步契约"显式写成 Requirement，今后不再依赖钩子和脚本之间的隐式默契。

**Non-Goals**:

- 不重写 `scripts/sync-plugin-version.mjs` 的同步逻辑——脚本本身没 bug，问题只在钩子。
- 不动 release.yml 的 CI 校验——既有的"三处 version 同步"硬门禁仍然有效（只是它检查的是 sync 脚本输出对不对，不检查 hook 有没有 add 全），它和本 hotfix 是互补关系而不是替代。
- 不重发 `npm publish 0.2.1`——npm 不允许覆盖已发版本。bug 通过 v0.2.2 hotfix 自然修复。
- 不撤销现存 0.2.1 plugin 用户的 `current=0.2.0` 误报——他们升到 0.2.2 即修；只在 CHANGELOG 里 note 这条迁移建议。

## Decisions

### Decision 1：钩子里 `git add` 列表显式列 4 个文件，不抽 const

把钩子改成：

```
"version": "node scripts/sync-plugin-version.mjs && git add .claude-plugin/plugin.json .claude-plugin/marketplace.json .mcp.json src/runtime/version.ts"
```

**为什么不抽**到比如 `git add -u` 或读环境变量：

- `git add -u` 会把工作树里**所有** modified 的 tracked 文件 stage 进去——包括开发者 inflight 的实验改动。这是 release 自动化绝不该做的"扩面 stage"。
- 抽个数组到脚本里然后让钩子调脚本第二段——增加间接层，钩子调试时多一跳，性价比低。
- 4 个路径硬编码在 `package.json` 里**就是**契约本身——读 hook 一眼能看到全部 sync 落地点；将来加第 5 个 sync 目标时，sync 脚本和 hook 必须一起改，是好的"配对修改"信号。

### Decision 2：测试侧加 4 处一致性断言（不是 3 处）

`test/unit/plugin-manifest.test.ts` 现有 `version sync` 用例断言 3 处一致（`package.json` / `plugin.json` / `marketplace.json.plugins[0]`）。扩到 4 处，新增断言 `src/runtime/version.ts.VERSION === package.json.version`。

读取方式选 `regex match` 而不是 `import`——`version.ts` 在 ESM 严格模式下从 vitest 直接 import 要走 `.ts → .js` 编译路径，麻烦；`readFileSync + /VERSION = '([^']+)'/` 一行搞定，且测的就是源文件字面字符串（最贴近 hook 视角）。

`.mcp.json` 的 `args[1] = 'tapd-server-cli@~0.2.0'` 形式是 minor 范围而不是 patch——这是 PR #12 的 by-design。0.2.1 → 0.2.2 patch bump **不**会让 args[1] 改变，但跨 minor 时会。本测试不强求 args[1] 与 package.json.version 完全相等（那会跨 minor 时失败），仅断言 `args[1].startsWith('tapd-server-cli@~' + major + '.' + minor + '.0')`——把 PR #12 的范围契约也固化进来。

### Decision 3：v0.2.2 而不是 v0.3.0

按 SemVer：

- 本次只是元数据修复——服务器代码、API、工具都没变。
- 现存 `~0.2.0` 范围的 plugin 用户接受 0.2.2 自动升（这正是修复路径）。
- breaking change 是"某用户依赖 dist VERSION === '0.2.0' 字面值"——没人这么用。

故 patch bump 0.2.1 → 0.2.2 合规。

### Decision 4：CHANGELOG `[0.2.2]` 段记录"已发 0.2.1 用户被影响"

CHANGELOG 把根因 + 影响 + 升级路径写清楚，不只是说"修了"。已发布 0.2.1 plugin 用户在 `tapd.update` 看到 `current=0.2.0` 不是 client 误报、是 dist 真的写错——给他们留个搜得到的 anchor。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 钩子 `git add` 列表与 sync 脚本写文件列表分裂演进——脚本加新文件钩子忘补 | Decision 2 的测试断言是兜底；脚本头 JSDoc 加 4 文件清单作为一处提醒；release.yml 现有"三处 version 一致"CI 校验仍能在某些漂移场景拦下 |
| 0.2.2 发版又踩同款坑 | 先在分支上跑 `npm version --no-git-tag-version patch` dry-run（实际不打 tag），观察 4 个文件都被 stage，再放心走真发版流程 |
| 本 hotfix 测试只读源文件、不读 dist——CI build 之后 dist 里的值仍可能 drift | 不在本 hotfix 范围。要彻底防御就要加 `npm pack --dry-run` 后解 tarball 读 dist/runtime/version.js 的 step；那是更重的 CI 改造，单独 issue 跟踪 |
| 0.2.1 用户看到 `tapd.update` 报 `current=0.2.0` 后困惑 | CHANGELOG `[0.2.2]` 显式 note；Plugin 用户跑 `/plugin marketplace update tapd-server-cli` 即可拉到 0.2.2 |
