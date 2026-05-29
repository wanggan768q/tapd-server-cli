/**
 * Uninstall 子命令主流程,与 `flow.ts (install)` 完全对称:
 *   1) 选定 adapter 列表(key → adapter;未识别即标记为 failed,不中断其他家)
 *   2) **不收集 PAT**(uninstall 不需要凭据)
 *   3) 对每家执行 read → hasTapdEntry → removeEntry → backupAndWrite,按 try/catch 隔离
 *      - 文件不存在或 tapd 条目不存在 → outcome=`noop`
 *      - tapd 条目存在 → dry-run 输出预览 / 实写移除
 *   4) 客户端循环结束后,若 `opts.purge` 为 true,调 `purgePersistentFiles()` 清两个固定文件
 *   5) 未开 --purge 时若实际仍残留凭据文件,末尾追加提示行
 *   6) 输出汇总报告(每家一行 + purge 行 + 提示 + 下一步指引)
 *   7) 任一 client failed 或任一 purge 文件 failed → exitCode=1;否则 0
 */

import { claudeCodeAdapter } from './adapters/claude-code.js';
import { codexAdapter } from './adapters/codex.js';
import { cursorAdapter } from './adapters/cursor.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { type ClientAdapter } from './adapter.js';
import {
  hasAnyPersistentFile,
  purgePersistentFiles,
  type PurgeOutcome,
} from '../auth/persistent-files.js';
import { removeCommands, type RemoveCommandsResult } from './user-scope-commands.js';
import { homedir } from 'node:os';

const ALL_ADAPTERS: Record<string, ClientAdapter> = {
  [claudeCodeAdapter.key]: claudeCodeAdapter,
  [codexAdapter.key]: codexAdapter,
  [opencodeAdapter.key]: opencodeAdapter,
  [cursorAdapter.key]: cursorAdapter,
};

export type PerClientUninstallOutcome = 'removed' | 'noop' | 'dry-run' | 'failed';

export interface PerClientUninstallResult {
  client: string;
  outcome: PerClientUninstallOutcome;
  /** 目标配置文件路径;未识别客户端时为空字符串 */
  path: string;
  /** 备份提示(仅 removed 路径下、且原文件已存在时);其他场景 undefined */
  backup?: string;
  /** 失败原因(仅 outcome === 'failed' 时) */
  error?: string;
}

export interface PurgeFileResult {
  /** 'cookie' | 'token' */
  file: 'cookie' | 'token';
  outcome: 'removed' | 'not_present' | 'failed';
  path: string;
  error?: string;
}

export interface RunUninstallOptions {
  /** 已通过 select-clients 决定的最终客户端列表(非空) */
  clients: string[];
  dryRun: boolean;
  /** 是否额外清理 ~/.config/tapd-mcp/cookie 和 token 文件 */
  purge: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试钩子:覆盖 purgePersistentFiles 的 baseDir(默认 ~/.config/tapd-mcp) */
  purgeBaseDir?: string;
  /** 测试钩子:覆盖用户家目录(默认 os.homedir())，用于隔离 user-scope commands 清理目标 */
  homedirOverride?: string;
}

export interface RunUninstallResult {
  exitCode: number;
  results: PerClientUninstallResult[];
  /** purge 阶段每个文件的结果;未启用 purge 时为 undefined */
  purgeResults?: PurgeFileResult[];
}

/**
 * 单家结果格式化为汇总输出的一行。与 install 对齐:
 *   ✔ <client>  <path>             成功移除
 *   = <client>  (no-op) <path>     条目本就不存在
 *   [dry-run] <client>  <path>     dry-run
 *   ✗ <client>  <reason>           失败
 */
function formatSummaryLine(r: PerClientUninstallResult): string {
  switch (r.outcome) {
    case 'removed':
      return `✔ ${r.client}  ${r.path}`;
    case 'noop':
      return `= ${r.client}  (no-op) ${r.path}`;
    case 'dry-run':
      return `[dry-run] ${r.client}  ${r.path}`;
    case 'failed':
      return `✗ ${r.client}  ${r.error ?? '未知错误'}`;
  }
}

function formatPurgeLine(r: PurgeFileResult): string {
  switch (r.outcome) {
    case 'removed':
      return `purge: ${r.file} removed (${r.path})`;
    case 'not_present':
      return `purge: ${r.file} not present (skipped)`;
    case 'failed':
      return `purge: ${r.file} failed (${r.error ?? '未知错误'})`;
  }
}

function purgeOutcomeToFileResult(
  file: 'cookie' | 'token',
  path: string,
  outcome: PurgeOutcome,
): PurgeFileResult {
  if (outcome.status === 'failed') {
    return { file, outcome: 'failed', path, error: outcome.error };
  }
  return { file, outcome: outcome.status, path };
}

/**
 * 取当前 adapter 的 mcp 节键名,用于 dry-run 显示移除后剩余 keys。
 * 注意:这是仅用于诊断输出的内部探测,生产路径不依赖它。
 */
function inspectRemainingMcpKeys(
  adapter: ClientAdapter,
  existing: unknown,
): { sectionKey: string; remainingKeys: string[] } | undefined {
  if (!existing || typeof existing !== 'object') return undefined;
  const cfg = existing as Record<string, unknown>;
  // Codex 用 mcp_servers,其它三家用 mcpServers
  const sectionKey = adapter.key === 'codex' ? 'mcp_servers' : 'mcpServers';
  const section = cfg[sectionKey];
  if (!section || typeof section !== 'object') return undefined;
  const remaining = Object.keys(section as Record<string, unknown>).filter(
    (k) => k !== 'tapd',
  );
  return { sectionKey, remainingKeys: remaining };
}

export async function runUninstall(opts: RunUninstallOptions): Promise<RunUninstallResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  // 防御:调用方应保证 clients 非空。
  if (opts.clients.length === 0) {
    stderr.write('uninstall: 未指定任何客户端\n');
    return { exitCode: 2, results: [] };
  }

  // 早期未识别客户端检查(cli.ts 也会拒,这里作为运行时���线)
  const unknown = opts.clients.filter((c) => !ALL_ADAPTERS[c]);
  if (unknown.length > 0) {
    stderr.write(
      `未识别的客户端 ${unknown.map((c) => `"${c}"`).join(', ')}。可用:${Object.keys(
        ALL_ADAPTERS,
      ).join(' / ')}\n`,
    );
    return {
      exitCode: 2,
      results: opts.clients.map((c) => ({
        client: c,
        outcome: 'failed' as const,
        path: '',
        error: ALL_ADAPTERS[c] ? '未执行(前置参数错误)' : '未识别的客户端',
      })),
    };
  }

  // ── 1) 顺序处理每家,单家失败不中断其他家 ────────────────────────
  const results: PerClientUninstallResult[] = [];

  for (const key of opts.clients) {
    const adapter = ALL_ADAPTERS[key];
    if (!adapter) {
      // 防御性兜底,正常不会走到。
      results.push({
        client: key,
        outcome: 'failed',
        path: '',
        error: '未识别的客户端',
      });
      continue;
    }

    try {
      const target = adapter.configPath();
      const existing = await adapter.read();

      // 文件不存在 / tapd 条目不存在 → noop
      if (!adapter.hasTapdEntry(existing)) {
        if (opts.dryRun) {
          stdout.write(`[dry-run] ${adapter.displayName} 目标配置:${target}\n`);
          stdout.write('[dry-run] tapd 条目不存在,实际不会变更。\n');
          results.push({ client: key, outcome: 'dry-run', path: target });
        } else {
          stdout.write(`${adapter.displayName} tapd 条目不存在,无需变更。\n`);
          results.push({ client: key, outcome: 'noop', path: target });
        }
        continue;
      }

      // 有 tapd 条目,展示当前摘要
      const current = adapter.describeCurrent(existing);

      if (opts.dryRun) {
        stdout.write(`[dry-run] ${adapter.displayName} 目标配置:${target}\n`);
        if (current) stdout.write(`[dry-run] 当前 tapd 条目:${current}\n`);
        const probe = inspectRemainingMcpKeys(adapter, existing);
        if (probe) {
          const list = probe.remainingKeys.length > 0 ? probe.remainingKeys.join(',') : '(空)';
          stdout.write(`[dry-run] 移除后 ${probe.sectionKey} 剩余 keys: ${list}\n`);
        }
        results.push({ client: key, outcome: 'dry-run', path: target });
        continue;
      }

      // 实写路径:removeEntry + write(write 内部走 backupAndWrite)
      const next = adapter.removeEntry(existing!);
      await adapter.write(next);

      const backupHint = `<已自动备份到 ${target}.bak.<timestamp>>`;
      stdout.write(`已从 ${adapter.displayName} 移除 tapd 条目:${target}\n`);
      stdout.write(`${backupHint}\n`);

      results.push({
        client: key,
        outcome: 'removed',
        path: target,
        backup: backupHint,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      stderr.write(`卸载 ${adapter.displayName} 失败:${reason}\n`);
      results.push({
        client: key,
        outcome: 'failed',
        path: adapter.configPath(),
        error: reason,
      });
    }
  }

  // ── 1.5) v0.3.0：claude-code uninstall 时反向清理 ~/.claude/commands/tapd-server-cli/ ─
  // 与 install-claude-code-user-scope-commands change 的 install 路径对称。
  // 仅当 claude-code 客户端在 opts.clients 里、且非 dry-run 时触发。
  // namespace 视为本工具私有——递归删整目录（含用户在该 namespace 下自加的文件）。
  let userScopeCommandsResult: RemoveCommandsResult | undefined;
  if (!opts.dryRun && opts.clients.includes('claude-code')) {
    const commandsHome = opts.homedirOverride ?? homedir();
    userScopeCommandsResult = removeCommands(commandsHome);
    if (userScopeCommandsResult.removed) {
      stdout.write('✓ user-scope commands removed\n');
    } else if (userScopeCommandsResult.notPresent) {
      stdout.write('= no user-scope commands to remove\n');
    } else if (userScopeCommandsResult.error) {
      stderr.write(
        `warning: failed to remove ~/.claude/commands/tapd-server-cli/ (${userScopeCommandsResult.error})\n`,
      );
    }
  }

  // ── 2) --purge 阶段 ────────────────────────────────────────────
  let purgeResults: PurgeFileResult[] | undefined;
  if (opts.purge) {
    if (opts.dryRun) {
      // dry-run + --purge:仅列出待清理的文件路径,不实际删除
      const probe = await hasAnyPersistentFile({ baseDir: opts.purgeBaseDir });
      const baseDir = opts.purgeBaseDir; // 仅诊断用
      const cookiePath = baseDir
        ? `${baseDir.replace(/[\\/]+$/, '')}/cookie`
        : '~/.config/tapd-mcp/cookie';
      const tokenPath = baseDir
        ? `${baseDir.replace(/[\\/]+$/, '')}/token`
        : '~/.config/tapd-mcp/token';
      stdout.write(
        `[dry-run] --purge 将清理: ${cookiePath}${probe.cookie ? '' : ' (不存在)'}, ${tokenPath}${probe.token ? '' : ' (不存在)'}\n`,
      );
      // dry-run 下不写 purgeResults
    } else {
      const purge = await purgePersistentFiles({ baseDir: opts.purgeBaseDir });
      purgeResults = [
        purgeOutcomeToFileResult('cookie', purge.paths.cookie, purge.cookie),
        purgeOutcomeToFileResult('token', purge.paths.token, purge.token),
      ];
      for (const pr of purgeResults) {
        if (pr.outcome === 'failed') {
          stderr.write(`${formatPurgeLine(pr)}\n`);
        } else {
          stdout.write(`${formatPurgeLine(pr)}\n`);
        }
      }
    }
  }

  // ── 3) 未开 --purge 但实际仍有残留文件 → 末尾提示 ────────────────
  let leftoverHint: string | undefined;
  if (!opts.purge) {
    const probe = await hasAnyPersistentFile({ baseDir: opts.purgeBaseDir });
    if (probe.cookie || probe.token) {
      leftoverHint = '提示:cookie/token 文件未清除(如需清除请加 --purge)';
    }
  }

  // ── 4) 汇总报告 ────────────────────────────────────────────────
  stdout.write('\n卸载结果:\n');
  for (const r of results) {
    stdout.write(`  ${formatSummaryLine(r)}\n`);
  }
  if (purgeResults) {
    for (const pr of purgeResults) {
      stdout.write(`  ${formatPurgeLine(pr)}\n`);
    }
  }
  if (leftoverHint) {
    stdout.write(`\n${leftoverHint}\n`);
  }

  const anyRemoved = results.some((r) => r.outcome === 'removed');
  const anyDryRun = results.some((r) => r.outcome === 'dry-run');
  if (anyRemoved || anyDryRun) {
    stdout.write('\n下一步:\n');
    stdout.write('  1) 重启对应客户端(让配置生效)\n');
    if (!opts.purge && (anyRemoved || anyDryRun)) {
      stdout.write('  2) 如需清除本地 cookie/token 凭据,请加 --purge 重跑\n');
    }
  }

  // ── 5) 退出码 ──────────────────────────────────────────────────
  const anyClientFailed = results.some((r) => r.outcome === 'failed');
  const anyPurgeFailed = (purgeResults ?? []).some((r) => r.outcome === 'failed');
  const exitCode = anyClientFailed || anyPurgeFailed ? 1 : 0;

  return { exitCode, results, purgeResults };
}

export { ALL_ADAPTERS as UNINSTALL_ADAPTERS };
