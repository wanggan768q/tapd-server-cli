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
 * Windows 兼容（B1 修复）：与 claude-cli 对称，按 PATHEXT 顺序探测
 *   `codex.cmd` → `codex.ps1` → `codex.exe` → `codex`，仍保持 `shell: false`。
 *
 * Note: preferCodexCliInstall 顶层包 try/catch 把注入式 probe 的 throw 转成
 *       fallback + redacted stderr，确保对外"永不抛"契约（与 claude-cli 对称）。
 */

import { spawnSync } from 'node:child_process';

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

/**
 * Windows 上 `codex` 可能是 `codex.cmd`/`codex.ps1`/`codex.exe`；
 * 与 claude-cli.ts 对称，按 PATHEXT 顺序探测，仍保持 `shell: false`。
 */
function resolveCodexBinaryName(): string {
  const platform = process.env.TAPD_TEST_PLATFORM ?? process.platform;
  if (platform !== 'win32') return 'codex';
  const candidates = ['codex.cmd', 'codex.ps1', 'codex.exe', 'codex'];
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
  return 'codex';
}

export function defaultCodexCliProbe(): CodexCliProbe {
  const bin = resolveCodexBinaryName();
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
    addStdio(name, command, args, env) {
      // codex mcp add <name> --env K1=V1 --env K2=V2 ... -- <command> [args...]
      const cliArgs = ['mcp', 'add', name];
      for (const [k, v] of Object.entries(env)) {
        cliArgs.push('--env', `${k}=${v}`);
      }
      cliArgs.push('--', command, ...args);
      try {
        const r = spawnSync(bin, cliArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: SPAWN_TIMEOUT_MS,
          encoding: 'utf8',
          shell: false,
        });
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

/** 从字符串里清掉所有长度 >= 4 的 env 值（防 PAT 出现在 stderr） */
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
    const msg = err instanceof Error ? err.message : String(err);
    return {
      used: 'fallback',
      stderr: redact(msg, tapdEnv),
    };
  }
}
