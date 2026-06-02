/**
 * `tapd-server-cli uninstall-skills` handler。
 *
 * 反向清理 install-skills 写入的产物：
 *   1. 删除 SKILL.md 文件（按 tapd.config.json 记录；改过的 → mv 到 .bak）
 *   2. 移除 AGENTS.md / CLAUDE.md 中的 managed block
 *   3. 删除 .cursor/rules/tapd.mdc
 *   4. 删除 tapd.config.json
 *   5. （可选 --purge-cache）删除 cache.json
 *
 * 不收集 PAT，不调任何 TAPD API。
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import {
  cacheJsonPath,
  tapdConfigPath,
  type PathOverrides,
} from '../runtime/paths.js';
import {
  IncompatibleConfigError,
  readTapdConfig,
} from '../runtime/config-store.js';

import { removeManagedBlock } from '../installer/agents-md.js';
import { removeCursorMdc } from '../installer/cursor-mdc.js';
import {
  resolveClientPaths,
  type ClientKey,
  type Scope,
} from '../installer/skill-client-paths.js';

type ClientOutcome = 'noop' | 'cleaned' | 'kept-modified' | 'failed' | 'dry-run';

export interface UninstallSkillsResult {
  exitCode: number;
  perClient: Array<{ client: ClientKey; outcome: ClientOutcome; detail?: string }>;
  configRemoved: boolean;
  cacheRemoved: boolean;
}

export interface UninstallSkillsInput {
  clients: readonly ClientKey[];
  scope: Scope;
  dryRun: boolean;
  purgeCache: boolean;
  pathOverrides?: PathOverrides;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export async function runUninstallSkills(
  input: UninstallSkillsInput,
): Promise<UninstallSkillsResult> {
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const writeOut = (msg: string) => stdout.write(msg);

  const configPath = tapdConfigPath(input.scope, input.pathOverrides);
  const cachePath = cacheJsonPath('user', input.pathOverrides);

  // 读 config 拿 sha 记录（用于检测用户改过的 SKILL.md）
  const config = await readTapdConfig(configPath).catch((err) => {
    if (err instanceof IncompatibleConfigError) {
      stderr.write(`${err.message}\n`);
      return undefined;
    }
    throw err;
  });

  const perClient: UninstallSkillsResult['perClient'] = [];

  for (const client of input.clients) {
    try {
      const paths = resolveClientPaths({
        client,
        scope: input.scope,
        homeOverride: input.pathOverrides?.homeOverride,
        cwdOverride: input.pathOverrides?.cwdOverride,
      });

      let cleanedSomething = false;
      let keptUserModified = false;

      // SKILL.md 清理（仅 Claude Code）
      if (paths.skillsDir && config) {
        for (const skill of config.skills) {
          // 只清当前 client 范围内、确实归这次安装管的 SKILL.md
          if (!skill.path.startsWith(paths.skillsDir)) continue;

          const result = await cleanSkillFile({
            target: skill.path,
            recordedSha: skill.writtenSha256,
            dryRun: input.dryRun,
            stdout,
          });
          if (result === 'removed' || result === 'backed-up') cleanedSomething = true;
          if (result === 'backed-up') keptUserModified = true;
        }
      }

      // managed block 或 .mdc
      if (paths.usesManagedBlock) {
        if (input.dryRun) {
          writeOut(`[dry-run] ${client}: 将从 ${paths.rulesFile} 移除 managed block\n`);
        } else {
          const removed = await removeManagedBlock(paths.rulesFile);
          if (removed) cleanedSomething = true;
        }
      } else {
        if (input.dryRun) {
          writeOut(`[dry-run] ${client}: 将删除 ${paths.rulesFile}\n`);
        } else {
          const removed = await removeCursorMdc(paths.rulesFile);
          if (removed) cleanedSomething = true;
        }
      }

      const outcome: ClientOutcome = input.dryRun
        ? 'dry-run'
        : keptUserModified
          ? 'kept-modified'
          : cleanedSomething
            ? 'cleaned'
            : 'noop';
      perClient.push({ client, outcome });
    } catch (err) {
      perClient.push({
        client,
        outcome: 'failed',
        detail: (err as Error).message,
      });
    }
  }

  // 删除 tapd.config.json
  let configRemoved = false;
  if (input.dryRun) {
    writeOut(`[dry-run] 将删除 ${configPath}\n`);
  } else {
    configRemoved = await safeUnlink(configPath);
    if (configRemoved) writeOut(`[uninstall-skills] 已删除 ${configPath}\n`);
  }

  // 删除 cache.json（仅 --purge-cache）
  let cacheRemoved = false;
  if (input.purgeCache) {
    if (input.dryRun) {
      writeOut(`[dry-run] 将删除 ${cachePath}\n`);
    } else {
      cacheRemoved = await safeUnlink(cachePath);
      if (cacheRemoved) writeOut(`[uninstall-skills] 已删除 ${cachePath}\n`);
    }
  } else if (!input.dryRun) {
    writeOut(
      `[uninstall-skills] 提示: cache.json 未删除（${cachePath}）；如需一并清理请加 --purge-cache\n`,
    );
  }

  // 汇总
  const failed = perClient.filter((r) => r.outcome === 'failed').length;
  writeOut(formatSummary(perClient));

  return {
    exitCode: failed > 0 ? 1 : 0,
    perClient,
    configRemoved,
    cacheRemoved,
  };
}

async function cleanSkillFile(input: {
  target: string;
  recordedSha: string;
  dryRun: boolean;
  stdout: NodeJS.WritableStream;
}): Promise<'absent' | 'removed' | 'backed-up'> {
  let existing: string;
  try {
    existing = await fs.readFile(input.target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw err;
  }

  if (input.dryRun) {
    input.stdout.write(`[dry-run] 将处理 ${input.target}\n`);
    return 'removed';
  }

  const diskSha = sha256Hex(existing);
  if (diskSha === input.recordedSha) {
    await fs.unlink(input.target);
    input.stdout.write(`[uninstall-skills] 已删除 ${input.target}\n`);
    return 'removed';
  }

  // 用户改过 → 备份后再删除原文件
  const bak = `${input.target}.bak.${Date.now()}`;
  await fs.rename(input.target, bak);
  input.stdout.write(`[uninstall-skills] ${input.target} 被本地修改过，已备份到 ${bak}\n`);
  return 'backed-up';
}

async function safeUnlink(path: string): Promise<boolean> {
  try {
    await fs.unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function formatSummary(perClient: UninstallSkillsResult['perClient']): string {
  if (perClient.length === 0) return '[uninstall-skills] 无客户端处理。\n';
  const lines = perClient.map((r) => {
    switch (r.outcome) {
      case 'cleaned':
        return `  ✔ ${r.client}: cleaned`;
      case 'kept-modified':
        return `  ✔ ${r.client}: cleaned, kept user-modified files as .bak`;
      case 'noop':
        return `  = ${r.client}: nothing to clean`;
      case 'dry-run':
        return `  [dry-run] ${r.client}`;
      case 'failed':
        return `  ✗ ${r.client}: ${r.detail ?? 'failed'}`;
    }
  });
  return `[uninstall-skills] summary:\n${lines.join('\n')}\n`;
}
