import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInstall } from '../../src/installer/flow.js';
import { claudeCodeAdapter } from '../../src/installer/adapters/claude-code.js';
import { codexAdapter } from '../../src/installer/adapters/codex.js';

function fakeStdio() {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (b: Buffer) => out.push(b.toString('utf8')));
  stderr.on('data', (b: Buffer) => err.push(b.toString('utf8')));
  return {
    stdout: stdout as unknown as NodeJS.WritableStream,
    stderr: stderr as unknown as NodeJS.WritableStream,
    out,
    err,
  };
}

describe('runInstall — unknown client', () => {
  it('returns exit 2 with helpful message', async () => {
    const { stdout, stderr, err } = fakeStdio();
    const result = await runInstall({
      clients: ['unknown-ide'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'x',
    });
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('未识别的客户端');
  });
});

describe('runInstall — empty clients defensive guard', () => {
  it('returns exit 2 when called with empty clients array', async () => {
    const { stdout, stderr, err } = fakeStdio();
    const result = await runInstall({
      clients: [],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'x',
    });
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('未指定任何客户端');
  });
});

describe('runInstall — single client dry-run (backward compat)', () => {
  it('does not touch the filesystem and prints plan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tapd-flow-dryrun-'));
    const fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
    try {
      const { stdout, stderr, out } = fakeStdio();
      const result = await runInstall({
        clients: ['claude-code'],
        dryRun: true,
        stdout,
        stderr,
        tokenOverride: 'token-xyz',
      });
      expect(result.exitCode).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.outcome).toBe('dry-run');
      expect(result.results[0]?.path).toBe(fakePath);
      // 配置文件不应被创建
      await expect(fs.access(fakePath)).rejects.toThrow();
      const joined = out.join('');
      expect(joined).toContain('[dry-run]');
      expect(joined).toContain(fakePath);
      expect(joined).toContain('TAPD_TOKEN');
      expect(joined).not.toContain('token-xyz'); // 不应泄漏 token 值
    } finally {
      vi.restoreAllMocks();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runInstall — single client write then noop', () => {
  let dir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-flow-write-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('first run writes; second run with same token is no-op', async () => {
    const first = await runInstall({
      clients: ['claude-code'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'same-token',
    });
    expect(first.exitCode).toBe(0);
    expect(first.results[0]?.outcome).toBe('wrote');
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('same-token');

    const second = await runInstall({
      clients: ['claude-code'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'same-token',
    });
    expect(second.exitCode).toBe(0);
    expect(second.results[0]?.outcome).toBe('noop');
  });

  it('different token triggers backup + overwrite', async () => {
    await runInstall({
      clients: ['claude-code'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'token-a',
    });
    const second = await runInstall({
      clients: ['claude-code'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'token-b',
    });
    expect(second.exitCode).toBe(0);
    expect(second.results[0]?.outcome).toBe('wrote');
    expect(second.results[0]?.backup).toBeDefined();
    // 文件内容更新到 token-b
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('token-b');
    // 至少存在一个 .bak 备份
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.startsWith('claude.json.bak.'))).toBe(true);
  });

  it('preserves unrelated fields in claude.json (e.g. projects[])', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({
        projects: { '/some/path': { thing: 1 } },
        mcpServers: { other: { command: 'foo' } },
      }),
    );
    const r = await runInstall({
      clients: ['claude-code'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 't',
    });
    expect(r.results[0]?.outcome).toBe('wrote');
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.projects).toEqual({ '/some/path': { thing: 1 } });
    expect(content.mcpServers.other).toEqual({ command: 'foo' });
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('t');
  });
});

describe('runInstall — multi-client orchestration', () => {
  let dir: string;
  let claudePath: string;
  let codexPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-flow-multi-'));
    claudePath = join(dir, 'claude.json');
    codexPath = join(dir, 'codex.toml');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(claudePath);
    vi.spyOn(codexAdapter, 'configPath').mockReturnValue(codexPath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('installs both clients sharing one token; reports per-client outcome', async () => {
    const { stdout, stderr, out } = fakeStdio();
    const result = await runInstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'shared-token',
    });
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.client)).toEqual(['claude-code', 'codex']);
    expect(result.results.every((r) => r.outcome === 'wrote')).toBe(true);

    // 两份文件都包含同一 token
    const claudeContent = JSON.parse(await fs.readFile(claudePath, 'utf8'));
    expect(claudeContent.mcpServers.tapd.env.TAPD_TOKEN).toBe('shared-token');
    const codexContent = await fs.readFile(codexPath, 'utf8');
    expect(codexContent).toContain('shared-token');

    // 汇总输出包含两家
    const joined = out.join('');
    expect(joined).toContain('安装结果：');
    expect(joined).toContain('claude-code');
    expect(joined).toContain('codex');
  });

  it('continues after partial failure and exit code is non-zero', async () => {
    // 让 codex.write 抛错；claude-code 正常写入。
    vi.spyOn(codexAdapter, 'write').mockRejectedValue(new Error('disk is full'));

    const { stdout, stderr, out, err } = fakeStdio();
    const result = await runInstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'token-xyz',
    });

    expect(result.exitCode).toBe(1);
    const claudeR = result.results.find((r) => r.client === 'claude-code');
    const codexR = result.results.find((r) => r.client === 'codex');
    expect(claudeR?.outcome).toBe('wrote');
    expect(codexR?.outcome).toBe('failed');
    expect(codexR?.error).toContain('disk is full');

    // claude 文件仍然写入
    const content = JSON.parse(await fs.readFile(claudePath, 'utf8'));
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('token-xyz');

    // 失败也进汇总，stderr 有错误行
    expect(err.join('')).toContain('安装 Codex 失败');
    expect(out.join('')).toContain('✗ codex');
    expect(out.join('')).toContain('✔ claude-code');
  });

  it('multi-client dry-run touches no files and reports dry-run for each', async () => {
    const result = await runInstall({
      clients: ['claude-code', 'codex'],
      dryRun: true,
      ...fakeStdio(),
      tokenOverride: 'token-xyz',
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.every((r) => r.outcome === 'dry-run')).toBe(true);
    await expect(fs.access(claudePath)).rejects.toThrow();
    await expect(fs.access(codexPath)).rejects.toThrow();
  });

  it('multi-client all-noop when both already up to date', async () => {
    // 第一遍写入两家
    await runInstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 't',
    });
    // 第二遍同 token —— 都应该是 noop
    const result = await runInstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 't',
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.every((r) => r.outcome === 'noop')).toBe(true);
  });
});

describe('runInstall — claude-code prefers claude CLI', () => {
  it('skips adapter.write when claude CLI succeeds', async () => {
    vi.resetModules();
    vi.doMock('../../src/installer/claude-cli.js', () => ({
      preferClaudeCliInstall: async () => ({ used: 'cli' }),
    }));
    const { claudeCodeAdapter: freshAdapter } = await import(
      '../../src/installer/adapters/claude-code.js'
    );
    const writeSpy = vi.spyOn(freshAdapter, 'write').mockResolvedValue();
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');

    const { stdout, stderr, out } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['claude-code'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('wrote');
    expect(writeSpy).not.toHaveBeenCalled();
    expect(out.join('')).toContain('via claude mcp add-json');

    vi.doUnmock('../../src/installer/claude-cli.js');
    writeSpy.mockRestore();
  });

  it('falls back to adapter.write when claude CLI is unavailable', async () => {
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), 'tapd-fallback-'));
    const fakePath = join(dir, 'claude.json');

    vi.doMock('../../src/installer/claude-cli.js', () => ({
      preferClaudeCliInstall: async () => ({ used: 'fallback' }),
    }));
    const { claudeCodeAdapter: freshAdapter } = await import(
      '../../src/installer/adapters/claude-code.js'
    );
    vi.spyOn(freshAdapter, 'configPath').mockReturnValue(fakePath);
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');

    const { stdout, stderr } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['claude-code'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('wrote');
    expect(result.results[0]?.path).toBe(fakePath);
    await expect(fs.access(fakePath)).resolves.toBeUndefined();

    vi.doUnmock('../../src/installer/claude-cli.js');
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('runInstall — claude-code copies user-scope commands', () => {
  let tempHome: string;
  let tempCommandsSrc: string;
  let tempClaudeJsonDir: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'tapd-uscmd-home-'));
    tempCommandsSrc = mkdtempSync(join(tmpdir(), 'tapd-uscmd-src-'));
    tempClaudeJsonDir = mkdtempSync(join(tmpdir(), 'tapd-uscmd-cj-'));
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempCommandsSrc, { recursive: true, force: true });
    await fs.rm(tempClaudeJsonDir, { recursive: true, force: true });
  });

  it('copies commands/*.md to ~/.claude/commands/tapd-server-cli/ after writing mcp.json', async () => {
    // 注�� commands 源
    await fs.writeFile(join(tempCommandsSrc, 'login.md'), '---\ndescription: login\n---\n# login');
    await fs.writeFile(join(tempCommandsSrc, 'logout.md'), '---\ndescription: logout\n---\n# logout');

    // 让 preferClaudeCliInstall 返 fallback、并 spy 新实例的 configPath，
    // 顺序很关键：先 resetModules + doMock，再动态 import，再对动态实例 spy
    // （直接对顶部静态 import 的 claudeCodeAdapter spy 在 resetModules 后会失效）
    vi.resetModules();
    vi.doMock('../../src/installer/claude-cli.js', () => ({
      preferClaudeCliInstall: async () => ({ used: 'fallback' }),
    }));
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');
    const { claudeCodeAdapter: freshAdapter } = await import(
      '../../src/installer/adapters/claude-code.js'
    );

    // claude.json 写入路径走 tempClaudeJsonDir，避免污染真实 ~/.claude.json
    const fakeClaudePath = join(tempClaudeJsonDir, 'claude.json');
    vi.spyOn(freshAdapter, 'configPath').mockReturnValue(fakeClaudePath);

    const { stdout, stderr, out } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['claude-code'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
      homedirOverride: tempHome,
      commandsSrcOverride: tempCommandsSrc,
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('wrote');
    expect(result.results[0]?.userScopeCommands?.installed.sort()).toEqual([
      'login.md',
      'logout.md',
    ]);

    // 文件真的拷过去了
    const targetDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    await expect(fs.readFile(join(targetDir, 'login.md'), 'utf8')).resolves.toContain('# login');
    await expect(fs.readFile(join(targetDir, 'logout.md'), 'utf8')).resolves.toContain('# logout');

    // stdout 显示成功 1 行
    expect(out.join('')).toContain('user-scope commands installed');

    vi.doUnmock('../../src/installer/claude-cli.js');
  });

  it('does not copy commands when dry-run', async () => {
    await fs.writeFile(join(tempCommandsSrc, 'login.md'), '# login');

    const fakeClaudePath = join(tempClaudeJsonDir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakeClaudePath);

    const { stdout, stderr } = fakeStdio();
    const result = await runInstall({
      clients: ['claude-code'],
      dryRun: true,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
      homedirOverride: tempHome,
      commandsSrcOverride: tempCommandsSrc,
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('dry-run');
    expect(result.results[0]?.userScopeCommands).toBeUndefined();

    // dry-run 不创建目录
    await expect(fs.access(join(tempHome, '.claude'))).rejects.toThrow();
  });

  it('does not copy commands for non-claude-code clients (codex)', async () => {
    await fs.writeFile(join(tempCommandsSrc, 'login.md'), '# login');

    const fakeCodexPath = join(tempClaudeJsonDir, 'config.toml');
    vi.spyOn(codexAdapter, 'configPath').mockReturnValue(fakeCodexPath);

    vi.resetModules();
    vi.doMock('../../src/installer/codex-cli.js', () => ({
      preferCodexCliInstall: async () => ({ used: 'fallback' }),
    }));
    const { runInstall: freshRunInstall } = await import('../../src/installer/flow.js');

    const { stdout, stderr } = fakeStdio();
    const result = await freshRunInstall({
      clients: ['codex'],
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'pat-xxx',
      homedirOverride: tempHome,
      commandsSrcOverride: tempCommandsSrc,
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.userScopeCommands).toBeUndefined();
    // codex install 不应该创建 ~/.claude/commands/
    await expect(fs.access(join(tempHome, '.claude'))).rejects.toThrow();

    vi.doUnmock('../../src/installer/codex-cli.js');
  });
});
