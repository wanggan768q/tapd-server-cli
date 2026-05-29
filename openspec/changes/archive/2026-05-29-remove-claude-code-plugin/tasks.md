## 1. 删除 plugin manifest 与配置文件

- [ ] 1.1 `git rm -r .claude-plugin/`（plugin.json + marketplace.json + 空目录）
- [ ] 1.2 `git rm .mcp.json`（孤儿——plugin.json 是它唯一上游 reference）

## 2. 删除 tapd.update MCP 工具

- [ ] 2.1 `git rm src/tools/update.ts`
- [ ] 2.2 `git rm src/runtime/version.ts`（仅 update 工具用的编译时内联版本号常量）
- [ ] 2.3 `git rm commands/update.md`（slash 命令源；CLI 子命令版本由 `add-cli-subcommands-login-logout-update` change 重写）
- [ ] 2.4 `git rm test/unit/update-logic.test.ts test/unit/update-tool.test.ts`
- [ ] 2.5 编辑 `src/runtime/server.ts`：删 `import { registerUpdateTool } from '../tools/update.js';` 行 + 对应注册调用
- [ ] 2.6 编辑 `src/tools/meta.ts`：找含 `'tapd.update'` 字面串的元数据条目并删除（约 line 108）
- [ ] 2.7 跑 `npm run typecheck`——预期 clean（无残留 import）

## 3. 删除版本同步基建

- [ ] 3.1 `git rm scripts/sync-plugin-version.mjs`
- [ ] 3.2 编辑 `package.json`：删 `scripts.version` 整字段（不是收缩）
- [ ] 3.3 `git rm test/unit/plugin-manifest.test.ts`（5 个用例全是 plugin manifest 测；本 change 删了所有被测对象）

## 4. 删除 CI 同步校验

- [ ] 4.1 编辑 `.github/workflows/release.yml`：删 `- name: Verify plugin version sync` 整 step（含 5-6 行 shell + `set -euo pipefail` 行）
- [ ] 4.2 保留 `- name: Verify npm package excludes plugin files` step 不动——下游 change 会更新它的 grep 模式
- [ ] 4.3 跑 `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8'))"`（如装了 js-yaml；否则手工读 head -50 检查 YAML 缩进未破）

## 5. README 删 plugin 节

- [ ] 5.1 删除"在 Claude Code 中安装（推荐）"整节（约 30 行）
- [ ] 5.2 删除"在其它客户端中安装（npx install）"标题中的"其它"——npx 现为唯一路径，标题改回"快速开始（推荐：一键安装）"或类似表达；删该节顶部那两段"如果你用 Claude Code 请优先看上面"+"Claude Code/Codex 优先调官方 CLI" 引用块（前者无目标，后者保留为正常段落而非引用块）
- [ ] 5.3 删除"在卸载节里关于 Claude Code 用户走 `/plugin uninstall` 的子节"，仅保留 npx uninstall 路径
- [ ] 5.4 删除"Slash 命令"节中关于 plugin 路径的 3 个子项（`/tapd-server-cli:login` `/logout` `/mcp__tapd__setup` 那段）；这部分等 `install-claude-code-user-scope-commands` change 重写
- [ ] 5.5 删除"高级：手动配置 MCP 客户端"节里的红字嵌套引用（`⚠️ 不是 ~/.claude/settings.json`）—— 仍保留，移到主段落作为普通说明（红字提示是 plugin 时代针对 marketplace 用户的，普通 npx 用户也会踩，仅降级语气）
- [ ] 5.6 删除故障排查表里的两行（PR #14 加的）：`/mcp 看不到 tapd → 检查 ~/.claude.json` 与 `已通过 npx install 装过又装 plugin` ——前者保留为故障排查（npx 用户也可能找错文件），改写为简化版；后者整删（plugin 路径没了就不存在冲突）

## 6. CHANGELOG `[0.3.0]` 段（共享给三个 change）

- [ ] 6.1 在 `[Unreleased]` 与 `[0.2.2]` 之间插入 `[0.3.0] - <today>` 段
- [ ] 6.2 写 Removed 组：plugin manifest / marketplace / `.mcp.json` / `tapd.update` 工具 / `commands/update.md` / `src/runtime/version.ts` / `scripts/sync-plugin-version.mjs` / `test/unit/plugin-manifest.test.ts` `update-*.test.ts` / `package.json.scripts.version` 钩子 / CI `Verify plugin version sync` step
- [ ] 6.3 写 Added 组（占位，由下游 change 填充实质内容）：user-scope commands 拷贝���径 + CLI login/logout/update 子命令
- [ ] 6.4 写 Migration 段：从 0.2.x plugin 用户迁移到 0.3.0 npx 用户的命令清单
- [ ] 6.5 写 Why 段：网络受限 + issue #10 GUI smoke 未完成 + 维护成本过高三条理由
- [ ] 6.6 跑 `node scripts/extract-changelog.mjs 0.3.0 --out /tmp/notes.md`——预期成功抽取（CI 门禁）

## 7. archive 前置：处理 add-claude-code-plugin change

- [ ] 7.1 检查 `openspec/changes/add-claude-code-plugin/` 是否仍存在；若存在，**手动删除其 specs/claude-code-plugin/ 子目录**（避免该 change archive 时把"创建 plugin manifest"等 6 个 Requirement 写进 main spec——本 change 紧接着会把 capability REMOVED 但 OpenSpec 不一定能跨 change 干净处理）
- [ ] 7.2 整个 `openspec/changes/add-claude-code-plugin/` 目录可保留（没法 archive，因为里头工作早于 v0.2.2 但实际代码已合并）。给目录加一个 `STATUS.md` 说明"Implementation merged in PR #1, change directory retained for historical reference; capability removed in v0.3.0 by remove-claude-code-plugin"。或者也整个 `git rm` —— 看你的 OpenSpec 习惯
- [ ] 7.3 决定后在 PR 里 commit

## 8. 跑全套自动化测试

- [ ] 8.1 `npm run typecheck`——clean
- [ ] 8.2 `npm test`——预期 ~26 文件 / ~290+ 用例，全过；`installer-flow.test.ts` 的 `prefers claude CLI` 集成测试仍 PASS
- [ ] 8.3 `npm run build`——dist 不再含 `dist/tools/update.js` `dist/runtime/version.js`
- [ ] 8.4 `npm pack --dry-run`——tarball 不含 `.claude-plugin/` `.mcp.json` `commands/update.md`；`commands/login.md` `logout.md` 仍 NOT 在 tarball（本 change 不动 npm files 白名单——该改动由 `install-claude-code-user-scope-commands` change 处理）

## 9. 验证 server 启动不依赖被删的 import

- [ ] 9.1 `node -e "import('./dist/runtime/server.js').then(() => console.log('import ok')).catch(e => { console.error(e); process.exit(1); })"`——预期 `import ok`；server.ts 不再 import update.ts/version.ts，import 链应干净

## 10. archive 本 change（在 §B §C 也实施完成 + 一起 commit + PR merge 之后）

- [ ] 10.1 `openspec archive remove-claude-code-plugin --yes`（24+ 任务未勾，本 change 任务清单只是设计的实施 checklist，archive 时不要求勾）
- [ ] 10.2 验证 `openspec/specs/claude-code-plugin/spec.md` 已被 OpenSpec 自动删除（capability 整体 REMOVED）；若仍存在，`git rm` 兜底
- [ ] 10.3 commit archive 移动 + 可能的 spec.md 兜底删除
