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
 * Windows 兼容（B1 修复）：npm 全局安装的 `claude` 实际是 `claude.cmd`，
 *   spawnSync 在 `shell: false` 下不走 PATHEXT 解析会 ENOENT。这里在 win32
 *   上按顺序尝试 `claude.cmd` → `claude.ps1` → `claude.exe` → `claude`，
 *   命中即用其名启动；仍保持 `shell: false` 不引入 shell 注入面。
 */

import { spawnSync } from 'node:child_process';

export interface ClaudeCliProbe {
  /** 检查 `claude --version` 是否可执行（PATH 里有且能跑通） */
  isAvailable(): boolean;
  /** 调用 `claude mcp add-json <name> '<json>' --scope <scope>`，返回成功/失败 + stderr */
  addJson(
    name: string,
    json: string,
    scope: 'user' | 'local' | 'project',
  ): { ok: boolean; stderr: string };
}

const SPAWN_TIMEOUT_MS = 5000;

/**
 * Windows 上 `claude` 可能是 `claude.cmd`/`claude.ps1`/`claude.exe`；
 * spawnSync 在 `shell: false` 下不走 PATHEXT 解析，bare `'claude'` 会 ENOENT。
 * 这里用候选名顺序探测，第一个 `--version` 退 0 的就是它。
 *
 * 测试钩子：`process.env.TAPD_TEST_PLATFORM` 可被设为 'win32' / 'linux' / 'darwin'
 * 强制走指定分支，便于跨平台单测。
 */
function resolveClaudeBinaryName(): string {
  const platform = process.env.TAPD_TEST_PLATFORM ?? process.platform;
  if (platform !== 'win32') return 'claude';
  const candidates = ['claude.cmd', 'claude.ps1', 'claude.exe', 'claude'];
  for (const name of candidates) {
    try {
      const r = spawnSync(name, ['--version'], {
        stdio: 'ignore',
        timeout: SPAWN_TIMEOUT_MS,
        shell: false,
      });
      if (r.status === 0) return name;
    } catch {
      // 试下一个候选名
    }
  }
  return 'claude'; // 都不可用时仍返回 'claude'，让上层 isAvailable() 报告 false
}

/** 默认实现：spawn 真实 `claude` 子进程 */
export function defaultClaudeCliProbe(): ClaudeCliProbe {
  const bin = resolveClaudeBinaryName();
  return {
    isAvailable() {
      try {
        const r = spawnSync(bin, ['--version'], {
          stdio: 'ignore',
          timeout: SPAWN_TIMEOUT_MS,
          shell: false,
        });
        return r.status === 0;
      } catch {
        return false;
      }
    },
    addJson(name, json, scope) {
      try {
        const r = spawnSync(
          bin,
          ['mcp', 'add-json', name, json, '--scope', scope],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: SPAWN_TIMEOUT_MS,
            encoding: 'utf8',
            shell: false,
          },
        );
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

/** 从字符串里清掉所有 env 值（防 PAT 出现在 stderr） */
function redact(text: string, env: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(env)) {
    if (v && v.length >= 4) {
      out = out.split(v).join('***');
    }
  }
  return out;
}

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
    const msg = err instanceof Error ? err.message : String(err);
    return { used: 'fallback', stderr: redact(msg, tapdEnv) };
  }
  if (result.ok) {
    return { used: 'cli' };
  }
  return {
    used: 'fallback',
    stderr: redact(result.stderr, tapdEnv),
  };
}
