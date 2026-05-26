/**
 * Install 子命令主流程：
 *   1) 选定适配器（key → adapter）
 *   2) 收 PAT（tty 交互或 TAPD_TOKEN env）
 *   3) 读现有配置 → merge → 判断 idempotent
 *   4) 写入（backup + atomic rename），或 dry-run 打印
 *   5) 输出下一步提示（重启客户端 + 跑 /mcp__tapd__setup）
 */

import { claudeCodeAdapter } from './adapters/claude-code.js';
import { codexAdapter } from './adapters/codex.js';
import { cursorAdapter } from './adapters/cursor.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { promptToken, TokenInputError, type PromptOptions } from './prompt.js';
import { type ClientAdapter } from './adapter.js';

const ALL_ADAPTERS: Record<string, ClientAdapter> = {
  [claudeCodeAdapter.key]: claudeCodeAdapter,
  [codexAdapter.key]: codexAdapter,
  [opencodeAdapter.key]: opencodeAdapter,
  [cursorAdapter.key]: cursorAdapter,
};

export interface RunInstallOptions {
  client: string;
  dryRun: boolean;
  /** 测试钩子 */
  promptOptions?: PromptOptions;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试用：覆盖 token 输入（跳过交互） */
  tokenOverride?: string;
}

export interface RunInstallResult {
  exitCode: number;
  /** 真实写入路径（dry-run 时为目标路径） */
  path: string;
  /** 备份路径（如有） */
  backup: string | undefined;
  /** 'wrote' | 'noop' | 'dry-run' */
  outcome: 'wrote' | 'noop' | 'dry-run';
}

export async function runInstall(opts: RunInstallOptions): Promise<RunInstallResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const adapter = ALL_ADAPTERS[opts.client];
  if (!adapter) {
    stderr.write(`未识别的客户端 "${opts.client}"。可用：${Object.keys(ALL_ADAPTERS).join(' / ')}\n`);
    return {
      exitCode: 2,
      path: '',
      backup: undefined,
      outcome: 'noop',
    };
  }

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
      return { exitCode: 1, path: '', backup: undefined, outcome: 'noop' };
    }
    throw err;
  }

  const tapdEnv: Record<string, string> = {
    TAPD_TOKEN: token,
    TAPD_LOG_LEVEL: 'info',
  };

  const existing = await adapter.read();
  const isUpToDate = adapter.isUpToDate(existing, tapdEnv);
  const merged = adapter.merge(existing, tapdEnv);
  const target = adapter.configPath();

  if (opts.dryRun) {
    stdout.write(`[dry-run] ${adapter.displayName} 目标配置：${target}\n`);
    stdout.write(`[dry-run] 将写入：${adapter.describeNext(tapdEnv)}\n`);
    const current = adapter.describeCurrent(existing);
    if (current) stdout.write(`[dry-run] 当前配置：${current}\n`);
    if (isUpToDate) stdout.write('[dry-run] 配置已是最新，实际不会变更。\n');
    return { exitCode: 0, path: target, backup: undefined, outcome: 'dry-run' };
  }

  if (isUpToDate) {
    stdout.write(`${adapter.displayName} 配置已是最新，无需变更。\n`);
    return { exitCode: 0, path: target, backup: undefined, outcome: 'noop' };
  }

  // 写之前 adapter.write 自己负责 backup + atomic，我们只查它的返回行为
  // 这里捕获写入完成后的 backup 信息：让 adapter.write 内部已经备份了，
  // 我们没法直接拿到 backup 路径。为了输出一致性，再做一次手动判定 / 改造。
  // ↓ 改为：先 stat 看文件存在与否，由 flow 自己决定提示
  const beforeExists = existing !== undefined;
  await adapter.write(merged);
  const backupHint = beforeExists ? `<已自动备份到 ${target}.bak.<timestamp>>` : undefined;

  stdout.write(`已写入 ${adapter.displayName} 配置：${target}\n`);
  if (backupHint) stdout.write(`${backupHint}\n`);
  stdout.write('\n下一步：\n');
  stdout.write(`  1) 重启 ${adapter.displayName}（让新的 MCP 配置生效）\n`);
  stdout.write('  2) 在新会话里输入 /mcp__tapd__setup 完成 cookie 登录（首次安装）\n');

  return {
    exitCode: 0,
    path: target,
    backup: backupHint,
    outcome: 'wrote',
  };
}

export { ALL_ADAPTERS };
