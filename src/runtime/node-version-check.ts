/**
 * Node.js 版本运行时自检（v0.3.x 起）。
 *
 * 为什么不仅靠 package.json.engines？
 *   - npm 默认 `engine-strict=false`，EBADENGINE 是 warning 不是 error，
 *     用户不读 warning 就装上了"半成品"，跑到 inquirer/checkbox 时才崩
 *   - 我们自己写明确的中文提示 + exit code 2，比 EBADENGINE 友好得多
 *
 * 阈值：22.13.0
 *   - @inquirer/checkbox 实测下限（其 engines 写 `^22.13.0 || ^20.17.0 ||
 *     >=23.5.0`，但 Node 20 在我们直接依赖里被 commander 与 undici 砍掉
 *     —— 它们都要求 22.x+；与现实对齐选 22.13）
 *   - 与 package.json.engines.node 字面一致
 *
 * 入口：src/index.ts main() 第一行调 assertNodeVersion()，覆盖所有子命令
 *   （install/uninstall/login/logout/update）和 server 启动模式。
 */

const REQUIRED_MAJOR = 22;
const REQUIRED_MINOR = 13;
const REQUIRED_PATCH = 0;
const REQUIRED_DISPLAY = `${REQUIRED_MAJOR}.${REQUIRED_MINOR}.${REQUIRED_PATCH}`;

export interface NodeVersionCheckOptions {
  /** 测试注入：覆盖 process.version 字符串 */
  versionOverride?: string;
  /** 测试注入：覆盖 stderr，默认 process.stderr */
  stderr?: NodeJS.WritableStream;
  /** 测试注入：覆盖退出策略，默认调 process.exit(2)。返回 'exited' 让测试断言不抛 */
  exit?: (code: number) => 'exited';
}

export interface NodeVersionCheckResult {
  ok: boolean;
  current: string;
  required: string;
}

/**
 * 解析 'v22.13.0' / '22.13.0-rc.1' / 'v24.14.1' 等形态。
 * 失败返回 [0,0,0]，由调用方按 ok=false 走拒绝分支。
 *
 * 注意 NaN 兜底：`parseInt('not', 10)` 返回 NaN，而 `NaN ?? 0` 不会
 * 触发 nullish coalescing（NaN 是 number，不是 null/undefined）。
 * 用 Number.isNaN 显式兜底，确保任意垃圾输入都返回 [0,0,0]。
 */
export function parseNodeVersion(raw: string): [number, number, number] {
  const stripped = raw.replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const parts = stripped.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareVersion(
  a: [number, number, number],
  b: [number, number, number],
): -1 | 0 | 1 {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/**
 * 同步检查 Node 版本。不满足时写 stderr + exit(2)；满足时静默返回。
 *
 * 测试模式：传 exit 钩子让 process.exit 不真退出，便于断言 stderr 内容。
 */
export function assertNodeVersion(opts: NodeVersionCheckOptions = {}): NodeVersionCheckResult {
  const raw = opts.versionOverride ?? process.version;
  const stderr = opts.stderr ?? process.stderr;
  const exit = opts.exit ?? ((code: number) => {
    process.exit(code);
    return 'exited' as const;
  });

  const current = parseNodeVersion(raw);
  const required: [number, number, number] = [REQUIRED_MAJOR, REQUIRED_MINOR, REQUIRED_PATCH];
  const ok = compareVersion(current, required) >= 0;

  const result: NodeVersionCheckResult = {
    ok,
    current: raw,
    required: REQUIRED_DISPLAY,
  };

  if (!ok) {
    const lines = [
      '',
      '✗ Node.js 版本不满足要求',
      `  当前: ${raw}`,
      `  要求: ≥ ${REQUIRED_DISPLAY}`,
      '',
      '  原因: tapd-server-cli 的依赖（@inquirer/checkbox / commander / undici）',
      '       要求 Node ≥ 22.13.0；低于该版本会在交互式输入或 HTTP 调用时崩溃。',
      '',
      '  解决:',
      '    nvm install 22 && nvm use 22       # nvm / nvm-windows',
      '    或访问 https://nodejs.org/ 下载 LTS',
      '',
    ];
    stderr.write(`${lines.join('\n')}\n`);
    exit(2);
  }

  return result;
}
