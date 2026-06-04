/**
 * B1: 优先调用 Codex 官方 CLI `codex mcp add` 注册 MCP server。
 *
 * 决策（来自 openspec/changes/add-claude-code-plugin/design.md D4）：
 *   - 检测 `codex --version` 可用 → 调 `codex mcp add tapd --env K=V ... -- npx -y tapd-server-cli`
 *   - 不可用或失败 → 返回 used='fallback'，让调用方走现行手写 ~/.codex/config.toml 路径
 *   - 5 秒超时
 *   - PAT 走 args 数组不进 shell history
 *   - stderr 脱敏
 *
 * Windows 兼容（v0.4.2 修复）：自 Node.js 安全补丁 (CVE-2024-27980) 起，
 *   `spawnSync('codex.cmd', ..., { shell: false })` 会直接抛 EINVAL，
 *   且 `shell: true` + 含 PAT 的 args 是命令注入风险。统一改为
 *   `spawnSync('cmd.exe', ['/c', 'codex', ...args], { shell: false })`：
 *   cmd.exe 自身是 shell，会按 PATHEXT 解析 `codex.cmd`/`codex.ps1`/`codex.exe`，
 *   Node 内部对 args 数组按 cmd.exe 规则做 quoting/escape，零注入面。
 *   非 win32 仍按原 POSIX 路径直跑 `codex`。
 *
 * Note: preferCodexCliInstall 顶层包 try/catch 把注入式 probe 的 throw 转成
 *       fallback + redacted stderr，确保对外"永不抛"契约（与 claude-cli 对称）。
 */

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncOptions } from 'node:child_process';

import { redact, redactError } from './redact.js';

export interface CodexCliProbe {
  /** 检查 `codex --version` 是否可执行 */
  isAvailable(): boolean;
  /**
   * 等价于 `codex mcp add <name> --env K1=V1 --env K2=V2 ... -- <command> [args...]`。
   * 超时返回 `{ ok: false, stderr: '' }`（spawn timeout 时 stderr 通常为空）。
   */
  addStdio(
    name: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ): { ok: boolean; stderr: string };
}

const SPAWN_TIMEOUT_MS = 5000;

function isWin32(): boolean {
  return (process.env.TAPD_TEST_PLATFORM ?? process.platform) === 'win32';
}

/**
 * win32 下统一用 `cmd.exe /c <bin> ...args` 调 npm 全局安装的 Node CLI shim。
 * 详见 claude-cli.ts 同名函数的注释（对称实现）。
 */
function buildSpawnArgs(bin: string, args: readonly string[]): [string, string[]] {
  if (isWin32()) {
    return ['cmd.exe', ['/c', bin, ...args]];
  }
  return [bin, [...args]];
}

export function defaultCodexCliProbe(): CodexCliProbe {
  return {
    isAvailable() {
      try {
        const [exe, exeArgs] = buildSpawnArgs('codex', ['--version']);
        const opts: SpawnSyncOptions = {
          stdio: 'ignore',
          timeout: SPAWN_TIMEOUT_MS,
          shell: false,
        };
        const r = spawnSync(exe, exeArgs, opts);
        return r.status === 0;
      } catch {
        return false;
      }
    },
    addStdio(name, command, args, env) {
      // codex mcp add <name> --env K1=V1 --env K2=V2 ... -- <command> [args...]
      const cliArgs = ['mcp', 'add', name];
      for (const [k, v] of Object.entries(env)) {
        cliArgs.push('--env', `${k}=${v}`);
      }
      cliArgs.push('--', command, ...args);
      try {
        const [exe, exeArgs] = buildSpawnArgs('codex', cliArgs);
        const opts: SpawnSyncOptionsWithStringEncoding = {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: SPAWN_TIMEOUT_MS,
          encoding: 'utf8',
          shell: false,
        };
        const r = spawnSync(exe, exeArgs, opts);
        return {
          ok: r.status === 0,
          stderr: typeof r.stderr === 'string' ? r.stderr : '',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, stderr: msg };
      }
    },
  };
}

/** 从字符串里清掉所有 env 值（防 PAT 出现在 stderr） — 现已抽到 ./redact.ts。 */

/**
 * 高阶函数：尝试用 codex CLI 注册；CLI 不可用或失败时返回 fallback 让调用方走手写 TOML 路径。
 *
 * 当前实现为同步逻辑，async 签名为后续替换 probe 实现保留接口稳定。
 */
export async function preferCodexCliInstall(
  tapdEnv: Record<string, string>,
  probe: CodexCliProbe = defaultCodexCliProbe(),
): Promise<{ used: 'cli' | 'fallback'; stderr?: string }> {
  if (!probe.isAvailable()) {
    return { used: 'fallback' };
  }
  try {
    const result = probe.addStdio('tapd', 'npx', ['-y', 'tapd-server-cli'], tapdEnv);
    if (result.ok) {
      return { used: 'cli' };
    }
    return {
      used: 'fallback',
      stderr: redact(result.stderr, tapdEnv),
    };
  } catch (err) {
    return {
      used: 'fallback',
      stderr: redactError(err, tapdEnv),
    };
  }
}
