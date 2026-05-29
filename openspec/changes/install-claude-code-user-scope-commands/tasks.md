## 1. 实现 installCommands / removeCommands 工具函数

- [ ] 1.1 新增 `src/installer/user-scope-commands.ts`：导出 `installCommands(targetHome: string, commandsSrc: string): { installed: string[]; skipped: string[]; failed: string[] }` 与 `removeCommands(targetHome: string): { removed: boolean; error?: string }`
- [ ] 1.2 `installCommands` 行为：
  - mkdir -p `${targetHome}/.claude/commands/tapd-server-cli/`（失败 graceful）
  - 列出 `commandsSrc` 下所有 `.md` 文件
  - 对每个文件：`fs.copyFile` 到 target；记录 installed/skipped/failed
  - 返回结构化结果（不抛）
- [ ] 1.3 `removeCommands` 行为：
  - `fs.rm(${targetHome}/.claude/commands/tapd-server-cli/, { recursive: true, force: true })`
  - 失败 graceful，记录 error 字符串

## 2. 把 packageRoot 解析逻辑抽出来

- [ ] 2.1 新增 `src/installer/package-root.ts`：导出 `resolvePackageRoot(): string`，从 `import.meta.url` 推算 npm 包安装位置（`fileURLToPath` + 多个 `dirname` 上溯）
- [ ] 2.2 同时导出 `resolveCommandsSrc(): string` = `join(packageRoot, 'commands')`，给 install/uninstall 流程统一调用点

## 3. 集成到 claude-code adapter

- [ ] 3.1 修改 `src/installer/adapters/claude-code.ts`：在 `write()` 方法之外加 `postInstallHook` 字段或类似钩子（保持其它 adapter 不变）；或更简单——直接在 `flow.ts` 里 `if (key === 'claude-code')` 分支调
- [ ] 3.2 修改 `src/installer/flow.ts`：在 `claude-code` 客户端 write 成功后调用 `installCommands(os.homedir(), resolveCommandsSrc())`，把结果合并到 install summary 输出
- [ ] 3.3 修改 `src/installer/uninstall-flow.ts`：在 `claude-code` 客户端 mcp.json 修改成功后调用 `removeCommands(os.homedir())`，把结果合并到 uninstall summary 输出

## 4. dry-run 路径

- [ ] 4.1 修改 `flow.ts` 的 dry-run 输出：在 `claude-code` 客户端 dry-run 时打印拟拷贝的 commands 文件清单（实际不写盘）
- [ ] 4.2 验证 `--dry-run` 时 `~/.claude/commands/tapd-server-cli/` 不被创建

## 5. npm 发布配置——commands/ 进 tarball

- [ ] 5.1 修改 `package.json.files` 白名单加 `"commands"`：`["dist", "commands", "README.md", "LICENSE"]`
- [ ] 5.2 修改 `.npmignore`：删 `commands/` 排除项
- [ ] 5.3 修改 `.github/workflows/release.yml` 的 `Verify npm package excludes plugin files` step：grep 模式从 `\.claude-plugin/|\.mcp\.json|^commands/|^skills/|^openspec/|^docs/` 改为去掉 `^commands/`（保留其它五项）；同时改 grep 命中行的 sed 增强模式（`add-claude-code-plugin` 引入的）
- [ ] 5.4 验证：本地跑 `npm pack --dry-run` 输出 Tarball Contents 含 `commands/login.md` 等三个文件

## 6. 测试覆盖

### 6.1 单元层 (test/unit/user-scope-commands.test.ts，新增)

- [ ] 6.1.1 `installCommands` 把 mock fs 中三个 `.md` 拷到 target，返回 `installed.length === 3`
- [ ] 6.1.2 `commandsSrc/update.md` 不存在时跳过、login/logout 仍拷，返回 `installed.length === 2, skipped: ['update.md']`
- [ ] 6.1.3 `commandsSrc/` 整目录不存在时返回 `installed: [], failed: [...]` + warning
- [ ] 6.1.4 `removeCommands` 删整目录，返回 `removed: true`
- [ ] 6.1.5 `removeCommands` 在目录不存在时返回 `removed: false, error: undefined`（静默成功）
- [ ] 6.1.6 `installCommands` 在 target 目录已含用户其它 `my-custom.md` 时不删它（仅覆盖同名文件）

### 6.2 集成层 (test/unit/installer-flow.test.ts，扩展)

- [ ] 6.2.1 加 describe `runInstall — claude-code copies user-scope commands`：
  - mkdtemp 临时 home，runInstall + tokenOverride
  - 断言 `${tempHome}/.claude/commands/tapd-server-cli/login.md` 存在且 byte 等于源 `commands/login.md`
- [ ] 6.2.2 加 describe `runUninstall — claude-code removes user-scope commands directory`：
  - install 后立刻 uninstall
  - 断言 `${tempHome}/.claude/commands/tapd-server-cli/` 整目录不存在
- [ ] 6.2.3 加 describe `runInstall --dry-run — claude-code does not write commands`：
  - dryRun=true
  - 断言目录不存在但 stdout 含 "would copy" 或类似预览输出

### 6.3 跨平台

- [ ] 6.3.1 用 `node:path` `os.homedir()` `os.tmpdir()` 抽象路径——避免 Win 硬编码反斜杠
- [ ] 6.3.2 测试在 mock home（mkdtemp）下跑——避免污染真实 `~/.claude/`

## 7. README 更新

- [ ] 7.1 在 npx install claude-code 节加一段说明：
  > 安装时会同时把 slash 命令拷到 `~/.claude/commands/tapd-server-cli/`，让你在 Claude Code 内能用 `/tapd-server-cli:login` `/logout` `/update` 三条 slash 命令。
- [ ] 7.2 列出三个 slash 命令及其作用（与 `commands/*.md` frontmatter 的 description 对齐）
- [ ] 7.3 卸载节加一段：`uninstall claude-code` 会自动删 `~/.claude/commands/tapd-server-cli/` 整目录

## 8. 跑全套测试

- [ ] 8.1 `npm run typecheck`——clean
- [ ] 8.2 `npm test`——全过；新加的 6 个用例 PASS
- [ ] 8.3 `npm run build`——dist 不变（commands/ 不进 dist，仅源 markdown）
- [ ] 8.4 `npm pack --dry-run`——输出 Tarball Contents 含 `commands/*.md`、不含 `\.claude-plugin/` 等

## 9. archive 本 change（与 §A §C 同 PR merge 后）

- [ ] 9.1 `openspec archive install-claude-code-user-scope-commands --yes`
- [ ] 9.2 验证 `openspec/specs/installer-cli/spec.md` 含本次新增的 2 个 Requirement（claude-code install 拷贝 + uninstall 反向清理）
- [ ] 9.3 commit archive 移动
