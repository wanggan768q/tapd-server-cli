import { mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runInstallSkills,
  type InstallSkillsInput,
} from '../../src/commands/install-skills-handler.js';
import { runUninstallSkills } from '../../src/commands/uninstall-skills-handler.js';
import { switchRoleCommand } from '../../src/commands/switch-role-handler.js';
import { BEGIN_MARK, END_MARK } from '../../src/installer/agents-md.js';
import { writeCache } from '../../src/runtime/cache-store.js';
import { readTapdConfig } from '../../src/runtime/config-store.js';
import {
  cacheJsonPath,
  TAPD_DIR_NAME,
  tapdConfigPath,
} from '../../src/runtime/paths.js';

let tmpHome: string;
let tmpProj: string;
let templates: string;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tapd-isk-home-'));
  tmpProj = mkdtempSync(join(tmpdir(), 'tapd-isk-proj-'));
  templates = mkdtempSync(join(tmpdir(), 'tapd-isk-tpl-'));

  // 准备 fake skill templates
  for (const name of [
    'tapd-overview',
    'tapd-fields-reference',
    'tapd-troubleshoot',
    'tapd-safety-rules',
    'tapd-my-work',
  ]) {
    await fs.writeFile(
      join(templates, `${name}.md.tmpl`),
      `---\nname: ${name}\ndescription: stub\n---\n\nuser={{identity.tapdUserName}}\n`,
      'utf8',
    );
  }
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProj, { recursive: true, force: true });
  rmSync(templates, { recursive: true, force: true });
});

function captureStream(): { stream: NodeJS.WritableStream; out: string[] } {
  const out: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { stream, out };
}

async function seedCache(home: string) {
  await writeCache(cacheJsonPath('user', { homeOverride: home }), {
    schemaVersion: 1,
    writtenAt: '2026-05-30T08:00:00Z',
    identity: { tapdUserName: '张三', tapdUserId: '1000' },
    workspaces: [{ id: '12345', name: '项目A' }],
  });
}

function commonInput(overrides: Partial<InstallSkillsInput> = {}): InstallSkillsInput {
  const stdoutCap = captureStream();
  const stderrCap = captureStream();
  return {
    clients: ['claude-code'],
    scope: 'user',
    dryRun: false,
    token: 'fake-token',
    pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
    templatesDir: templates,
    stdout: stdoutCap.stream,
    stderr: stderrCap.stream,
    ...overrides,
  };
}

describe('runInstallSkills (user scope, claude-code)', () => {
  it('writes SKILL.md files + CLAUDE.md managed block + tapd.config.json', async () => {
    await seedCache(tmpHome);
    const result = await runInstallSkills(commonInput());

    expect(result.exitCode).toBe(0);
    expect(result.skillFilesWritten).toBe(5);

    // SKILL.md 落盘
    const overviewPath = join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    const overview = await fs.readFile(overviewPath, 'utf8');
    expect(overview).toContain('user=张三');

    // CLAUDE.md 注入了 managed block
    const claudeMd = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain(BEGIN_MARK);
    expect(claudeMd).toContain(END_MARK);
    expect(claudeMd).toContain('Hard rules');

    // tapd.config.json 落盘
    const cfg = await readTapdConfig(tapdConfigPath('user', { homeOverride: tmpHome }));
    expect(cfg).toBeDefined();
    expect(cfg!.skills.length).toBe(5);
    expect(cfg!.skills[0]!.writtenSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('--dry-run does not write any files', async () => {
    await seedCache(tmpHome);
    const result = await runInstallSkills(commonInput({ dryRun: true }));

    expect(result.exitCode).toBe(0);
    await expect(
      fs.access(join(tmpHome, '.claude', 'skills')),
    ).rejects.toThrow();
    await expect(
      fs.access(tapdConfigPath('user', { homeOverride: tmpHome })),
    ).rejects.toThrow();
  });

  it('multi-client (claude-code + codex) writes both rules files', async () => {
    await seedCache(tmpHome);
    const result = await runInstallSkills(
      commonInput({ clients: ['claude-code', 'codex'] }),
    );
    expect(result.exitCode).toBe(0);

    const claudeMd = await fs.readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain(BEGIN_MARK);

    const codexMd = await fs.readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');
    expect(codexMd).toContain(BEGIN_MARK);
    // Codex 是内嵌 skill 全文
    expect(codexMd).toContain('Skill: tapd-overview');
  });

  it('cursor writes .mdc with frontmatter', async () => {
    await seedCache(tmpHome);
    const result = await runInstallSkills(commonInput({ clients: ['cursor'] }));
    expect(result.exitCode).toBe(0);

    const mdc = await fs.readFile(
      join(tmpHome, '.cursor', 'rules', 'tapd.mdc'),
      'utf8',
    );
    expect(mdc).toContain('alwaysApply: false');
    expect(mdc).toContain('description: |');
    expect(mdc).toContain('Skill: tapd-overview');
  });

  it('project scope writes to <proj> + maintains .gitignore', async () => {
    // 注：项目 scope 时 cache 仍读 ~/.tapd/cache.json
    await seedCache(tmpHome);
    const result = await runInstallSkills(commonInput({ scope: 'project' }));
    expect(result.exitCode).toBe(0);

    // SKILL.md 写到项目内
    const skillPath = join(tmpProj, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    await expect(fs.access(skillPath)).resolves.toBeUndefined();

    // .gitignore 含 .tapd/
    const gi = await fs.readFile(join(tmpProj, '.gitignore'), 'utf8');
    expect(gi).toContain('.tapd/');
  });

  it('idempotent: rerun does not change SKILL.md hash', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());
    const before = await fs.readFile(
      join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md'),
      'utf8',
    );
    await runInstallSkills(commonInput());
    const after = await fs.readFile(
      join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md'),
      'utf8',
    );
    expect(after).toBe(before);
  });

  it('user-modified SKILL.md is kept (default keep) and not overwritten', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());

    // 用户改文件
    const skillPath = join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    await fs.writeFile(skillPath, 'USER MODIFIED CONTENT', 'utf8');

    // 重跑（resolveConflict 默认 keep）
    const result = await runInstallSkills(commonInput());
    expect(result.exitCode).toBe(0);

    const after = await fs.readFile(skillPath, 'utf8');
    expect(after).toBe('USER MODIFIED CONTENT');
  });

  it('user-modified SKILL.md with overwrite resolver creates .bak', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());

    const skillPath = join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    await fs.writeFile(skillPath, 'USER MODIFIED', 'utf8');

    await runInstallSkills(
      commonInput({ resolveConflict: async () => 'overwrite' }),
    );

    // 原文件被新内容覆盖
    const after = await fs.readFile(skillPath, 'utf8');
    expect(after).toContain('user=张三');

    // .bak 含旧内容
    const dir = await fs.readdir(join(tmpHome, '.claude', 'skills', 'tapd-overview'));
    const bak = dir.find((f) => f.startsWith('SKILL.md.bak.'));
    expect(bak).toBeDefined();
    const bakContent = await fs.readFile(
      join(tmpHome, '.claude', 'skills', 'tapd-overview', bak!),
      'utf8',
    );
    expect(bakContent).toBe('USER MODIFIED');
  });
});

describe('runUninstallSkills', () => {
  it('cleans up skill files + managed block + config (after install)', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput({ clients: ['claude-code', 'codex'] }));

    const stdoutCap = captureStream();
    const result = await runUninstallSkills({
      clients: ['claude-code', 'codex'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });

    expect(result.exitCode).toBe(0);
    expect(result.configRemoved).toBe(true);
    expect(result.cacheRemoved).toBe(false);

    // SKILL.md 没了
    await expect(
      fs.access(join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md')),
    ).rejects.toThrow();

    // CLAUDE.md 不再含 BEGIN_MARK（可能整个文件已被删，因为只剩 block 内容）
    const claudeMd = await fs
      .readFile(join(tmpHome, '.claude', 'CLAUDE.md'), 'utf8')
      .catch(() => '');
    expect(claudeMd).not.toContain(BEGIN_MARK);

    // codex AGENTS.md 同上
    const codexMd = await fs
      .readFile(join(tmpHome, '.codex', 'AGENTS.md'), 'utf8')
      .catch(() => '');
    expect(codexMd).not.toContain(BEGIN_MARK);

    // cache.json 保留
    await expect(
      fs.access(cacheJsonPath('user', { homeOverride: tmpHome })),
    ).resolves.toBeUndefined();
  });

  it('--purge-cache deletes cache.json too', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());

    const stdoutCap = captureStream();
    const result = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: true,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });

    expect(result.cacheRemoved).toBe(true);
    await expect(
      fs.access(cacheJsonPath('user', { homeOverride: tmpHome })),
    ).rejects.toThrow();

    // ~/.tapd 目录本身不应被删
    await expect(
      fs.access(join(tmpHome, TAPD_DIR_NAME)),
    ).resolves.toBeUndefined();
  });

  it('--dry-run does not modify anything', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());

    const stdoutCap = captureStream();
    const result = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: true,
      purgeCache: true,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });

    expect(result.exitCode).toBe(0);
    expect(result.configRemoved).toBe(false);
    expect(result.cacheRemoved).toBe(false);

    // 文件还在
    await expect(
      fs.access(join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('user-modified SKILL.md is backed up rather than deleted', async () => {
    await seedCache(tmpHome);
    await runInstallSkills(commonInput());

    const skillPath = join(tmpHome, '.claude', 'skills', 'tapd-overview', 'SKILL.md');
    await fs.writeFile(skillPath, 'USER MODIFIED', 'utf8');

    const stdoutCap = captureStream();
    const result = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });

    expect(result.exitCode).toBe(0);
    // 原文件没了
    await expect(fs.access(skillPath)).rejects.toThrow();
    // 但 .bak 存在
    const dir = await fs.readdir(join(tmpHome, '.claude', 'skills', 'tapd-overview'));
    expect(dir.some((f) => f.startsWith('SKILL.md.bak.'))).toBe(true);
  });

  it('noop when no managed block / files exist', async () => {
    const stdoutCap = captureStream();
    const result = await runUninstallSkills({
      clients: ['claude-code'],
      scope: 'user',
      dryRun: false,
      purgeCache: false,
      pathOverrides: { homeOverride: tmpHome, cwdOverride: tmpProj },
      stdout: stdoutCap.stream,
    });
    expect(result.exitCode).toBe(0);
    expect(result.perClient[0]?.outcome).toBe('noop');
  });
});

describe('switchRoleCommand', () => {
  it('always exits 2 with hint', () => {
    const cap = captureStream();
    const result = switchRoleCommand({ role: 'admin', stderr: cap.stream });
    expect(result.exitCode).toBe(2);
    expect(cap.out.join('')).toContain('管理者 skill');
    expect(cap.out.join('')).toContain('admin');
  });
});
