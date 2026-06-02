/**
 * `tapd-server-cli uninstall-skills` 的 CLI wrapper。
 */

import { UNINSTALL_ADAPTERS } from '../installer/uninstall-flow.js';
import {
  NoClientsSelectedError,
  NonInteractiveNoClientError,
  resolveClients,
  UserCancelledError,
} from '../installer/select-clients.js';

import {
  runUninstallSkills,
  type UninstallSkillsInput,
} from './uninstall-skills-handler.js';

export interface UninstallSkillsCliInput {
  clients: readonly string[];
  dryRun: boolean;
  scope: 'user' | 'project' | undefined;
  purgeCache: boolean;
}

export interface UninstallSkillsCliResult {
  exitCode: number;
}

export async function uninstallSkillsCommand(
  input: UninstallSkillsCliInput,
): Promise<UninstallSkillsCliResult> {
  const stderr = process.stderr;

  let clients: string[];
  try {
    clients = await resolveClients(input.clients, {
      adapters: Object.values(UNINSTALL_ADAPTERS),
      message: '选择要卸载 Skill 的 MCP 客户端（空格选择，回车确认）',
      commandName: 'uninstall-skills',
    });
  } catch (err) {
    if (err instanceof NonInteractiveNoClientError) {
      stderr.write(`${err.message}\n`);
      stderr.write('示例: tapd-server-cli uninstall-skills claude-code codex --scope user\n');
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

  const scope = await resolveScope(input.scope);
  if (scope === undefined) return { exitCode: 2 };

  const result = await runUninstallSkills({
    clients: clients as UninstallSkillsInput['clients'],
    scope,
    dryRun: input.dryRun,
    purgeCache: input.purgeCache,
  });

  return { exitCode: result.exitCode };
}

async function resolveScope(
  explicit: 'user' | 'project' | undefined,
): Promise<'user' | 'project' | undefined> {
  if (explicit) return explicit;

  const isStdinTty = Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  const isStdoutTty = Boolean((process.stdout as { isTTY?: boolean }).isTTY);
  if (!isStdinTty || !isStdoutTty) {
    process.stderr.write(
      `非交互环境下必须显式 --scope user|project。\n示例: tapd-server-cli uninstall-skills claude-code --scope user\n`,
    );
    return undefined;
  }

  const mod = await import('@inquirer/checkbox');
  const result = await mod.default({
    message: '从哪里卸载？',
    choices: [
      { value: 'user', name: '用户级' },
      { value: 'project', name: '项目级' },
    ],
  });
  if (result.length === 0) return undefined;
  const v = result[0]!;
  return v === 'project' ? 'project' : 'user';
}
