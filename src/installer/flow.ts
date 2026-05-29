/**
 * Install 子命令主流程：
 *   1) 选定 adapter 列表（key → adapter；未识别即标记为 failed，不中断其他家）
 *   2) 收 PAT（tty 交互或 TAPD_TOKEN env / opts.tokenOverride），**只解析一次**复用给所有家
 *   3) 对每家执行 read → merge → 判断 idempotent → 写入 / dry-run，按 try/catch 隔离
 *   4) 输出汇总报告（每家一行 + 下一步指引）
 *   5) 任一失败 → exitCode=1；全 noop / wrote / dry-run → exitCode=0
 */

import { claudeCodeAdapter } from './adapters/claude-code.js';
import { codexAdapter } from './adapters/codex.js';
import { cursorAdapter } from './adapters/cursor.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { promptToken, TokenInputError, type PromptOptions } from './prompt.js';
import { type ClientAdapter } from './adapter.js';
import { preferClaudeCliInstall } from './claude-cli.js';
import { preferCodexCliInstall } from './codex-cli.js';
import { resolveCommandsSrc } from './package-root.js';
import { installCommands, type InstallCommandsResult } from './user-scope-commands.js';
import { homedir } from 'node:os';

const ALL_ADAPTERS: Record<string, ClientAdapter> = {
  [claudeCodeAdapter.key]: claudeCodeAdapter,
  [codexAdapter.key]: codexAdapter,
  [opencodeAdapter.key]: opencodeAdapter,
  [cursorAdapter.key]: cursorAdapter,
};

export type PerClientOutcome = 'wrote' | 'noop' | 'dry-run' | 'failed';

export interface PerClientResult {
  client: string;
  outcome: PerClientOutcome;
  /** 目标配置文件路径；未识别客户端时为空字符串 */
  path: string;
  /** 备份提示（仅 wrote 路径下、且原文件已存在时）；其他场景 undefined */
  backup?: string;
  /** 失败原因（仅 outcome === 'failed' 时） */
  error?: string;
  /** B1：CLI 优先尝试失败、降级到手写文件路径时的诊断（不阻塞流程，仅供用户感知） */
  fallbackReason?: string;
  /** v0.3.0：claude-code install 时把 user-scope commands 拷到 ~/.claude/commands/tapd-server-cli/ 的结果 */
  userScopeCommands?: InstallCommandsResult;
}

export interface RunInstallOptions {
  /** 已通过 select-clients 决定的最终客户端列表（非空） */
  clients: string[];
  dryRun: boolean;
  /** 测试钩子 */
  promptOptions?: PromptOptions;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试用：覆盖 token 输入（跳过交互） */
  tokenOverride?: string;
  /** 测试用：覆盖用户家目录（默认 os.homedir()），用于隔离 user-scope commands 拷贝目标 */
  homedirOverride?: string;
  /** 测试用：覆盖 commands 源目录（默认从 npm 包根解析），用于注入 fixture */
  commandsSrcOverride?: string;
}

export interface RunInstallResult {
  exitCode: number;
  results: PerClientResult[];
}

/**
 * 单家结果格式化为汇总输出的一行。
 *
 *   ✔ <client>  <path>             成功写入
 *   = <client>  (no-op) <path>     已是最新
 *   [dry-run] <client>  <path>     dry-run
 *   ✗ <client>  <reason>           失败
 *
 * B1：当 wrote 是因为 CLI 优先失败降级到手写文件路径时，附加 (via fallback: <reason>)，
 * 让用户能从汇总输出里直接看到 CLI 那次的失败真因，而不是被静默吞到 stdout 里。
 */
function formatSummaryLine(r: PerClientResult): string {
  const fallbackSuffix = r.fallbackReason ? `  (via fallback: ${r.fallbackReason})` : '';
  switch (r.outcome) {
    case 'wrote':
      return `✔ ${r.client}  ${r.path}${fallbackSuffix}`;
    case 'noop':
      return `= ${r.client}  (no-op) ${r.path}${fallbackSuffix}`;
    case 'dry-run':
      return `[dry-run] ${r.client}  ${r.path}`;
    case 'failed':
      return `✗ ${r.client}  ${r.error ?? '未知错误'}`;
  }
}

export async function runInstall(opts: RunInstallOptions): Promise<RunInstallResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  // 防御：调用方应保证 clients 非空，但万一传空也别崩——退化为 exitCode=2 + 友好提示。
  if (opts.clients.length === 0) {
    stderr.write('install: 未指定任何客户端\n');
    return { exitCode: 2, results: [] };
  }

  // 1) 早期未识别客户端：单家时退出码沿用 2；多家时仍记录为 failed，整体非 0。
  //    但 cli.ts 已经在解析时拒绝未知值；这里的检查仅作为运行时防线。
  const unknown = opts.clients.filter((c) => !ALL_ADAPTERS[c]);
  if (unknown.length > 0) {
    stderr.write(
      `未识别的客户端 ${unknown.map((c) => `"${c}"`).join(', ')}。可用：${Object.keys(
        ALL_ADAPTERS,
      ).join(' / ')}\n`,
    );
    return {
      exitCode: 2,
      results: opts.clients.map((c) => ({
        client: c,
        outcome: ALL_ADAPTERS[c] ? 'failed' : 'failed',
        path: '',
        error: ALL_ADAPTERS[c] ? '未执行（前置参数错误）' : '未识别的客户端',
      })),
    };
  }

  // 2) PAT 只解析一次（D4）
  let token: string;
  try {
    if (opts.tokenOverride) {
      token = opts.tokenOverride;
    } else {
      const r = await promptToken(opts.promptOptions);
      token = r.token;
    }
  } catch (err) {
    if (err instanceof TokenInputError) {
      stderr.write(`${err.message}\n`);
      return { exitCode: 1, results: [] };
    }
    throw err;
  }

  const tapdEnv: Record<string, string> = {
    TAPD_TOKEN: token,
    TAPD_LOG_LEVEL: 'info',
  };

  // v0.3.0：claude-code install 成功后，把 npm 包内 commands/*.md 拷到
  // ~/.claude/commands/tapd-server-cli/，让 user-scope slash 命令机制识别
  // /tapd-server-cli:login /logout /update。失败 graceful（不阻塞 mcp.json 写入）。
  const commandsHome = opts.homedirOverride ?? homedir();
  const commandsSrc = opts.commandsSrcOverride ?? resolveCommandsSrc();
  const installUserScopeCommands = (): InstallCommandsResult | undefined => {
    if (opts.dryRun) return undefined;
    const r = installCommands(commandsHome, commandsSrc);
    if (r.srcMissing) {
      stderr.write(
        'warning: commands directory not found in package, skipping user-scope commands install\n',
      );
    } else if (r.mkdirError) {
      stderr.write(
        `warning: failed to mkdir ~/.claude/commands/tapd-server-cli/ (${r.mkdirError})\n`,
      );
    } else if (r.failed.length > 0) {
      for (const f of r.failed) {
        stderr.write(`warning: failed to copy commands/${f.file}: ${f.error}\n`);
      }
    }
    if (r.installed.length > 0) {
      const note =
        r.skipped.length > 0
          ? ` (${r.installed.length} files, skipped: ${r.skipped.join(', ')})`
          : ` (${r.installed.length} files)`;
      stdout.write(`✓ user-scope commands installed${note}\n`);
    }
    return r;
  };

  // 3) 顺序处理每家，单家失败不中断其他家
  const results: PerClientResult[] = [];

  for (const key of opts.clients) {
    const adapter = ALL_ADAPTERS[key];
    if (!adapter) {
      // 上面已挡过；防御性兜底。
      results.push({
        client: key,
        outcome: 'failed',
        path: '',
        error: '未识别的客户端',
      });
      continue;
    }

    // B1：claude-code / codex 优先调官方 CLI；不可用或失败再走手写文件 fallback。
    let fallbackReason: string | undefined;
    if (!opts.dryRun && (key === 'claude-code' || key === 'codex')) {
      const cliResult =
        key === 'claude-code'
          ? await preferClaudeCliInstall(tapdEnv)
          : await preferCodexCliInstall(tapdEnv);
      if (cliResult.used === 'cli') {
        const via =
          key === 'claude-code'
            ? '<via claude mcp add-json --scope user>'
            : '<via codex mcp add>';
        stdout.write(`已通过官方 CLI 注册 ${adapter.displayName}：${via}\n`);
        const userScopeCommands =
          key === 'claude-code' ? installUserScopeCommands() : undefined;
        results.push({
          client: key,
          outcome: 'wrote',
          path: via,
          userScopeCommands,
        });
        continue;
      }
      // 走 fallback：把 CLI 失败的诊断信息记到 fallbackReason，并写到 stderr（而非 stdout，
      // 避免被淹没在正常输出里、让用户误以为安装一切正常）。
      if (cliResult.stderr) {
        fallbackReason = cliResult.stderr.trim().split('\n')[0]?.slice(0, 200);
        stderr.write(
          `(${adapter.displayName} CLI 不可用或失败，降级走手写文件：${fallbackReason})\n`,
        );
      }
      // 继续往下到现行手写文件路径
    }

    try {
      const existing = await adapter.read();
      const isUpToDate = adapter.isUpToDate(existing, tapdEnv);
      const target = adapter.configPath();

      if (opts.dryRun) {
        stdout.write(`[dry-run] ${adapter.displayName} 目标配置：${target}\n`);
        stdout.write(`[dry-run] 将写入：${adapter.describeNext(tapdEnv)}\n`);
        const current = adapter.describeCurrent(existing);
        if (current) stdout.write(`[dry-run] 当前配置：${current}\n`);
        if (isUpToDate) stdout.write('[dry-run] 配置已是最新，实际不会变更。\n');
        results.push({ client: key, outcome: 'dry-run', path: target });
        continue;
      }

      if (isUpToDate) {
        stdout.write(`${adapter.displayName} 配置已是最新，无需变更。\n`);
        results.push({ client: key, outcome: 'noop', path: target, fallbackReason });
        continue;
      }

      const merged = adapter.merge(existing, tapdEnv);
      const beforeExists = existing !== undefined;
      await adapter.write(merged);
      const backupHint = beforeExists ? `<已自动备份到 ${target}.bak.<timestamp>>` : undefined;

      stdout.write(`已写入 ${adapter.displayName} 配置：${target}\n`);
      if (backupHint) stdout.write(`${backupHint}\n`);

      const userScopeCommands =
        key === 'claude-code' ? installUserScopeCommands() : undefined;

      results.push({
        client: key,
        outcome: 'wrote',
        path: target,
        backup: backupHint,
        fallbackReason,
        userScopeCommands,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      stderr.write(`安装 ${adapter.displayName} 失败：${reason}\n`);
      results.push({
        client: key,
        outcome: 'failed',
        path: adapter.configPath(),
        error: reason,
      });
    }
  }

  // 4) 汇总报告 + 下一步指引
  stdout.write('\n安装结果：\n');
  for (const r of results) {
    stdout.write(`  ${formatSummaryLine(r)}\n`);
  }

  const anyWrote = results.some((r) => r.outcome === 'wrote');
  const anyDryRun = results.some((r) => r.outcome === 'dry-run');
  if (anyWrote || anyDryRun) {
    stdout.write('\n下一步：\n');
    stdout.write('  1) 重启对应客户端（让新的 MCP 配置生效）\n');
    stdout.write('  2) 在新会话里输入 /mcp__tapd__setup 完成 cookie 登录（首次安装）\n');
  }

  // 5) 退出码：任一 failed → 1；全 noop / wrote / dry-run → 0
  const anyFailed = results.some((r) => r.outcome === 'failed');
  return { exitCode: anyFailed ? 1 : 0, results };
}

export { ALL_ADAPTERS };
