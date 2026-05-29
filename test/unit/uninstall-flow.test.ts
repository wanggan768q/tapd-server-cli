import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeAdapter } from '../../src/installer/adapters/claude-code.js';
import { codexAdapter } from '../../src/installer/adapters/codex.js';
import { runUninstall } from '../../src/installer/uninstall-flow.js';

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

describe('runUninstall — defensive guards', () => {
  it('returns exit 2 when called with empty clients array', async () => {
    const { stdout, stderr, err } = fakeStdio();
    const result = await runUninstall({
      clients: [],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('未指定任何客户端');
  });

  it('returns exit 2 with helpful message for unknown client', async () => {
    const { stdout, stderr, err } = fakeStdio();
    const result = await runUninstall({
      clients: ['unknown-ide'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('未识别的客户端');
  });
});

describe('runUninstall — idempotent noop', () => {
  let dir: string;
  let purgeBaseDir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-noop-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('reports noop when config file does not exist', async () => {
    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('noop');
    expect(out.join('')).toContain('tapd 条目不存在');
    // 文件依旧不存在
    await expect(fs.access(fakePath)).rejects.toThrow();
  });

  it('reports noop when config exists but has no tapd entry', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({
        projects: { '/x': {} },
        mcpServers: { other: { command: 'foo' } },
      }),
    );
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...fakeStdio(),
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('noop');

    // 文件未被改写
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.other).toEqual({ command: 'foo' });
  });
});

describe('runUninstall — actual removal', () => {
  let dir: string;
  let purgeBaseDir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-rm-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('removes tapd entry and preserves other servers + top-level fields', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({
        projects: { '/x': { foo: 1 } },
        telemetry: false,
        mcpServers: {
          tapd: { command: 'npx', args: ['-y', 'tapd-server-cli'], env: { TAPD_TOKEN: 't' } },
          gitlab: { command: 'gl-mcp', args: [] },
        },
      }),
    );

    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('removed');

    // tapd 节被移除,其它保留
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.tapd).toBeUndefined();
    expect(content.mcpServers.gitlab).toEqual({ command: 'gl-mcp', args: [] });
    expect(content.projects).toEqual({ '/x': { foo: 1 } });
    expect(content.telemetry).toBe(false);

    // 备份文件存在
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.startsWith('claude.json.bak.'))).toBe(true);

    expect(out.join('')).toContain('✔ claude-code');
  });

  it('leaves mcpServers as empty object when tapd was the only entry', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );

    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...fakeStdio(),
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('removed');

    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers).toEqual({});
  });

  it('treats non-standard tapd value (string) as present and removes it', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: 'deprecated', other: { command: 'x' } } }),
    );

    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...fakeStdio(),
      purgeBaseDir,
    });
    expect(result.results[0]?.outcome).toBe('removed');

    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.tapd).toBeUndefined();
    expect(content.mcpServers.other).toEqual({ command: 'x' });
  });
});

describe('runUninstall — dry-run', () => {
  let dir: string;
  let purgeBaseDir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-dry-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('dry-run does not touch file but reports preview', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({
        mcpServers: {
          tapd: { command: 'npx', args: ['-y'], env: { TAPD_TOKEN: 't' } },
          gitlab: { command: 'x' },
        },
      }),
    );
    const before = await fs.readFile(fakePath, 'utf8');

    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: true,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('dry-run');

    // 文件内容未变
    const after = await fs.readFile(fakePath, 'utf8');
    expect(after).toBe(before);

    const joined = out.join('');
    expect(joined).toContain('[dry-run]');
    expect(joined).toContain('当前 tapd 条目');
    expect(joined).toContain('移除后 mcpServers 剩余 keys');
    expect(joined).toContain('gitlab');
  });

  it('dry-run with --purge lists target files but deletes nothing', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    await fs.writeFile(join(purgeBaseDir, 'cookie'), 'fake');
    await fs.writeFile(join(purgeBaseDir, 'token'), 'fake');

    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: true,
      purge: true,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.purgeResults).toBeUndefined();

    // cookie/token 未删
    await expect(fs.access(join(purgeBaseDir, 'cookie'))).resolves.toBeUndefined();
    await expect(fs.access(join(purgeBaseDir, 'token'))).resolves.toBeUndefined();

    expect(out.join('')).toContain('[dry-run] --purge 将清理');
  });
});

describe('runUninstall — multi-client orchestration', () => {
  let dir: string;
  let purgeBaseDir: string;
  let claudePath: string;
  let codexPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-multi-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-'));
    claudePath = join(dir, 'claude.json');
    codexPath = join(dir, 'codex.toml');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(claudePath);
    vi.spyOn(codexAdapter, 'configPath').mockReturnValue(codexPath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('continues after partial failure and exit code is non-zero', async () => {
    // 两家都先 install 一份 tapd 条目
    await fs.writeFile(
      claudePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    await fs.writeFile(
      codexPath,
      '[mcp_servers.tapd]\ncommand = "npx"\nargs = []\n[mcp_servers.tapd.env]\nTAPD_TOKEN = "t"\n',
    );

    // 让 codex.write 抛错;claude-code 正常移除
    vi.spyOn(codexAdapter, 'write').mockRejectedValue(new Error('disk is full'));

    const { stdout, stderr, out, err } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });

    expect(result.exitCode).toBe(1);
    const claudeR = result.results.find((r) => r.client === 'claude-code');
    const codexR = result.results.find((r) => r.client === 'codex');
    expect(claudeR?.outcome).toBe('removed');
    expect(codexR?.outcome).toBe('failed');
    expect(codexR?.error).toContain('disk is full');

    // claude 文件实际改写,tapd 条目被移除
    const claudeContent = JSON.parse(await fs.readFile(claudePath, 'utf8'));
    expect(claudeContent.mcpServers.tapd).toBeUndefined();

    expect(err.join('')).toContain('卸载 Codex 失败');
    expect(out.join('')).toContain('✗ codex');
    expect(out.join('')).toContain('✔ claude-code');
  });

  it('multi-client all-noop when none has tapd entry', async () => {
    // 两家文件都不存在 → 全部 noop
    const result = await runUninstall({
      clients: ['claude-code', 'codex'],
      dryRun: false,
      purge: false,
      ...fakeStdio(),
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.results.every((r) => r.outcome === 'noop')).toBe(true);
  });
});

describe('runUninstall — --purge integration', () => {
  let dir: string;
  let purgeBaseDir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-int-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-purge-dir-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('removes both cookie and token after client config removal', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    await fs.writeFile(join(purgeBaseDir, 'cookie'), 'c');
    await fs.writeFile(join(purgeBaseDir, 'token'), 't');

    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: true,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.purgeResults?.find((r) => r.file === 'cookie')?.outcome).toBe('removed');
    expect(result.purgeResults?.find((r) => r.file === 'token')?.outcome).toBe('removed');

    // 文件已删
    await expect(fs.access(join(purgeBaseDir, 'cookie'))).rejects.toThrow();
    await expect(fs.access(join(purgeBaseDir, 'token'))).rejects.toThrow();

    expect(out.join('')).toContain('purge: cookie removed');
    expect(out.join('')).toContain('purge: token removed');
  });

  it('purge failure forces exit=1 even when client removal succeeded', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    await fs.writeFile(join(purgeBaseDir, 'cookie'), 'c');

    // mock fs.unlink for the cookie path
    const realUnlink = fs.unlink.bind(fs);
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('cookie')) {
        const err = new Error('EBUSY: resource busy') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      }
      return realUnlink(p);
    });

    const { stdout, stderr, out, err } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: true,
      stdout,
      stderr,
      purgeBaseDir,
    });

    expect(result.exitCode).toBe(1);
    // 客户端配置移除依然成功
    expect(result.results[0]?.outcome).toBe('removed');
    // purge 阶段 cookie failed
    const cookieR = result.purgeResults?.find((r) => r.file === 'cookie');
    expect(cookieR?.outcome).toBe('failed');
    expect(cookieR?.error).toContain('EBUSY');

    expect(err.join('')).toContain('purge: cookie failed');
    expect(out.join('')).not.toContain('purge: cookie removed');
    spy.mockRestore();
  });

  it('without --purge but with leftover credentials, prints reminder', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    await fs.writeFile(join(purgeBaseDir, 'cookie'), 'c');

    const { stdout, stderr, out } = fakeStdio();
    const result = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(result.exitCode).toBe(0);
    expect(result.purgeResults).toBeUndefined();

    // cookie 文件未被触碰
    await expect(fs.access(join(purgeBaseDir, 'cookie'))).resolves.toBeUndefined();

    expect(out.join('')).toContain('提示:cookie/token 文件未清除');
  });

  it('without --purge and no leftover credentials, no reminder', async () => {
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    const { stdout, stderr, out } = fakeStdio();
    await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout,
      stderr,
      purgeBaseDir,
    });
    expect(out.join('')).not.toContain('提示:cookie/token 文件未清除');
  });
});

describe('runUninstall — summary format alignment with install', () => {
  let dir: string;
  let purgeBaseDir: string;
  let fakePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-fmt-'));
    purgeBaseDir = mkdtempSync(join(tmpdir(), 'tapd-uninstall-fmt-purge-'));
    fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(purgeBaseDir, { recursive: true, force: true });
  });

  it('uses ✔ for removed, = for noop, [dry-run], ✗ for failed', async () => {
    // 跑一个 removed
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    let io = fakeStdio();
    await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...io,
      purgeBaseDir,
    });
    expect(io.out.join('')).toContain('✔ claude-code');

    // 跑一个 noop(文件已无 tapd)
    io = fakeStdio();
    await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...io,
      purgeBaseDir,
    });
    expect(io.out.join('')).toContain('= claude-code');

    // dry-run(重新装一份让它有 tapd)
    await fs.writeFile(
      fakePath,
      JSON.stringify({ mcpServers: { tapd: { command: 'npx' } } }),
    );
    io = fakeStdio();
    await runUninstall({
      clients: ['claude-code'],
      dryRun: true,
      purge: false,
      ...io,
      purgeBaseDir,
    });
    expect(io.out.join('')).toContain('[dry-run] claude-code');

    // failed(让 write 抛错)
    vi.spyOn(claudeCodeAdapter, 'write').mockRejectedValueOnce(new Error('boom'));
    io = fakeStdio();
    const r = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      ...io,
      purgeBaseDir,
    });
    expect(r.exitCode).toBe(1);
    expect(io.out.join('')).toContain('✗ claude-code');
  });
});

describe('runUninstall — claude-code removes user-scope commands directory', () => {
  let tempHome: string;
  let tempClaudeJsonDir: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'tapd-uscmd-rm-home-'));
    tempClaudeJsonDir = mkdtempSync(join(tmpdir(), 'tapd-uscmd-rm-cj-'));
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(tempClaudeJsonDir, { recursive: true, force: true });
  });

  it('removes ~/.claude/commands/tapd-server-cli/ when uninstalling claude-code', async () => {
    // 准备 user-scope commands 目录（模拟 install 留下的状态）
    const cmdsDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    await fs.mkdir(cmdsDir, { recursive: true });
    await fs.writeFile(join(cmdsDir, 'login.md'), '# login');
    await fs.writeFile(join(cmdsDir, 'logout.md'), '# logout');

    // 准备 ~/.claude.json with mcpServers.tapd 让 uninstall 有东西删
    const fakeClaudePath = join(tempClaudeJsonDir, 'claude.json');
    await fs.writeFile(
      fakeClaudePath,
      JSON.stringify(
        { mcpServers: { tapd: { command: 'npx', args: ['-y', 'tapd-server-cli'], env: {} } } },
        null,
        2,
      ),
    );
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakeClaudePath);

    const io = fakeStdio();
    const r = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout: io.stdout,
      stderr: io.stderr,
      homedirOverride: tempHome,
    });

    expect(r.exitCode).toBe(0);
    // commands 目录被删
    await expect(fs.access(cmdsDir)).rejects.toThrow();
    expect(io.out.join('')).toContain('user-scope commands removed');
  });

  it('reports notPresent silently when commands directory does not exist', async () => {
    // 准备 ~/.claude.json with mcpServers.tapd
    const fakeClaudePath = join(tempClaudeJsonDir, 'claude.json');
    await fs.writeFile(
      fakeClaudePath,
      JSON.stringify(
        { mcpServers: { tapd: { command: 'npx', args: ['-y', 'tapd-server-cli'], env: {} } } },
        null,
        2,
      ),
    );
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakeClaudePath);

    const io = fakeStdio();
    const r = await runUninstall({
      clients: ['claude-code'],
      dryRun: false,
      purge: false,
      stdout: io.stdout,
      stderr: io.stderr,
      homedirOverride: tempHome,
    });

    expect(r.exitCode).toBe(0);
    expect(io.out.join('')).toContain('no user-scope commands to remove');
  });

  it('does not touch user-scope commands on dry-run', async () => {
    const cmdsDir = join(tempHome, '.claude', 'commands', 'tapd-server-cli');
    await fs.mkdir(cmdsDir, { recursive: true });
    await fs.writeFile(join(cmdsDir, 'login.md'), '# login');

    const fakeClaudePath = join(tempClaudeJsonDir, 'claude.json');
    await fs.writeFile(
      fakeClaudePath,
      JSON.stringify(
        { mcpServers: { tapd: { command: 'npx', args: ['-y', 'tapd-server-cli'], env: {} } } },
        null,
        2,
      ),
    );
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakeClaudePath);

    const io = fakeStdio();
    const r = await runUninstall({
      clients: ['claude-code'],
      dryRun: true,
      purge: false,
      stdout: io.stdout,
      stderr: io.stderr,
      homedirOverride: tempHome,
    });

    expect(r.exitCode).toBe(0);
    // dry-run 不删 commands 目录
    await expect(fs.access(cmdsDir)).resolves.toBeUndefined();
    await expect(fs.access(join(cmdsDir, 'login.md'))).resolves.toBeUndefined();
  });
});
