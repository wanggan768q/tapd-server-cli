/**
 * `tapd-server-cli install-skills` 的 CLI wrapper。
 *
 * 把"交互式选择 client / scope"和"实际安装流程"分开，让 runInstallSkills 可单测。
 */

import { ALL_ADAPTERS } from '../installer/flow.js';
import {
  NoClientsSelectedError,
  NonInteractiveNoClientError,
  resolveClients,
  UserCancelledError,
} from '../installer/select-clients.js';

import {
  runInstallSkills,
  type InstallSkillsResult,
} from './install-skills-handler.js';

export interface InstallSkillsCliInput {
  clients: readonly string[];
  dryRun: boolean;
  scope: 'user' | 'project' | undefined;
}

export interface InstallSkillsCliResult {
  exitCode: number;
}

export async function installSkillsCommand(
  input: InstallSkillsCliInput,
): Promise<InstallSkillsCliResult> {
  const stderr = process.stderr;

  // 1. 解析客户端列表
  let clients: string[];
  try {
    clients = await resolveClients(input.clients, {
      adapters: Object.values(ALL_ADAPTERS),
      message: '选择要安装 Skill 的 MCP 客户端（空格选择，回车确认）',
      commandName: 'install-skills',
    });
  } catch (err) {
    if (err instanceof NonInteractiveNoClientError) {
      stderr.write(`${err.message}\n`);
      stderr.write('示例: tapd-server-cli install-skills claude-code codex --scope user\n');
      return { exitCode: 2 };
    }
    if (err instanceof NoClientsSelectedError) {
      stderr.write(`${err.message}\n`);
      return { exitCode: 1 };
    }
    if (err instanceof UserCancelledError) {
      stderr.write(`${err.message}\n`);
      return { exitCode: 130 };
    }
    throw err;
  }

  // 2. 解析 scope
  const scope = await resolveScope(input.scope);
  if (scope === undefined) {
    return { exitCode: 2 };
  }

  // 3. 解析 PAT（沿用 install 的一套：env / token 文件 / 交互）
  // 注：install-skills 不主动收集 PAT；如果 cache.json 存在就不需要 token。
  // 如果 cache.json 缺失，handler 内部会用 env.TAPD_TOKEN（没有则返回空字符串，让 handler 再做判断）。
  const token = process.env.TAPD_TOKEN ?? '';

  const result = await runInstallSkills({
    clients: clients as InstallSkillsClientArray,
    scope,
    dryRun: input.dryRun,
    token,
  });

  return { exitCode: result.exitCode };
}

type InstallSkillsClientArray = Parameters<typeof runInstallSkills>[0]['clients'];

async function resolveScope(
  explicit: 'user' | 'project' | undefined,
): Promise<'user' | 'project' | undefined> {
  if (explicit) return explicit;

  const isStdinTty = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  const isStdoutTty = Boolean((process.stdout as { isTTY?: boolean }).isTTY);
  if (!isStdinTty || !isStdoutTty) {
    process.stderr.write(
      `非交互环境下必须显式 --scope user|project。\n示例: tapd-server-cli install-skills claude-code --scope user\n`,
    );
    return undefined;
  }

  const mod = await import('@inquirer/checkbox');
  // 用 inquirer 的 select 而不是 checkbox（单选）。包内未直接导出 select，借用 checkbox 单选语义。
  // 简化：让用户用 checkbox 选一项；选 ≥1 个时取第一个。
  const result = await mod.default({
    message: '安装到哪里？',
    choices: [
      { value: 'user', name: '用户级 (~/.claude/skills 等)' },
      { value: 'project', name: '项目级 (./.claude/skills 等)' },
    ],
  });
  if (result.length === 0) return undefined;
  const v = result[0]!;
  return v === 'project' ? 'project' : 'user';
}
