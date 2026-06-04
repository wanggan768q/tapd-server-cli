/**
 * `tapd-server-cli update` 子命令实现。
 *
 * 替代被 §A 删除的 MCP 工具 `tapd.update`。仅"检查"，不自动升级——
 * 输出建议命令让用户自行决定（多客户端环境下自动升级风险高）。
 *
 * 流程：
 *   1) 读取本地 package.json 的 version 当 current
 *   2) spawn `npm view tapd-server-cli version`（5s 超时）拿 latest
 *   3) compare(current, latest) → uptodate / outdated / ahead
 *   4) 文本模式 / JSON 模式（按 --json）
 *   5) 网络/spawn 失败：仍 exit 0，只在输出里说"网络错误"
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { readPackageVersion } from '../runtime/package-version.js';

export interface UpdateCommandOptions {
  json?: boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  /** 测试注入：覆盖读 package.json 与 spawn npm view */
  deps?: {
    readCurrentVersion?: () => string;
    fetchLatestVersion?: () => string;
  };
}

export interface UpdateCommandResult {
  exitCode: 0;
  /** 'uptodate' | 'outdated' | 'ahead' | 'fetch_error' */
  comparison: 'uptodate' | 'outdated' | 'ahead' | 'fetch_error';
  current: string;
  latest: string | null;
  fetchError?: string;
}

const SPAWN_TIMEOUT_MS = 5_000;

/**
 * 简易 SemVer 比较：仅处理 major.minor.patch（忽略 prerelease 标签）。
 * 返回 -1 / 0 / 1，对应 a<b / a==b / a>b。
 *
 * 不引 semver 包是为了避免在 v0.3.0 minor 引入新依赖；TAPD MCP server
 * 自己的版本号永远遵循三段数字。
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): [number, number, number] => {
    const stripped = v.replace(/^v/, '').split('-')[0] ?? '0.0.0';
    const parts = stripped.split('.').map((n) => Number.parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

function defaultReadCurrentVersion(): string {
  // 复用 runtime/package-version.ts 的单一来源，避免再发明一份 createRequire 读 package.json
  // 的逻辑（同时与 server.ts 的 serverInfo.version 保证字节一致）。
  return readPackageVersion();
}

function resolveNpmBinaryName(): string {
  const platform = process.env.TAPD_TEST_PLATFORM ?? process.platform;
  if (platform !== 'win32') return 'npm';
  // npm 全局安装在 win32 上是 npm.cmd
  return 'npm.cmd';
}

function isWin32(): boolean {
  return (process.env.TAPD_TEST_PLATFORM ?? process.platform) === 'win32';
}

/**
 * win32 下统一用 `cmd.exe /c npm ...args` 调 .cmd shim：
 *   - 直接 spawn `npm.cmd` + shell:false 会触发 EINVAL (Node CVE-2024-27980 补丁后)
 *   - shell:true 会让 args 受 cmd.exe 命令行解析影响，未来若 args 变 user-supplied 是注入面
 *   - cmd.exe 自身是 shell，会按 PATHEXT 解析 `npm.cmd`，
 *     Node 内部对 args 数组按 cmd.exe 规则 quoting，零注入面
 * 与 installer/claude-cli.ts、installer/codex-cli.ts 的 buildSpawnArgs 对称。
 */
function buildSpawnArgs(bin: string, args: readonly string[]): [string, string[]] {
  if (isWin32()) {
    // 注意：win32 分支直接用裸名 'npm'，让 cmd.exe 按 PATHEXT 解析为 .cmd。
    // 不再需要 resolveNpmBinaryName() 返回的 'npm.cmd'。
    const baseName = bin.replace(/\.cmd$/i, '');
    return ['cmd.exe', ['/c', baseName, ...args]];
  }
  return [bin, [...args]];
}

function defaultFetchLatestVersion(): string {
  const bin = resolveNpmBinaryName();
  // win32 → cmd.exe /c npm view ...；其他平台 → npm view ...
  // 详见 buildSpawnArgs 注释。
  const [exe, exeArgs] = buildSpawnArgs(bin, ['view', 'tapd-server-cli', 'version']);
  const r = spawnSync(exe, exeArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: SPAWN_TIMEOUT_MS,
    encoding: 'utf8',
    shell: false,
  });
  if (r.status !== 0) {
    const stderr = typeof r.stderr === 'string' ? r.stderr : '';
    const errMsg = r.error instanceof Error ? r.error.message : '';
    // npm 的 stderr 经常含 Node TLS warning 等噪声，取最后一行非空内容当原因
    const lastNonEmpty = stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop();
    const reason = lastNonEmpty || errMsg || 'unknown';
    throw new Error(`npm view failed (status=${r.status ?? 'null'}): ${reason}`);
  }
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  const v = out.trim();
  if (v.length === 0) {
    throw new Error('npm view 返回空字符串');
  }
  return v;
}

export async function updateCommand(
  opts: UpdateCommandOptions = {},
): Promise<UpdateCommandResult> {
  const stdout = opts.stdout ?? process.stdout;
  const json = !!opts.json;
  const readCurrent = opts.deps?.readCurrentVersion ?? defaultReadCurrentVersion;
  const fetchLatest = opts.deps?.fetchLatestVersion ?? defaultFetchLatestVersion;

  let current: string;
  try {
    current = readCurrent();
  } catch (err) {
    // 极端：读不到自己的 package.json。退化为 unknown/exit 0，避免阻断。
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      stdout.write(
        `${JSON.stringify(
          {
            current: 'unknown',
            latest: null,
            comparison: 'fetch_error',
            fetch_error: `read package.json failed: ${msg}`,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      stdout.write(`× 无法读取本地版本号：${msg}\n`);
    }
    return {
      exitCode: 0,
      comparison: 'fetch_error',
      current: 'unknown',
      latest: null,
      fetchError: msg,
    };
  }

  let latest: string;
  try {
    latest = fetchLatest();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      stdout.write(
        `${JSON.stringify(
          {
            current,
            latest: null,
            comparison: 'fetch_error',
            fetch_error: msg,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      stdout.write(`× Network error: 无法从 npm 获取最新版本（${msg}）\n`);
      stdout.write(`  当前版本：${current}\n`);
    }
    return {
      exitCode: 0,
      comparison: 'fetch_error',
      current,
      latest: null,
      fetchError: msg,
    };
  }

  const cmp = compareSemver(current, latest);
  const comparison: 'uptodate' | 'outdated' | 'ahead' =
    cmp === 0 ? 'uptodate' : cmp < 0 ? 'outdated' : 'ahead';

  if (json) {
    stdout.write(
      `${JSON.stringify(
        {
          current,
          latest,
          comparison,
          upgrade_commands: comparison === 'outdated'
            ? [
                'npm i -g tapd-server-cli@latest',
                'npx tapd-server-cli@latest install claude-code',
              ]
            : [],
        },
        null,
        2,
      )}\n`,
    );
  } else if (comparison === 'uptodate') {
    stdout.write(`✓ Up to date (${current})\n`);
  } else if (comparison === 'outdated') {
    stdout.write(`↑ Update available: ${current} → ${latest}\n`);
    stdout.write(`  全局升级：  npm i -g tapd-server-cli@latest\n`);
    stdout.write(`  按需运行：  npx tapd-server-cli@latest install claude-code\n`);
  } else {
    // ahead：本地比 npm 新（很可能是开发版）
    stdout.write(`◇ Local version (${current}) is ahead of npm (${latest})\n`);
  }

  return { exitCode: 0, comparison, current, latest };
}
