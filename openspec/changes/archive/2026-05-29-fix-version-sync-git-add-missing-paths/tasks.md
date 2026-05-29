## 1. 钩子修复（核心 1 行改动）

- [ ] 1.1 修改 `package.json.scripts.version`，把 `git add` 列表从 2 个文件扩到 4 个：`.claude-plugin/plugin.json` `.claude-plugin/marketplace.json` `.mcp.json` `src/runtime/version.ts`
- [ ] 1.2 在 `scripts/sync-plugin-version.mjs` 顶部 JSDoc 显式罗列 4 个被同步的文件路径（仅注释，无行为变化），让脚本与钩子的"同步目标必须一致"契约可读

## 2. 测试守卫扩展（防回归）

- [ ] 2.1 修改 `test/unit/plugin-manifest.test.ts` 的现有 `version sync` 用例，从断言 3 处一致扩到 4 处。新增 `src/runtime/version.ts.VERSION` 字面字符串的提取（用 `readFileSync + /export const VERSION = '([^']+)'/`，避免走 ESM import 路径）
- [ ] 2.2 在同文件 `.mcp.json` 占位符校验用例中追加 `args[1]` 字面校验：匹配正则 `^tapd-server-cli@~\d+\.\d+\.0$` + 与 `package.json.version` 的 major.minor 一致
- [ ] 2.3 新增独立用例 "version sync targets cover all writeFileSync paths"：解析 `scripts/sync-plugin-version.mjs` 中的 `writeFileSync` 调用、解析 `package.json.scripts.version` 字符串中 `git add ...` 部分、断言两个集合相等。这是 design.md Decision 1 的硬契约
- [ ] 2.4 跑 `npm test`，预期 31+ 测试文件全 PASS（含新断言）

## 3. 本地干跑验证（非 git 状态）

- [ ] 3.1 不实际 bump version，仅手工跑 `node scripts/sync-plugin-version.mjs` + 看 `git status --short`——应见 `src/runtime/version.ts` 与 `.mcp.json`（如果跨 minor）显示在 modified 列表里
- [ ] 3.2 跑 `git diff src/runtime/version.ts`——预期能看到 `VERSION = '0.2.1'`（HEAD 是 `0.2.0`，工作树是 sync 写入的当前 package.json.version）
- [ ] 3.3 `git checkout` 还原所有改动，工作树回到 clean

## 4. CHANGELOG 与 commit

- [ ] 4.1 写 `CHANGELOG.md` 顶部 `[0.2.2]` 段，分 `Fixed` 组记录 bug + 根因 + 影响（已发布 0.2.1 plugin 用户 `tapd.update` 误报 `current=0.2.0`）+ 升级路径（`/plugin marketplace update tapd-server-cli`）
- [ ] 4.2 commit 1 个 atomic commit，message: `fix(release): npm version hook git add all 4 sync targets`
- [ ] 4.3 push 到 origin/fix/version-sync-git-add-missing-paths

## 5. 发版 PR + 合并

- [ ] 5.1 `gh pr create` 开 PR，body 含本 OpenSpec change 的 proposal/design 摘要、bug 复现步骤、CI 跑过证据
- [ ] 5.2 等 CI 跑过（typecheck / test / build / 三处 version 同步校验 / npm pack excludes）
- [ ] 5.3 squash merge 到 main

## 6. 发版 v0.2.2（hotfix 走通修好的钩子）

- [ ] 6.1 `git checkout main && git pull` 拉 PR merge 后的 main
- [ ] 6.2 `npm version patch`——验证：本地 `git show HEAD --stat` 看到 5 个文件被 stage（package.json + 4 个 sync 目标），不是只有 3 个
- [ ] 6.3 `git push --follow-tags` 推 tag v0.2.2 触发 release CI
- [ ] 6.4 等 release CI 跑完（应 SUCCESS）
- [ ] 6.5 `npm view tapd-server-cli version` 应输出 `0.2.2`
- [ ] 6.6 关键验证：`mkdir -p /tmp/v022-verify && cd /tmp/v022-verify && npm pack tapd-server-cli@0.2.2 && tar -xzf tapd-server-cli-0.2.2.tgz && grep VERSION package/dist/runtime/version.js`——预期 `export const VERSION = '0.2.2';`（不是 `'0.2.1'`，证明 hotfix 真生效）
- [ ] 6.7 顺手在装有 v0.2.1 的环境跑 `/plugin marketplace update tapd-server-cli` 拉到 0.2.2、调 `tapd.update` 看 `current=0.2.2 / latest=0.2.2`（不再是 `current=0.2.0`）

## 7. archive 本 change

- [ ] 7.1 v0.2.2 发版验证全过后，`openspec archive fix-version-sync-git-add-missing-paths`
- [ ] 7.2 验证 `openspec/changes/archive/2026-MM-DD-fix-version-sync-git-add-missing-paths/` 目录存在；`openspec/changes/fix-version-sync-git-add-missing-paths/` 已被移走
