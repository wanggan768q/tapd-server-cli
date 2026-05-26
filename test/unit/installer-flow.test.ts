import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInstall } from '../../src/installer/flow.js';
import { claudeCodeAdapter } from '../../src/installer/adapters/claude-code.js';

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
      client: 'unknown-ide',
      dryRun: false,
      stdout,
      stderr,
      tokenOverride: 'x',
    });
    expect(result.exitCode).toBe(2);
    expect(err.join('')).toContain('未识别的客户端');
  });
});

describe('runInstall — dry-run', () => {
  it('does not touch the filesystem and prints plan', async () => {
    // 用 spy 替换 adapter.configPath() 指向临时目录，验证不被写入
    const dir = mkdtempSync(join(tmpdir(), 'tapd-flow-dryrun-'));
    const fakePath = join(dir, 'claude.json');
    vi.spyOn(claudeCodeAdapter, 'configPath').mockReturnValue(fakePath);
    try {
      const { stdout, stderr, out } = fakeStdio();
      const result = await runInstall({
        client: 'claude-code',
        dryRun: true,
        stdout,
        stderr,
        tokenOverride: 'token-xyz',
      });
      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('dry-run');
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

describe('runInstall — write then noop on second run', () => {
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
      client: 'claude-code',
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'same-token',
    });
    expect(first.exitCode).toBe(0);
    expect(first.outcome).toBe('wrote');
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('same-token');

    const second = await runInstall({
      client: 'claude-code',
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'same-token',
    });
    expect(second.exitCode).toBe(0);
    expect(second.outcome).toBe('noop');
  });

  it('different token triggers backup + overwrite', async () => {
    await runInstall({
      client: 'claude-code',
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'token-a',
    });
    const second = await runInstall({
      client: 'claude-code',
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 'token-b',
    });
    expect(second.exitCode).toBe(0);
    expect(second.outcome).toBe('wrote');
    expect(second.backup).toBeDefined(); // hint text containing .bak.<ts>
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
      client: 'claude-code',
      dryRun: false,
      ...fakeStdio(),
      tokenOverride: 't',
    });
    expect(r.outcome).toBe('wrote');
    const content = JSON.parse(await fs.readFile(fakePath, 'utf8'));
    expect(content.projects).toEqual({ '/some/path': { thing: 1 } });
    expect(content.mcpServers.other).toEqual({ command: 'foo' });
    expect(content.mcpServers.tapd.env.TAPD_TOKEN).toBe('t');
  });
});
