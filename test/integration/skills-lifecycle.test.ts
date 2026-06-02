/**
 * Skills CLI 端到端集成测试。
 *
 * 与 `test/unit/skills-cli-handlers.test.ts` 的区别：
 *   - 单测用合成 templates；这里用 **dist/skills/ 下真实发布的 10 个模板**。
 *   - 单测一个个测路径；这里跑完整生命周期：install → 重跑（幂等）→
 *     用户改文件 → 再跑 install（resolveConflict） → uninstall → 再跑
 *     uninstall（noop）→ purge-cache。
 *   - 单测只用 1-2 个 client；这里全 4 家客户端 + user/project 两种 scope
 *     都验证一次。
 *
 * 不依赖真实 TAPD（用 seedCache 注入身份），所以无需 TAPD_TOKEN 即可跑。
 */

import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runInstallSkills,
  type InstallSkillsInput,
} from '../../src/commands/install-skills-handler.js';
import { runUninstallSkills } from '../../src/commands/uninstall-skills-handler.js';
import { BEGIN_MARK, END_MARK } from '../../src/installer/agents-md.js';
import { writeCache } from '../../src/runtime/cache-store.js';
import {
  cacheJsonPath,
  TAPD_DIR_NAME,
  tapdConfigPath,
} from '../../src/runtime/paths.js';
import { readTapdConfig } from '../../src/runtime/config-store.js';

// 使用 dist/skills/ 下真实发布的模板（npm pack 进 tarball 的那份）
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SKILLS = resolve(__dirname, '..', '..', 'dist', 'skills');

const ALL_SKILLS = [
  'tapd-overview',
  'tapd-fields-reference',
  'tapd-troubleshoot',
  'tapd-safety-rules',
  'tapd-my-work',
  'tapd-implement-story',
  'tapd-handle-bug',
  'tapd-log-time',
  'tapd-comment-and-mention',
  'tapd-from-git-commit',
];

/** Skills whose templates actually contain `{{identity.*}}` placeholders.
 *  Other skills (e.g. fields-reference, safety-rules) are pure reference
 *  text without per-user customization — render still copies them
 *  verbatim, but there's no user-name substring to assert against. */
const SKILLS_WITH_IDENTITY_PLACEHOLDER = [
  'tapd-overview',
  'tapd-my-work',
  'tapd-implement-story',
  'tapd-log-time',
  'tapd-comment-and-mention',
];

let tmpHome: string;
let tmpProj: string;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tapd-e2e-home-'));
  tmpProj = mkdtempSync(join(tmpdir(), 'tapd-e2e-proj-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProj, { recursive: true, force: true });
});

function captureWritable(): { stream: NodeJS.WritableStream; out: () => string } {
  const chunks: string[] = [];
  const stream: NodeJS.WritableStream = {
    write(chunk: string | Uint8Array) {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
    end() {
      return this;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return false;
    },
    removeListener() {
      return this;
    },
    addListener() {
      return this;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, out: () => chunks.join('') };
}

async function seedCache(home: string, options: { multiWs?: boolean } = {}) {
  await writeCache(cacheJsonPath('user', { homeOverride: home }), {
    schemaVersion: 1,
    writtenAt: '2026-05-30T08:00:00Z',
    identity: { tapdUserName: '集成测试用户', tapdUserId: '7777' },
    workspaces: options.multiWs
      ? [
          { id: '12345', name: '项目A' },
          { id: '67890', name: '项目B' },
        ]
      : [{ id: '12345', name: '项目A' }],
  });
}

function commonInput(overrides: Partial<InstallSkillsInput>): InstallSkillsInput {
  const stdoutCap = captureWritable();
  const stderrCap = captureWritable();
  return {
    clients: ['claude-code'],
    scope: 'user',
    dryRun: false,
    token: 'fake-token-not-used-because-cache-seeded',
    pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
    templatesDir: DIST_SKILLS,
    stdout: stdoutCap.stream,
    stderr: stderrCap.stream,
    ...overrides,
  };
}

// =====================================================================
// dist/skills sanity — 真模板必须就位才跑后续 e2e
// =====================================================================
describe('dist/skills templates exist (precondition)', () => {
  it('all 10 templates present in dist/skills/', async () => {
    for (const name of ALL_SKILLS) {
      const p = join(DIST_SKILLS, `${name}.md.tmpl`);
      await expect(fs.access(p), `missing ${p}`).resolves.toBeUndefined();
    }
  });

  it('no admin / legacy skills in dist/skills/', async () => {
    const entries = await fs.readdir(DIST_SKILLS);
    const tmpls = entries.filter((f) => f.endsWith('.md.tmpl'));
    expect(tmpls.length).toBe(10);
    for (const forbidden of [
      'tapd-iteration-planning',
      'tapd-bug-dashboard',
      'tapd-batch-assign',
      'tapd-server-cli-login',
      'tapd-server-cli-logout',
      'tapd-server-cli-update',
    ]) {
      expect(tmpls).not.toContain(`${forbidden}.md.tmpl`);
    }
  });
});

// =====================================================================
// 完整生命周期 — 单 client / 用户 scope
// =====================================================================
describe('E2E: install → idempotent → uninstall (claude-code, user scope)', () => {
  it('runs full lifecycle and converges', async () => {
    await seedCache(tmpHome);

    // === 1. 首次 install ===
    const r1 = await runInstallSkills(commonInput({}));
    expect(r1.exitCode).toBe(0);
    expect(r1.skillFilesWritten).toBe(10);
    expect(r1.scope).toBe('user');

    // 落地：所有 10 个 SKILL.md
    for (const name of ALL_SKILLS) {
      const p = join(tmpHome, '.claude', 'skills', name, 'SKILL.md');
      await expect(fs.access(p), `${name} not written`).resolves.toBeUndefined();
    }
    // identity 占位符渲染只对实际含占位符的 skill 才有意义
    for (const name of SKILLS_WITH_IDENTITY_PLACEHOLDER) {
      const p = join(tmpHome, '.claude', 'skills', name, 'SKILL.md');
      const body = await fs.readFile(p, 'utf8');
      expect(body, `${name} body should contain rendered user name`).toContain(
        '集成测试用户',
      );
      expect(body, `${name} body must not leave unrendered placeholder`).not.toContain(
        '{{identity.tapdUserName}}',
      );
    }

    // CLAUDE.md 注入了 managed block + 5 hard rules 摘要
    const claudeMd = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain(BEGIN_MARK);
    expect(claudeMd).toContain(END_MARK);
    expect(claudeMd).toContain('Hard rules');
    for (const rule of [
      'NEVER delete',
      'NEVER set bug status to `closed`',
      'tapd_tasks_create',
      'preview',
      '10 entities',
    ]) {
      expect(claudeMd, `CLAUDE.md missing "${rule}"`).toContain(rule);
    }

    // tapd.config.json 含 10 个 skill + sha256
    const cfg = await readTapdConfig(tapdConfigPath('user', { homeOverride: tmpHome }));
    expect(cfg).toBeDefined();
    expect(cfg!.skills.length).toBe(10);
    for (const s of cfg!.skills) {
      expect(s.writtenSha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // === 2. 重跑 install（幂等）===
    const overviewPath = join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    const beforeBody = await fs.readFile(overviewPath, 'utf8');
    const beforeMtime = (await fs.stat(overviewPath)).mtimeMs;

    const r2 = await runInstallSkills(commonInput({}));
    expect(r2.exitCode).toBe(0);

    const afterBody = await fs.readFile(overviewPath, 'utf8');
    expect(afterBody).toBe(beforeBody);
    // mtime 可能因为覆写而更新，但 hash 一致 → 内容真无变化
    expect(beforeMtime).toBeGreaterThan(0);

    // CLAUDE.md hash 应该一致（block 内容相同）
    const claudeMd2 = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeMd2).toBe(claudeMd);

    // === 3. 用户改动 SKILL.md → 再 install（默认 keep）===
    await fs.writeFile(overviewPath, '__USER_MODIFIED__', 'utf8');

    const r3 = await runInstallSkills(commonInput({}));
    expect(r3.exitCode).toBe(0);
    const stillModified = await fs.readFile(overviewPath, 'utf8');
    expect(stillModified).toBe('__USER_MODIFIED__'); // 默认 keep

    // === 4. 再 install（resolveConflict='overwrite' → .bak）===
    await runInstallSkills(commonInput({ resolveConflict: async () => 'overwrite' }));
    const recovered = await fs.readFile(overviewPath, 'utf8');
    expect(recovered).toContain('集成测试用户'); // 已被新版覆盖
    const dir = await fs.readdir(join(tmpHome, '.claude', 'skills', 'tapd-overview'));
    expect(dir.some((f) => f.startsWith('SKILL.md.bak.'))).toBe(true);

    // === 5. uninstall（默认保留 cache）===
    const stdoutCap = captureWritable();
    const u1 = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });
    expect(u1.exitCode).toBe(0);
    expect(u1.configRemoved).toBe(true);
    expect(u1.cacheRemoved).toBe(false);

    // SKILL.md 全部消失（含 .bak 也按文件夹保留 — uninstall 仅按 config 记录删，不递归扫）
    for (const name of ALL_SKILLS) {
      const p = join(tmpHome, '.claude', 'skills', name, 'SKILL.md');
      await expect(fs.access(p)).rejects.toThrow();
    }
    // CLAUDE.md 不再含 BEGIN_MARK
    const claudeMdAfter = await fs
      .readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8')
      .catch(() => '');
    expect(claudeMdAfter).not.toContain(BEGIN_MARK);

    // tapd.config.json 没了，cache.json 还在
    await expect(
      fs.access(tapdConfigPath('user', { homeOverride: tmpHome })),
    ).rejects.toThrow();
    await expect(
      fs.access(cacheJsonPath('user', { homeOverride: tmpHome })),
    ).resolves.toBeUndefined();

    // === 6. 再次 uninstall（应 noop）===
    const stdoutCap2 = captureWritable();
    const u2 = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap2.stream,
    });
    expect(u2.exitCode).toBe(0);
    expect(u2.configRemoved).toBe(false);
    expect(u2.perClient[0]?.outcome).toBe('noop');
  });
});

// =====================================================================
// 多客户端（4 家全装）
// =====================================================================
describe('E2E: install all 4 clients (user scope)', () => {
  it('writes all rules files + CLAUDE.md skill files', async () => {
    await seedCache(tmpHome);
    const r = await runInstallSkills(
      commonInput({ clients: ['claude-code', 'codex', 'cursor', 'opencode'] }),
    );
    expect(r.exitCode).toBe(0);

    // Claude Code: SKILL.md + CLAUDE.md
    for (const name of ALL_SKILLS) {
      await expect(
        fs.access(join(tmpHome, '.claude', 'skills', name, 'SKILL.md')),
      ).resolves.toBeUndefined();
    }
    const claudeMd = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain(BEGIN_MARK);

    // Codex: AGENTS.md (含 skill 全文)
    const codexMd = await fs.readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');
    expect(codexMd).toContain(BEGIN_MARK);
    expect(codexMd).toContain('Skill: tapd-overview');
    expect(codexMd).toContain('Skill: tapd-handle-bug');

    // OpenCode: AGENTS.md
    const opencodeMd = await fs.readFile(
      join(tmpHome, '.config', 'opencode', 'AGENTS.md'),
      'utf8',
    );
    expect(opencodeMd).toContain(BEGIN_MARK);
    expect(opencodeMd).toContain('Skill: tapd-safety-rules');

    // Cursor: .mdc 全文（无 managed block）
    const cursorMdc = await fs.readFile(
      join(tmpHome, '.cursor', 'rules', 'tapd.mdc'),
      'utf8',
    );
    expect(cursorMdc).toContain('alwaysApply: false');
    expect(cursorMdc).toContain('description: |');
    expect(cursorMdc).toContain('Skill: tapd-overview');
    // Cursor 不应有 managed block 标记（全文写）
    expect(cursorMdc).not.toContain(BEGIN_MARK);

    // === uninstall 4 家 ===
    const stdoutCap = captureWritable();
    const u = await runUninstallSkills({
      clients: ['claude-code', 'codex', 'cursor', 'opencode'],
      scope: 'user',
      dryRun: false,
      purgeCache: true,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });
    expect(u.exitCode).toBe(0);
    expect(u.cacheRemoved).toBe(true);

    // 各 rules 文件都没了 / 已无 block
    const claudeMdAfter = await fs
      .readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8')
      .catch(() => '');
    expect(claudeMdAfter).not.toContain(BEGIN_MARK);
    const codexAfter = await fs
      .readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8')
      .catch(() => '');
    expect(codexAfter).not.toContain(BEGIN_MARK);
    await expect(
      fs.access(join(tmpHome, '.cursor', 'rules', 'tapd.mdc')),
    ).rejects.toThrow();

    // ~/.tapd/ 目录本身保留（保守策略）
    await expect(fs.access(join(tmpHome, TAPD_DIR_NAME))).resolves.toBeUndefined();
  });
});

// =====================================================================
// 项目级 scope
// =====================================================================
describe('E2E: project scope writes to <proj> + maintains .gitignore', () => {
  it('lays down project-level files and updates .gitignore', async () => {
    await seedCache(tmpHome);
    const r = await runInstallSkills(commonInput({ scope: 'project' }));
    expect(r.exitCode).toBe(0);
    expect(r.scope).toBe('project');

    // 项目目录里有 SKILL.md
    await expect(
      fs.access(join(tmpProj, '.claude', 'skills', 'tapd-overview', 'SKILL.md')),
    ).resolves.toBeUndefined();

    // CLAUDE.md 在项目根
    await expect(fs.access(join(tmpProj, 'CLAUDE.md'))).resolves.toBeUndefined();

    // tapd.config.json 在 <proj>/.tapd/
    await expect(
      fs.access(tapdConfigPath('project', { cwdOverride: tmpProj })),
    ).resolves.toBeUndefined();

    // .gitignore 含 .tapd/
    const gi = await fs.readFile(join(tmpProj, '.gitignore'), 'utf8');
    expect(gi).toContain('.tapd/');
  });

  it('does not duplicate .gitignore entry on rerun', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput({ scope: 'project' }));
    const before = await fs.readFile(join(tmpProj, '.gitignore'), 'utf8');
    await runInstallSkills(commonInput({ scope: 'project' }));
    const after = await fs.readFile(join(tmpProj, '.gitignore'), 'utf8');
    expect(after).toBe(before);
  });
});

// =====================================================================
// dry-run 全套不写盘
// =====================================================================
describe('E2E: --dry-run touches no disk state', () => {
  it('install dry-run produces no files', async () => {
    await seedCache(tmpHome);
    const r = await runInstallSkills(
      commonInput({ clients: ['claude-code', 'codex', 'cursor', 'opencode'], dryRun: true }),
    );
    expect(r.exitCode).toBe(0);

    await expect(fs.access(join(tmpHome, '.claude', 'skills'))).rejects.toThrow();
    await expect(fs.access(join(tmpHome, '.claude', 'CLAUDE.md'))).rejects.toThrow();
    await expect(fs.access(join(tmpHome, '.codex', 'AGENTS.md'))).rejects.toThrow();
    await expect(
      fs.access(join(tmpHome, '.cursor', 'rules', 'tapd.mdc')),
    ).rejects.toThrow();
    await expect(
      fs.access(tapdConfigPath('user', { homeOverride: tmpHome })),
    ).rejects.toThrow();
  });

  it('uninstall dry-run leaves files intact', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput({ clients: ['claude-code', 'codex'] }));

    const overviewBefore = await fs.readFile(
      join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md'),
      'utf8',
    );
    const claudeBefore = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    const codexBefore = await fs.readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');

    const stdoutCap = captureWritable();
    const u = await runUninstallSkills({
      clients: ['claude-code', 'codex'],
      scope: 'user',
      dryRun: true,
      purgeCache: true,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });
    expect(u.exitCode).toBe(0);
    expect(u.configRemoved).toBe(false);
    expect(u.cacheRemoved).toBe(false);

    const overviewAfter = await fs.readFile(
      join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md'),
      'utf8',
    );
    expect(overviewAfter).toBe(overviewBefore);
    expect(await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8')).toBe(claudeBefore);
    expect(await fs.readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8')).toBe(codexBefore);
  });
});

// =====================================================================
// 块外用户内容保留
// =====================================================================
describe('E2E: pre-existing user content in CLAUDE.md is preserved', () => {
  it('block-outside content survives install + uninstall', async () => {
    await seedCache(tmpHome);

    // 用户先有自己的 CLAUDE.md
    const userOwn = '# My personal notes\n\nThis is my own content. Do not delete.\n';
    await fs.mkdir(join(tmpHome, '.claude'), { recursive: true });
    await fs.writeFile(join(tmpHome, '.claude', 'CLAUDE.md'), userOwn, 'utf8');

    // install
    await runInstallSkills(commonInput({}));
    const after = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(after).toContain('My personal notes');
    expect(after).toContain('This is my own content. Do not delete.');
    expect(after).toContain(BEGIN_MARK);

    // uninstall
    const stdoutCap = captureWritable();
    await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });
    const final = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(final).toContain('My personal notes');
    expect(final).toContain('This is my own content. Do not delete.');
    expect(final).not.toContain(BEGIN_MARK);
  });
});
