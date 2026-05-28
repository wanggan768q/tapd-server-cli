/**
 * tapd.update — 检查 server 与 npm registry 上的最新版本对比，并按用户的安装路径
 *               给出针对性升级指令。
 *
 * 实现要点（详见 openspec/changes/add-tapd-update-command/design.md）：
 *   D2  — 工具型，非启动时自动检查
 *   D3  — current 来自编译时内联的 src/runtime/version.ts
 *   D4  — latest 来自 spawnSync('npm', ['view', ...])，5s 超时，Windows 走 .cmd 探测
 *   D5  — installed_via 双信号：CLAUDE_PLUGIN_ROOT env + argv[1] 路径
 *   D6  — upgrade_commands 按 installed_via 分流
 *
 * 安全契约（spec：update-command「工具调用绝不能泄漏环境敏感值」）：
 *   - 所有 fetch 错误都走 redactError() 脱敏，复用 PR #1 follow-up 的 redact 工具
 */

import { spawnSync } from 'node:child_process';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { redactError } from '../installer/redact.js';
import { VERSION } from '../runtime/version.js';

// -- 公开类型 --------------------------------------------------------------

export type Comparison = 'up-to-date' | 'update-available' | 'unknown';
export type InstalledVia = 'plugin' | 'npx';

export interface UpgradeCommand {
  label: string;
  steps: string[];
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  comparison: Comparison;
  installed_via: InstalledVia;
  upgrade_commands: UpgradeCommand[];
  note: string | null;
  fetch_error: string | null;
}

/** 注入式 probe，便于单测脱离真实 npm CLI 调用。 */
export interface NpmViewProbe {
  /**
   * 调用 `npm view tapd-server-cli version`。
   * 返回：
   *   - { ok: true, version: '0.3.0' }
   *   - { ok: false, error: string }
   */
  fetchLatestVersion(packageName: string): { ok: true; version: string } | { ok: false; error: string };
}

// -- 默认 probe（spawn 真实 npm，复用 claude-cli/codex-cli 的 Windows 兼容范式） -----

const NPM_TIMEOUT_MS = 5000;

function resolveNpmBinaryName(): string {
  const platform = process.env.TAPD_TEST_PLATFORM ?? process.platform;
  if (platform !== 'win32') return 'npm';
  const candidates = ['npm.cmd', 'npm.ps1', 'npm.exe', 'npm'];
  for (const name of candidates) {
    try {
      const r = spawnSync(name, ['--version'], {
        stdio: 'ignore',
        timeout: NPM_TIMEOUT_MS,
        shell: false,
      });
      if (r.status === 0) return name;
    } catch {
      // 试下一个候选名
    }
  }
  return 'npm';
}

export function defaultNpmViewProbe(): NpmViewProbe {
  const bin = resolveNpmBinaryName();
  return {
    fetchLatestVersion(packageName) {
      try {
        const r = spawnSync(bin, ['view', packageName, 'version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: NPM_TIMEOUT_MS,
          encoding: 'utf8',
          shell: false,
        });
        if (r.signal === 'SIGTERM' || (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
          return { ok: false, error: `timeout (${NPM_TIMEOUT_MS / 1000}s)` };
        }
        if (r.error) {
          return { ok: false, error: r.error.message };
        }
        if (r.status !== 0) {
          const stderr = (typeof r.stderr === 'string' ? r.stderr : '').trim();
          return { ok: false, error: stderr || `npm view exited with code ${r.status}` };
        }
        const version = (typeof r.stdout === 'string' ? r.stdout : '').trim();
        if (!version) {
          return { ok: false, error: 'npm view returned empty output' };
        }
        return { ok: true, version };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  };
}

// -- 纯函数（可独立单测） --------------------------------------------------

/**
 * 双信号检测安装路径：CLAUDE_PLUGIN_ROOT env > argv 路径包含 .claude/plugins。
 * 都不命中视为 npx 路径（npx 路径下我们无法可靠区分 claude / codex / cursor，
 * 由 Claude 在对话里追问）。
 */
export function detectInstalledVia(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): InstalledVia {
  if (env.CLAUDE_PLUGIN_ROOT) return 'plugin';
  const exe = argv[1] ?? '';
  if (exe.includes('.claude/plugins/') || exe.includes('.claude\\plugins\\')) {
    return 'plugin';
  }
  return 'npx';
}

/**
 * 比较 current 与 latest 的 semver。两者相等 → up-to-date，
 * current < latest → update-available，latest 为 null 或不���比 → unknown。
 *
 * 这里只做最小可用的 semver 比较（major.minor.patch），不处理 pre-release —
 * 对于 plugin 升级提示场景已��够，过于严格反而对 0.x.y-rc1 这种 unreleased 误报。
 */
export function compareVersions(current: string, latest: string | null): Comparison {
  if (latest === null) return 'unknown';
  const cur = parseSemverCore(current);
  const lat = parseSemverCore(latest);
  if (!cur || !lat) return 'unknown';
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) < (lat[i] ?? 0)) return 'update-available';
    if ((cur[i] ?? 0) > (lat[i] ?? 0)) return 'up-to-date';
  }
  return 'up-to-date';
}

function parseSemverCore(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 按 installed_via × comparison 给出针对性的升级步骤数组。
 * up-to-date → 空数组；update-available → 主路径 + 备选；unknown → 仅"如何手动检查"。
 */
export function buildUpgradeCommands(
  installedVia: InstalledVia,
  comparison: Comparison,
): UpgradeCommand[] {
  if (comparison === 'up-to-date') return [];
  if (comparison === 'unknown') {
    return [
      {
        label: '如何手动检查 latest',
        steps: [
          'npm view tapd-server-cli version    # 查看 npm registry 上的最新版本',
          '若返回值大于当前 server 版本，按下面对应你的安装路径升级：',
          'plugin 路径：在 Claude Code 内输入 /plugin marketplace update tapd-server-cli',
          'npx 路径：在终端执行 npx -y tapd-server-cli@latest install <client>（client 替换为 claude-code / codex / opencode / cursor）',
        ],
      },
    ];
  }
  // update-available
  if (installedVia === 'plugin') {
    return [
      {
        label: 'Claude Code plugin 路径（推荐）',
        steps: [
          '/plugin marketplace update tapd-server-cli',
          '/plugin install tapd-server-cli@tapd-server-cli',
          '完全退出并重启 Claude Code（quit, 不是 reload）',
        ],
      },
    ];
  }
  // installedVia === 'npx'
  return [
    {
      label: '已用 npx install 路径（任意客户端）',
      steps: [
        'npx -y tapd-server-cli@latest install <client>    # client 替换为 claude-code / codex / opencode / cursor',
        '重启对应客户端',
      ],
    },
    {
      label: '改用 Claude Code plugin 路径（仅 Claude Code 用户）',
      steps: ['参见 README「在 Claude Code 中安装（推荐）」节'],
    },
  ];
}

// -- 主入口 + MCP 注册 -----------------------------------------------------

export interface UpdateToolDeps {
  /** 注入式 probe（默认走真实 npm view） */
  probe?: NpmViewProbe;
  /** 注入 process.env 与 argv 便于测试；默认值为真实 process */
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
}

/**
 * 计算完整 UpdateInfo（不依赖 MCP server，便于单测/集成测复用）。
 */
export function computeUpdateInfo(deps: UpdateToolDeps = {}): UpdateInfo {
  const probe = deps.probe ?? defaultNpmViewProbe();
  const env = deps.env ?? process.env;
  const argv = deps.argv ?? process.argv;

  const installed_via = detectInstalledVia(env, argv);
  const current = VERSION;

  let latest: string | null = null;
  let fetch_error: string | null = null;
  try {
    const r = probe.fetchLatestVersion('tapd-server-cli');
    if (r.ok) {
      latest = r.version;
    } else {
      fetch_error = redactError(r.error, env as Record<string, string>);
    }
  } catch (err) {
    // 防御：probe 不应抛，但万一抛了也按 fetch failed 处理而不是冒泡
    fetch_error = redactError(err, env as Record<string, string>);
  }

  const comparison = compareVersions(current, latest);
  const upgrade_commands = buildUpgradeCommands(installed_via, comparison);

  // 兼并存提示：env 标识 plugin 但用户家目录里同时存在 user-scope 的 tapd 配置时，
  // 不在 server 进程里再 IO 检测——把这条提示放到 README/故障排查表，避免 server 启动慢。
  const note: string | null = null;

  return {
    current,
    latest,
    comparison,
    installed_via,
    upgrade_commands,
    note,
    fetch_error,
  };
}

/** 把 UpdateInfo 包装成 MCP 工具响应（content[0]=text, structuredContent=info）。 */
function infoToToolResult(info: UpdateInfo) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
    structuredContent: info as unknown as Record<string, unknown>,
  };
}

export function registerUpdateTool(server: McpServer, deps: UpdateToolDeps = {}): void {
  server.registerTool(
    'tapd.update',
    {
      title: 'tapd-server-cli 版本检查与升级建议',
      description:
        '查询当前 server 进程版本、npm registry 上的最新版本、推断的安装路径（plugin/npx），并按安装路径给出升级指令。无入参，对外永不抛错（网络受限时 latest 降级为 null）。',
      inputSchema: {},
    },
    async () => {
      const info = computeUpdateInfo(deps);
      return infoToToolResult(info);
    },
  );
}
