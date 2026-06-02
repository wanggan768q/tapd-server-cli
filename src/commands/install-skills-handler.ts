/**
 * `tapd-server-cli install-skills` handler。
 *
 * 与现有 `install` 子命令独立：本流程不写 mcpServers.tapd，不收集 PAT 用于 install
 * 而是用 PAT 引导探测 cache.json。
 *
 * 流程概览（spec mcp-skills.Requirement install-skills 子命令）：
 *   1. 解析 scope（user / project，按 TTY 与 cwd 是否在 git 仓库给推荐）
 *   2. 读 ~/.tapd/cache.json；不存在则用 PAT 探测 whoami + list_workspaces 写一次
 *      （探测 401 → 退出码 1，不写任何文件）
 *   3. 多 workspace 时弹 select 选默认 ws（首次安装；后续如需改请 reinstall）
 *   4. 加载 dist/skills/*.md.tmpl，渲染（占位符替换）
 *   5. 计算每个 skill 的 sha256
 *   6. 升级冲突检测：磁盘 hash ≠ config.json 记录 → 询问 keep/overwrite/show diff
 *   7. 写 Claude Code 的 SKILL.md（如果 client 含 claude-code）
 *   8. 写各客户端的 managed block / .mdc 全文
 *   9. 写 tapd.config.json（含每个 skill 的 sha256）
 *   10. 项目级时把 .tapd/ 加进 .gitignore
 *   11. 输出汇总
 *
 * --dry-run：所有写操作改为 stdout 打印目标 + 摘要，不动磁盘。
 */

import { createHash } from 'node:crypto';
import { promises as fs, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pino from 'pino';

import type { TapdHttpClient } from '../api/client.js';
import { fetchIdentity, type Identity } from '../auth/identity.js';
import type { WorkspaceEntry } from '../permissions/snapshot.js';
import { fetchAccessibleWorkspaces } from '../permissions/workspaces.js';
import {
  cacheJsonPath,
  tapdConfigPath,
  tapdDirForScope,
  type PathOverrides,
} from '../runtime/paths.js';
import {
  readCache,
  SUPPORTED_SCHEMA_VERSION as CACHE_VERSION,
  writeCache,
  type TapdCache,
} from '../runtime/cache-store.js';
import {
  IncompatibleConfigError,
  mergeSkillEntries,
  readTapdConfig,
  SUPPORTED_SCHEMA_VERSION as CONFIG_VERSION,
  writeTapdConfig,
  type SkillEntry,
  type TapdConfig,
} from '../runtime/config-store.js';
import { renderTemplate, type RenderContext } from '../skills/render.js';

import {
  BEGIN_MARK,
  END_MARK,
  injectManagedBlock,
} from '../installer/agents-md.js';
import { writeCursorMdc } from '../installer/cursor-mdc.js';
import {
  resolveClientPaths,
  type ClientKey,
  type Scope,
} from '../installer/skill-client-paths.js';

type OutcomeKind =
  | 'wrote'
  | 'skipped-user-modified'
  | 'backed-up-then-wrote'
  | 'failed'
  | 'dry-run';

export interface InstallSkillsResult {
  exitCode: number;
  perClient: Array<{ client: ClientKey; outcome: OutcomeKind; detail?: string }>;
  skillCount: number;
  /** 真实磁盘上写下了多少 SKILL.md（Claude Code only）。 */
  skillFilesWritten: number;
  scope: Scope;
}

export interface InstallSkillsInput {
  clients: readonly ClientKey[];
  scope: Scope;
  dryRun: boolean;
  /** TAPD PAT，用于在 cache.json 不存在时探测身份。 */
  token: string;
  /** 测试用：注入 home 路径。 */
  pathOverrides?: PathOverrides;
  /** 测试用：注入 HTTP client 工厂（mock TAPD 探测）。 */
  httpClientFactory?: (token: string) => TapdHttpClient;
  /** 测试用：注入 dist/skills 模板根目录。 */
  templatesDir?: string;
  /** 测试用：注入"默认 workspace 选择器"（多 ws 时调用）。 */
  pickDefaultWorkspace?: (ws: readonly WorkspaceEntry[]) => Promise<string | undefined>;
  /** 测试用：注入"升级冲突解决"（默认非交互 keep）。 */
  resolveConflict?: (info: ConflictInfo) => Promise<'keep' | 'overwrite'>;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface ConflictInfo {
  skillName: string;
  filePath: string;
  recordedSha: string;
  diskSha: string;
}

export class InstallSkillsAuthError extends Error {
  override readonly name = 'InstallSkillsAuthError';
  override readonly cause: string;
  constructor(cause: string) {
    super(
      `无法初始化 cache.json：调用 TAPD API 返回认证失败。请检查 TAPD_TOKEN 是否有效（${cause}）`,
    );
    this.cause = cause;
  }
}

const PACKAGE_VERSION = readPackageVersion();

export async function runInstallSkills(input: InstallSkillsInput): Promise<InstallSkillsResult> {
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const writeOut = (msg: string) => stdout.write(msg);

  // === Step 1: cache.json 引导探测 ===
  const cachePath = cacheJsonPath('user', input.pathOverrides);
  let cache = await readCache(cachePath).catch(() => undefined);
  if (!cache) {
    if (input.dryRun) {
      // dry-run 时也不发 API；用占位 cache 让流程能继续
      cache = stubCache();
      writeOut(`[dry-run] 跳过 whoami/list_workspaces 探测（占位 identity 用于预览）\n`);
    } else {
      writeOut(`[install-skills] cache.json 不存在，调用 TAPD 探测 identity + workspaces...\n`);
      try {
        cache = await probeCache(input);
      } catch (err) {
        if (err instanceof InstallSkillsAuthError) {
          stderr.write(`${err.message}\n`);
          return finalResult({
            exitCode: 1,
            perClient: [],
            skillCount: 0,
            skillFilesWritten: 0,
            scope: input.scope,
          });
        }
        throw err;
      }
      if (!input.dryRun) {
        await writeCache(cachePath, cache);
        writeOut(`[install-skills] cache.json 写入 ${cachePath}\n`);
      }
    }
  }

  // === Step 2: 多 workspace 选默认 ===
  let defaultWorkspaceId: string | undefined;
  if (cache.workspaces.length === 1) {
    defaultWorkspaceId = cache.workspaces[0]!.id;
  } else if (input.pickDefaultWorkspace) {
    defaultWorkspaceId = await input.pickDefaultWorkspace(
      cache.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        category: w.role ?? '',
      })),
    );
  } else {
    // 非交互/未注入选择器 → 不设默认，让 skill 在对话中询问
    defaultWorkspaceId = undefined;
  }

  // === Step 3: 加载模板 + 渲染 ===
  const templatesDir = input.templatesDir ?? defaultTemplatesDir();
  const templates = loadTemplates(templatesDir);
  if (templates.length === 0) {
    stderr.write(`找不到 skill 模板：${templatesDir}\n`);
    return finalResult({
      exitCode: 1,
      perClient: [],
      skillCount: 0,
      skillFilesWritten: 0,
      scope: input.scope,
    });
  }

  const renderCtx: RenderContext = {
    identity: {
      tapdUserName: cache.identity.tapdUserName,
      tapdUserId: cache.identity.tapdUserId,
      ...(cache.identity.tapdEmail ? { tapdEmail: cache.identity.tapdEmail } : {}),
    },
    workspaces: cache.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      ...(w.role ? { role: w.role } : {}),
    })),
    role: 'user',
    installedAt: new Date().toISOString(),
    ...(defaultWorkspaceId ? { defaultWorkspaceId } : {}),
  };

  const rendered: RenderedSkill[] = templates.map((t) => {
    const out = renderTemplate(t.body, renderCtx);
    return {
      name: t.name,
      content: out.output,
      sha256: sha256Hex(out.output),
    };
  });

  // === Step 4: 读旧 config（用于升级冲突检测） ===
  const configPath = tapdConfigPath(input.scope, input.pathOverrides);
  let priorConfig: TapdConfig | undefined;
  try {
    priorConfig = await readTapdConfig(configPath);
  } catch (err) {
    if (err instanceof IncompatibleConfigError) {
      stderr.write(`${err.message}\n`);
      return finalResult({
        exitCode: 1,
        perClient: [],
        skillCount: 0,
        skillFilesWritten: 0,
        scope: input.scope,
      });
    }
    throw err;
  }

  // === Step 5: 写各客户端 ===
  const perClient: InstallSkillsResult['perClient'] = [];
  let skillFilesWritten = 0;
  const newSkillEntries: SkillEntry[] = [];

  for (const client of input.clients) {
    try {
      const paths = resolveClientPaths({
        client,
        scope: input.scope,
        homeOverride: input.pathOverrides?.homeOverride,
        cwdOverride: input.pathOverrides?.cwdOverride,
      });

      if (input.dryRun) {
        writeOut(`[dry-run] ${client}: 将写入 ${paths.rulesFile}\n`);
        if (paths.skillsDir) {
          writeOut(`[dry-run] ${client}: 将写入 ${paths.skillsDir}/tapd-*/SKILL.md (共 ${rendered.length} 个)\n`);
        }
        perClient.push({ client, outcome: 'dry-run' });
        continue;
      }

      // Claude Code: 写 SKILL.md 文件
      if (paths.skillsDir) {
        for (const s of rendered) {
          const target = join(paths.skillsDir, s.name, 'SKILL.md');
          const writeResult = await writeSkillFileWithConflictCheck({
            target,
            content: s.content,
            recordedSha: priorConfig?.skills.find((e) => e.name === s.name)?.writtenSha256,
            resolveConflict: input.resolveConflict,
            stdout,
          });
          if (writeResult === 'wrote' || writeResult === 'backed-up-then-wrote') {
            skillFilesWritten++;
            newSkillEntries.push({
              name: s.name,
              version: PACKAGE_VERSION,
              writtenSha256: s.sha256,
              path: target,
            });
          } else if (writeResult === 'skipped') {
            // 保留旧记录（如有）
            const old = priorConfig?.skills.find((e) => e.name === s.name);
            if (old) newSkillEntries.push(old);
          }
        }
      }

      // 写 managed block / mdc
      if (paths.usesManagedBlock) {
        const block = renderManagedBlock({
          identity: cache.identity,
          role: 'user',
          clients: input.clients,
          defaultWorkspaceId,
          skills: rendered,
          // claude-code 走"skill 引用 + 摘要"；其它走"内嵌全文"
          inlineFullSkills: client !== 'claude-code',
        });
        await injectManagedBlock(paths.rulesFile, block);
      } else {
        // Cursor
        await writeCursorMdc(paths.rulesFile, {
          description: cursorDescription(),
          body: renderManagedBlock({
            identity: cache.identity,
            role: 'user',
            clients: input.clients,
            defaultWorkspaceId,
            skills: rendered,
            inlineFullSkills: true,
          }),
        });
      }

      perClient.push({ client, outcome: 'wrote' });
    } catch (err) {
      perClient.push({
        client,
        outcome: 'failed',
        detail: (err as Error).message,
      });
    }
  }

  // === Step 6: 写 tapd.config.json ===
  if (!input.dryRun) {
    const merged = mergeSkillEntries(priorConfig?.skills ?? [], newSkillEntries);
    const config: TapdConfig = {
      schemaVersion: CONFIG_VERSION,
      version: PACKAGE_VERSION,
      installedAt: new Date().toISOString(),
      scope: input.scope,
      role: 'user',
      clients: dedupeClients([...(priorConfig?.clients ?? []), ...input.clients]),
      skills: merged,
      ...(defaultWorkspaceId
        ? { defaults: { workspaceId: defaultWorkspaceId } }
        : priorConfig?.defaults
          ? { defaults: priorConfig.defaults }
          : {}),
    };
    await writeTapdConfig(configPath, config);
    writeOut(`[install-skills] tapd.config.json 写入 ${configPath}\n`);
  } else {
    writeOut(`[dry-run] 将写入 ${configPath}\n`);
  }

  // === Step 7: 项目级时维护 .gitignore ===
  if (input.scope === 'project' && !input.dryRun) {
    await maintainGitignore({
      projectRoot: input.pathOverrides?.cwdOverride ?? process.cwd(),
      stdout,
    });
  }

  // === Step 8: 汇总 ===
  const failed = perClient.filter((r) => r.outcome === 'failed').length;
  writeOut(formatSummary(perClient));
  return finalResult({
    exitCode: failed > 0 ? 1 : 0,
    perClient,
    skillCount: rendered.length,
    skillFilesWritten,
    scope: input.scope,
  });
}

// ====================== 辅助函数 ======================

function finalResult(r: InstallSkillsResult): InstallSkillsResult {
  return r;
}

interface RenderedSkill {
  name: string;
  content: string;
  sha256: string;
}

interface SkillTemplate {
  name: string;
  body: string;
}

function defaultTemplatesDir(): string {
  // dist/skills 与编译后的此文件同级（dist/commands → dist/skills）
  // 注：开发时 tsx 跑的是 src/，而 src/skills 也有 .md.tmpl（与 dist 同源）
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'skills'),
    resolve(here, '..', '..', 'dist', 'skills'),
    resolve(here, '..', '..', 'src', 'skills'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!;
}

function loadTemplates(dir: string): SkillTemplate[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SkillTemplate[] = [];
  for (const f of entries) {
    if (!f.endsWith('.md.tmpl')) continue;
    const body = readFileSync(join(dir, f), 'utf8');
    out.push({
      name: f.replace(/\.md\.tmpl$/, ''),
      body,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function stubCache(): TapdCache {
  return {
    schemaVersion: CACHE_VERSION,
    writtenAt: new Date().toISOString(),
    identity: { tapdUserName: '<unknown>', tapdUserId: '0' },
    workspaces: [],
  };
}

async function probeCache(input: InstallSkillsInput): Promise<TapdCache> {
  const factory = input.httpClientFactory ?? defaultHttpClientFactory;
  const client = factory(input.token);
  let identity: Identity;
  let workspaces: WorkspaceEntry[];
  try {
    identity = await fetchIdentity(client, input.token);
    workspaces = await fetchAccessibleWorkspaces(client);
  } catch (err) {
    const msg = (err as Error).message;
    if (/401|403|unauthenticated/i.test(msg)) {
      throw new InstallSkillsAuthError(msg);
    }
    throw err;
  } finally {
    if ('close' in client && typeof (client as { close?: () => Promise<void> }).close === 'function') {
      await (client as { close: () => Promise<void> }).close().catch(() => {});
    }
  }
  return {
    schemaVersion: CACHE_VERSION,
    writtenAt: new Date().toISOString(),
    identity: {
      tapdUserName: identity.userName,
      tapdUserId: identity.userId,
      ...(identity.email ? { tapdEmail: identity.email } : {}),
    },
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      ...(w.category ? { role: w.category } : {}),
    })),
  };
}

function defaultHttpClientFactory(token: string): TapdHttpClient {
  // 延迟 import：require() 避免循环引用 + 不强制 install 时拉 api/client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createTapdHttpClient } = require('../api/client.js') as typeof import('../api/client.js');
  return createTapdHttpClient({
    apiBase: 'https://api.tapd.cn',
    token,
    concurrency: 4,
    timeoutMs: 30000,
    logger: pino({ level: 'silent' }),
  });
}

async function writeSkillFileWithConflictCheck(input: {
  target: string;
  content: string;
  recordedSha: string | undefined;
  resolveConflict?: InstallSkillsInput['resolveConflict'];
  stdout: NodeJS.WritableStream;
}): Promise<'wrote' | 'backed-up-then-wrote' | 'skipped'> {
  const existing = await fs.readFile(input.target, 'utf8').catch(() => undefined);
  if (existing === undefined) {
    // 首次写
    await fs.mkdir(dirname(input.target), { recursive: true });
    await atomicWrite(input.target, input.content);
    return 'wrote';
  }

  const diskSha = sha256Hex(existing);
  if (input.recordedSha && diskSha === input.recordedSha) {
    // hash 一致 → 用户没改过 → 直接覆盖
    await atomicWrite(input.target, input.content);
    return 'wrote';
  }
  if (existing === input.content) {
    // 内容相同（可能初装 / 已是最新）
    return 'wrote';
  }

  // 用户改过：根据 resolveConflict 决定
  const decision = input.resolveConflict
    ? await input.resolveConflict({
        skillName: input.target,
        filePath: input.target,
        recordedSha: input.recordedSha ?? '<unknown>',
        diskSha,
      })
    : 'keep'; // 非交互默认 keep

  if (decision === 'keep') {
    input.stdout.write(`[install-skills] 已跳过本地修改过的: ${input.target}\n`);
    return 'skipped';
  }

  // overwrite：先 .bak 再覆盖
  const bak = `${input.target}.bak.${Date.now()}`;
  await fs.copyFile(input.target, bak);
  await atomicWrite(input.target, input.content);
  input.stdout.write(`[install-skills] 已备份到 ${bak} 后覆盖 ${input.target}\n`);
  return 'backed-up-then-wrote';
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, filePath);
}

function dedupeClients(list: readonly string[]): ClientKey[] {
  const seen = new Set<ClientKey>();
  const out: ClientKey[] = [];
  for (const v of list) {
    if ((v === 'claude-code' || v === 'codex' || v === 'cursor' || v === 'opencode') && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function maintainGitignore(input: {
  projectRoot: string;
  stdout: NodeJS.WritableStream;
}): Promise<void> {
  const gi = join(input.projectRoot, '.gitignore');
  let existing: string;
  try {
    existing = await fs.readFile(gi, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    existing = '';
  }
  const lines = existing.split(/\r?\n/);
  if (lines.some((l) => l.trim() === '.tapd/' || l.trim() === '.tapd')) {
    return; // 已含
  }
  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const next = `${existing}${sep}# tapd-server-cli skills (local config + cache)\n.tapd/\n`;
  await fs.writeFile(gi, next, 'utf8');
  input.stdout.write(`[install-skills] 已把 .tapd/ 加入 ${gi}\n`);
}

// ====================== 内容渲染 ======================

interface RenderManagedBlockInput {
  identity: TapdCache['identity'];
  role: 'user';
  clients: readonly ClientKey[];
  defaultWorkspaceId: string | undefined;
  skills: readonly RenderedSkill[];
  /** true 时把每个 skill 的全文塞进 block；false 时只放摘要 + 引用路径。 */
  inlineFullSkills: boolean;
}

function renderManagedBlock(input: RenderManagedBlockInput): string {
  const head = [
    '## TAPD MCP Skills (auto-managed by tapd-server-cli)',
    '',
    `Installed role: ${input.role}`,
    `Current TAPD user: ${input.identity.tapdUserName} (id: ${input.identity.tapdUserId})`,
    input.defaultWorkspaceId
      ? `Default workspace: ${input.defaultWorkspaceId}`
      : 'Default workspace: (ask user each time)',
    `Clients: ${input.clients.join(', ')}`,
    '',
    '### Hard rules (cannot be overridden)',
    '1. NEVER delete any TAPD entity (no `tapd_*_delete` tool).',
    '2. NEVER set bug status to `closed`; mark as `resolved` instead.',
    '3. Normal users MUST NOT call `tapd_tasks_create`.',
    '4. All writes except comments need a preview + explicit user confirmation.',
    '5. Bulk write operations are capped at 10 entities per confirmation.',
    '',
    `### Skills installed (${input.skills.length})`,
    ...input.skills.map((s) => `- ${s.name}`),
  ].join('\n');

  if (!input.inlineFullSkills) {
    return `${head}\n\n_Full skill content lives in \`~/.claude/skills/tapd-*/SKILL.md\` and is loaded by Claude Code automatically._\n`;
  }

  const sections = input.skills
    .map((s) => `### Skill: ${s.name}\n\n${s.content.trim()}`)
    .join('\n\n');
  return `${head}\n\n---\n\n${sections}\n`;
}

function cursorDescription(): string {
  return [
    'English triggers: tapd, tapd mcp, tapd skills, tapd workflow.',
    '中文触发：tapd、tapd 技能、tapd 工作流。',
  ].join('\n');
}

function formatSummary(perClient: InstallSkillsResult['perClient']): string {
  if (perClient.length === 0) return '[install-skills] 无客户端处理。\n';
  const lines = perClient.map((r) => {
    switch (r.outcome) {
      case 'wrote':
        return `  ✔ ${r.client}: wrote`;
      case 'backed-up-then-wrote':
        return `  ✔ ${r.client}: backed-up then wrote`;
      case 'skipped-user-modified':
        return `  = ${r.client}: kept user modifications`;
      case 'dry-run':
        return `  [dry-run] ${r.client}`;
      case 'failed':
        return `  ✗ ${r.client}: ${r.detail ?? 'failed'}`;
    }
  });
  return `[install-skills] summary:\n${lines.join('\n')}\n`;
}

function readPackageVersion(): string {
  try {
    // 编译后位置：dist/commands/install-skills-handler.js → dist/../package.json
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '..', '..', 'package.json'),
      resolve(here, '..', '..', '..', 'package.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    // ignore
  }
  return '0.0.0-dev';
}

// 提供 BEGIN/END 给测试断言，避免到处 import
export { BEGIN_MARK, END_MARK };
