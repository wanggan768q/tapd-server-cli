/**
 * B1: 优先调用 Claude Code 官方 CLI `claude mcp add-json` 注册 MCP server。
 *
 * 决策（来自 openspec/changes/add-claude-code-plugin/design.md D4）：
 *   - 检测 `claude --version` 可用 → 调 `claude mcp add-json tapd '<json>' --scope user`
 *   - 不可用或失败 → 返回 used='fallback'，让调用方走现行手写 ~/.claude.json 路径
 *   - 5 秒超时（spawnSync.timeout=5000，SIGTERM 终止）
 *   - PAT 走 args 数组不经 shell expansion，不进 shell history
 *   - stderr 必须脱敏：抛错时移除任何 TAPD_TOKEN 值
 *
 * Windows 兼容（v0.4.2 修复）：自 Node.js 安全补丁 (CVE-2024-27980) 起，
 *   `spawnSync('claude.cmd', ..., { shell: false })` 会直接抛 EINVAL，
 *   且 `shell: true` + 含 PAT 的 args 是命令注入风险。统一改为
 *   `spawnSync('cmd.exe', ['/c', 'claude', ...args], { shell: false })`：
 *   cmd.exe 自身是 shell，会按 PATHEXT 解析 `claude.cmd`/`claude.ps1`/`claude.exe`，
 *   而 Node 内部对 args 数组按 cmd.exe 规则做 quoting/escape，零注入面。
 *   非 win32 仍按原 POSIX 路径直跑 `claude`。
 *
 * Note: preferClaudeCliInstall 顶层包 try/catch 把注入式 probe 的 throw 转成
 *       fallback + redacted stderr，确保对外"永不抛"契约（与 codex-cli 对称）。
 */

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncOptions } from 'node:child_process';

import { redact, redactError } from './redact.js';

export interface ClaudeCliProbe {
  /** 检查 `claude --version` 是否可执行（PATH 里有且能跑通） */
  isAvailable(): boolean;
  /**
   * 调用 `claude mcp add-json <name> '<json>' --scope <scope>`，返回成功/失败 + stderr。
   * 超时返回 `{ ok: false, stderr: '' }`（spawn timeout 时 stderr 通常为空）。
   */
  addJson(
    name: string,
    json: string,
    scope: 'user' | 'local' | 'project',
  ): { ok: boolean; stderr: string };
}

const SPAWN_TIMEOUT_MS = 5000;

function isWin32(): boolean {
  return (process.env.TAPD_TEST_PLATFORM ?? process.platform) === 'win32';
}

/**
 * win32 下统一用 `cmd.exe /c <bin> ...args` 调 npm 全局安装的 Node CLI shim。
 * 直接 spawn `bin.cmd` 在 shell:false 下会触发 EINVAL（Node CVE-2024-27980 补丁后），
 * 而 shell:true 会让 args 受 cmd.exe 命令行解析影响、含 PAT 时形成注入面。
 *
 * 这里把 cmd.exe 自身当作可执行体，args 数组通过 Node 的内部 win32 escape
 * 模块传入；返回的 [executable, args] 直接喂 spawnSync 即可。
 */
function buildSpawnArgs(bin: string, args: readonly string[]): [string, string[]] {
  if (isWin32()) {
    return ['cmd.exe', ['/c', bin, ...args]];
  }
  return [bin, [...args]];
}

/**
 * Windows 上 `claude` 由 npm 全局安装时实际是 `claude.cmd`/`claude.ps1`/`claude.exe`；
 * 走 `cmd.exe /c claude` 让 cmd.exe 自己按 PATHEXT 解析候选名，无需我们逐个探测。
 *
 * 测试钩子：`process.env.TAPD_TEST_PLATFORM` 可被设为 'win32' / 'linux' / 'darwin'
 * 强制走指定分支，便于跨平台单测。
 */

/** 默认实现：spawn 真实 `claude` 子进程 */
export function defaultClaudeCliProbe(): ClaudeCliProbe {
  return {
    isAvailable() {
      try {
        const [exe, exeArgs] = buildSpawnArgs('claude', ['--version']);
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
    addJson(name, json, scope) {
      try {
        const [exe, exeArgs] = buildSpawnArgs(
          'claude',
          ['mcp', 'add-json', name, json, '--scope', scope],
        );
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
 * 高阶函数：尝试用 CLI 注册；CLI 不可用或失败时返回 fallback 让调用方走手写路径。
 *
 * @param tapdEnv  注入到 mcpServers.tapd.env 的环境变量（含 TAPD_TOKEN）
 * @param probe    注入式探针（默认走真实 claude CLI）
 * @returns        used='cli' 表示已通过 CLI 写入；used='fallback' 表示要走手写
 */
export async function preferClaudeCliInstall(
  tapdEnv: Record<string, string>,
  probe: ClaudeCliProbe = defaultClaudeCliProbe(),
): Promise<{ used: 'cli' | 'fallback'; stderr?: string }> {
  if (!probe.isAvailable()) {
    return { used: 'fallback' };
  }
  const json = JSON.stringify({
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tapd-server-cli'],
    env: tapdEnv,
  });
  let result: { ok: boolean; stderr: string };
  try {
    result = probe.addJson('tapd', json, 'user');
  } catch (err) {
    return { used: 'fallback', stderr: redactError(err, tapdEnv) };
  }
  if (result.ok) {
    return { used: 'cli' };
  }
  return {
    used: 'fallback',
    stderr: redact(result.stderr, tapdEnv),
  };
}
