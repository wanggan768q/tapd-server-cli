## 1. 依赖与脚手架

- [x] 1.1 在 `package.json` 的 `dependencies` 中加入 `@inquirer/checkbox`，运行 `npm install` 后提交 lock 文件
- [x] 1.2 在 `src/installer/` 下新建 `select-clients.ts` 占位文件（导出 `resolveClients` 类型签名 + TODO 实现），先让 `tsc` 走通

## 2. CLI 解析改造（cli.ts）

- [x] 2.1 把 `install <client>` 改为 `install [clients...]`（commander variadic 可选）
- [x] 2.2 校验每个 token 是否在 `SUPPORTED_CLIENTS` 内，未识别时复用现有错误文案 + exit code 2
- [x] 2.3 调整 `ParsedCli`：`{ mode: 'install'; clients: string[]; dryRun: boolean }`（把 `client: string` 改成 `clients: string[]`）
- [x] 2.4 兼容 `install --dry-run claude-code codex` 与 `install claude-code codex --dry-run` 两种顺序，并在解析层加 1-2 条单测

## 3. 客户端选择层（select-clients.ts）

- [x] 3.1 实现 `resolveClients(parsedClients, opts)`：
  - parsedClients 非空 → 直接返回（且去重保序）
  - parsedClients 为空 + stdin & stdout 均 TTY → 调用注入的 `prompt`（默认 `@inquirer/checkbox`）
  - parsedClients 为空 + 任一非 TTY → 抛 `NonInteractiveNoClientError`（携带支持列表）
- [x] 3.2 把 4 家 adapter 的 `key` + `displayName` 渲染为 checkbox `choices`
- [x] 3.3 用户未勾任何项 → 抛 `NoClientsSelectedError`
- [x] 3.4 处理 Ctrl-C：捕获 `@inquirer/checkbox` 抛出的取消错误，转为 `UserCancelledError`
- [x] 3.5 单测：mock prompt，覆盖（a）非空 parsedClients 直通（b）TTY + 选中 2 家（c）TTY + 全不选（d）非 TTY 报错（e）Ctrl-C 取消

## 4. 安装编排改造（flow.ts）

- [x] 4.1 `RunInstallOptions.client: string` → `clients: string[]`；`RunInstallResult` 改为汇总形态：`{ exitCode, results: PerClientResult[] }`
- [x] 4.2 把 `promptToken` 调用从适配器循环中提取到入口处，仅执行一次；对 `tokenOverride` / env 优先级保持现状
- [x] 4.3 对 `clients` 顺序执行 `read → merge → write` / `dry-run` 路径，每家用 try/catch 包住，组装 `PerClientResult`
- [x] 4.4 任一 `failed` → 整体 `exitCode = 1`；其余按现有 0 / 1 / 2 语义
- [x] 4.5 实现汇总输出：`✔ <client>  <path>` / `= <client>  (no-op)` / `[dry-run] <client>  <path>` / `✗ <client>  <reason>` 四类行
- [x] 4.6 dry-run 路径下不写文件、不调用 adapter.write
- [x] 4.7 保持 backup + atomic 写入逻辑不动（adapter.write 内部已具备）

## 5. 入口接线（index.ts）

- [x] 5.1 把 `parsed.mode === 'install'` 分支改为：先调 `resolveClients(parsed.clients, { isStdinTty, isStdoutTty })`，再传给 `runInstall({ clients, dryRun })`
- [x] 5.2 捕获 `select-clients.ts` 抛出的三类错误（`NonInteractiveNoClientError` / `NoClientsSelectedError` / `UserCancelledError`），分别映射到清晰的 stderr 文案 + exit code

## 6. 测试

- [x] 6.1 `cli.test.ts`（或新增 `cli-install.test.ts`）：variadic 解析、未识别 client、--dry-run 顺序、零参解析为空数组
- [x] 6.2 `flow.test.ts`：单家成功 / 单家 PAT 错 / 多家全部成功 / 部分失败汇总 / 多家 dry-run / 多家 noop
- [x] 6.3 `select-clients.test.ts`：D7 各分支已在任务 3.5 列出，确保独立可跑
- [x] 6.4 `vitest run` 全绿；`tsc --noEmit` 全绿

## 7. 文档与收尾

- [x] 7.1 更新 `README.md` 安装章节：示例改为 `npx -y tapd-server-cli install`（弹选择器）+ `install claude-code codex` 的多家形态 + 注明非 TTY 行为
- [x] 7.2 verify 阶段执行 `openspec validate install-multi-client-checkbox`，确认 spec 可通过校验
- [x] 7.3 跑一次本地手测：（a）TTY 下零参 → checkbox（b）`install claude-code codex --dry-run` → 双家 dry-run（c）非 TTY 下零参 → 报错
- [x] 7.4 提交：单条 commit，message 形如 `feat(installer): support multi-client checkbox selection`
