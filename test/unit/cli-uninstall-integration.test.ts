/**
 * Uninstall CLI 入口的集成测试。
 *
 * 通过 `tsx` fork 一个子进程跑 `src/index.ts uninstall ...`,捕获 stdout / stderr / exit code,
 * 确保 cli.ts → index.ts(uninstall 分支) → uninstall-flow 的端到端链路联通。
 *
 * 这些测试都用 dry-run 或临时 HOME,不会触碰用户真实配置。
 */

import { spawn } from 'node:child_process';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const INDEX_TS = resolve(PROJECT_ROOT, 'src', 'index.ts');
const TSX_BIN = resolve(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  timeoutMs = 15_000,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Windows 上 .cmd / .bat 必须通过 shell 启动,否则 spawn 抛 EINVAL。
    const isWin = process.platform === 'win32';
    const child = spawn(TSX_BIN, [INDEX_TS, ...argv], {
      env: {
        ...process.env,
        ...env,
        NODE_OPTIONS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    child.stderr?.on('data', (b: Buffer) => (stderr += b.toString('utf8')));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('uninstall CLI integration', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tapd-cli-uninstall-home-'));
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('uninstall --dry-run on empty HOME reports noop with exit 0', async () => {
    // 临时 HOME 下无 ~/.claude.json,uninstall 应识别为 noop
    const r = await runCli(['uninstall', 'claude-code', '--dry-run'], {
      HOME: homeDir,
      USERPROFILE: homeDir, // Windows
    });
    expect(r.exitCode).toBe(0);
    // dry-run 模式 + 文件不存在:输出 [dry-run] 且报告 tapd 条目不存在
    expect(r.stdout).toContain('[dry-run]');
    expect(r.stdout).toContain('tapd 条目不存在');
  });

  it('uninstall with unknown client exits 2', async () => {
    const r = await runCli(['uninstall', 'bogus-ide'], {
      HOME: homeDir,
      USERPROFILE: homeDir,
    });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('未识别的客户端');
  });

  it('uninstall --dry-run with existing tapd entry shows preview', async () => {
    // 准备 ~/.claude.json with tapd 条目
    await fs.writeFile(
      join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          tapd: { command: 'npx', args: ['-y', 'tapd-server-cli'], env: { TAPD_TOKEN: 'x' } },
          gitlab: { command: 'gl' },
        },
      }),
    );

    const r = await runCli(['uninstall', 'claude-code', '--dry-run'], {
      HOME: homeDir,
      USERPROFILE: homeDir,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[dry-run] claude-code');
    expect(r.stdout).toContain('当前 tapd 条目');
    expect(r.stdout).toContain('gitlab');

    // 文件未被改写
    const content = JSON.parse(
      await fs.readFile(join(homeDir, '.claude.json'), 'utf8'),
    );
    expect(content.mcpServers.tapd).toBeDefined();
  });

  it('uninstall actually removes tapd entry and preserves others', async () => {
    await fs.writeFile(
      join(homeDir, '.claude.json'),
      JSON.stringify({
        projects: { '/p': {} },
        mcpServers: {
          tapd: { command: 'npx', args: ['-y'], env: { TAPD_TOKEN: 'x' } },
          gitlab: { command: 'gl' },
        },
      }),
    );

    const r = await runCli(['uninstall', 'claude-code'], {
      HOME: homeDir,
      USERPROFILE: homeDir,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('✔ claude-code');

    const content = JSON.parse(
      await fs.readFile(join(homeDir, '.claude.json'), 'utf8'),
    );
    expect(content.mcpServers.tapd).toBeUndefined();
    expect(content.mcpServers.gitlab).toEqual({ command: 'gl' });
    expect(content.projects).toEqual({ '/p': {} });
  });
}, 60_000);
