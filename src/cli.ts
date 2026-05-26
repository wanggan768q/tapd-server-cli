import { Command } from 'commander';

import type { CliArgs } from './config.js';

/**
 * CLI 解析结果。`mode` 区分两种入口：
 *   - 'server'：启动 MCP server（default action，含 CliArgs 覆盖）
 *   - 'install'：写客户端配置文件，由 installer 模块接管
 */
export type ParsedCli =
  | { mode: 'server'; args: CliArgs }
  | { mode: 'install'; client: string; dryRun: boolean };

const SUPPORTED_CLIENTS = ['claude-code', 'codex', 'opencode', 'cursor'] as const;

const PACKAGE_VERSION = '0.1.0';

/**
 * 解析 argv。
 *
 * 形态：
 *   tapd-server-cli                          → mode=server（启动）
 *   tapd-server-cli --token X --api-base Y   → mode=server（带覆盖）
 *   tapd-server-cli install <client>         → mode=install
 *   tapd-server-cli install <client> --dry-run
 *   tapd-server-cli --help / --version       → 由 commander 直接退出
 */
export function parseCli(argv: readonly string[]): ParsedCli {
  const root = new Command()
    .name('tapd-server-cli')
    .description(
      'TAPD MCP Server — 基于个人访问令牌暴露 TAPD Open API 为 MCP 工具；带一键安装到 Claude Code / Codex / OpenCode / Cursor 的子命令。',
    )
    .version(PACKAGE_VERSION)
    .option('--token <pat>', 'TAPD 个人访问令牌（优先于环境变量）')
    .option('--api-base <url>', 'TAPD API 基地址（默认 https://api.tapd.cn）')
    .option('--http-port <port>', '启用 MCP streamable HTTP 传输并监听该端口', (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`--http-port 必须是 1-65535 间的整数，收到 "${v}"`);
      }
      return n;
    })
    .allowExcessArguments(false)
    .exitOverride();

  let installResult: { client: string; dryRun: boolean } | undefined;

  root
    .command('install <client>')
    .description(
      `一键写入 MCP 客户端配置文件。<client> 取值：${SUPPORTED_CLIENTS.join(' / ')}`,
    )
    .option('--dry-run', '只打印将写入的目标路径与内容，不实际写入文件')
    .allowExcessArguments(false)
    .action((client: string, opts: { dryRun?: boolean }) => {
      if (!SUPPORTED_CLIENTS.includes(client as (typeof SUPPORTED_CLIENTS)[number])) {
        // 让 commander 进入异常路径：throw 后 root.parse 抛出
        throw new Error(
          `未识别的客户端 "${client}"。支持的值：${SUPPORTED_CLIENTS.join(' / ')}`,
        );
      }
      installResult = { client, dryRun: !!opts.dryRun };
    });

  root.parse(argv as string[], { from: 'user' });

  if (installResult) {
    return { mode: 'install', client: installResult.client, dryRun: installResult.dryRun };
  }

  const opts = root.opts();
  return {
    mode: 'server',
    args: {
      token: opts.token as string | undefined,
      apiBase: opts.apiBase as string | undefined,
      httpPort: opts.httpPort as number | undefined,
    },
  };
}

/**
 * Back-compat wrapper（被 src/index.ts 现有 main() 调用）。
 * 旧 API 只返回 server 模式的 CliArgs；新代码改走 parseCli。
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const parsed = parseCli(argv);
  if (parsed.mode !== 'server') {
    // 走到这里说明调用方还没接 install 路由，但用户输入了 install <client>
    throw new Error('install 子命令需通过 parseCli + installer 模块处理');
  }
  return parsed.args;
}

export const SUPPORTED_INSTALL_CLIENTS = SUPPORTED_CLIENTS;
