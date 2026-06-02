import { Command } from 'commander';

import type { CliArgs } from './config.js';

/**
 * CLI 解析结果。`mode` 区分两种入口：
 *   - 'server'：启动 MCP server（default action，含 CliArgs 覆盖）
 *   - 'install'：写客户端配置文件，由 installer 模块接管
 *
 * `install` 子命令的 `clients` 字段：
 *   - 长度 ≥ 1：用户已显式指定一个或多个客户端
 *   - 长度 === 0：用户未指定，由调用方根据 TTY 决定走交互式选择或报错
 */
export type ParsedCli =
  | { mode: 'server'; args: CliArgs }
  | { mode: 'install'; clients: string[]; dryRun: boolean }
  | { mode: 'uninstall'; clients: string[]; dryRun: boolean; purge: boolean }
  | { mode: 'login'; timeout: number }
  | { mode: 'logout' }
  | { mode: 'update'; json: boolean }
  | {
      mode: 'install-skills';
      clients: string[];
      dryRun: boolean;
      scope: 'user' | 'project' | undefined;
    }
  | {
      mode: 'uninstall-skills';
      clients: string[];
      dryRun: boolean;
      scope: 'user' | 'project' | undefined;
      purgeCache: boolean;
    }
  | { mode: 'switch-role'; role: string };

const SUPPORTED_CLIENTS = ['claude-code', 'codex', 'opencode', 'cursor'] as const;

const PACKAGE_VERSION = '0.3.3';

/**
 * `install` 子命令解析阶段抛出的、对外可识别的错误。
 *
 * 被 src/index.ts 的顶层 catch 捕获后映射为 exit code 2（"未识别的客户端"），
 * 避免印出 commander 的内部堆栈。
 */
export class UnknownClientError extends Error {
  readonly client: string;
  readonly supported: readonly string[];
  constructor(client: string, supported: readonly string[]) {
    super(`未识别的客户端 "${client}"。支持的值：${supported.join(' / ')}`);
    this.name = 'UnknownClientError';
    this.client = client;
    this.supported = supported;
  }
}

/**
 * 解析 argv。
 *
 * 形态：
 *   tapd-server-cli                                  → mode=server（启动）
 *   tapd-server-cli --token X --api-base Y           → mode=server（带覆盖）
 *   tapd-server-cli install                          → mode=install, clients=[]（由调用方决定走交互或报错）
 *   tapd-server-cli install <client>                 → mode=install, clients=[<client>]
 *   tapd-server-cli install <c1> <c2> [<c3> ...]     → mode=install, clients=[c1,c2,...]
 *   tapd-server-cli install <c1> <c2> --dry-run      → mode=install, dryRun=true
 *   tapd-server-cli --help / --version               → 由 commander 直接退出
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
    .exitOverride()
    // Default action: 无子命令时回落到 server 模式，避免 commander 输出 help 后通过
    // exitOverride 抛 `commander.helpDisplayed` 提前结束进程。
    // 没有这一行的话，`tapd-server-cli`（裸跑，作为 MCP stdio server 启动）会在
    // commander.parse() 阶段秒退，MCP 客户端只看到 stdio 关闭，无法完成 initialize 握手。
    .action(() => {
      /* fall through to server mode (handled in parseCli return path) */
    });

  let installResult: { clients: string[]; dryRun: boolean } | undefined;
  let uninstallResult: { clients: string[]; dryRun: boolean; purge: boolean } | undefined;
  let loginResult: { timeout: number } | undefined;
  let logoutResult: true | undefined;
  let updateResult: { json: boolean } | undefined;
  let installSkillsResult:
    | { clients: string[]; dryRun: boolean; scope: 'user' | 'project' | undefined }
    | undefined;
  let uninstallSkillsResult:
    | {
        clients: string[];
        dryRun: boolean;
        scope: 'user' | 'project' | undefined;
        purgeCache: boolean;
      }
    | undefined;
  let switchRoleResult: { role: string } | undefined;

  root
    .command('install [clients...]')
    .description(
      `一键写入 MCP 客户端配置文件。可选传零个或多个 client;零参且在 TTY 下会弹出多选界面(空格选择,回车确认)。\n` +
        `<client> 取值:${SUPPORTED_CLIENTS.join(' / ')}`,
    )
    .option('--dry-run', '只打印将写入的目标路径与内容,不实际写入文件')
    .allowExcessArguments(false)
    .action((clients: string[] | undefined, opts: { dryRun?: boolean }) => {
      const list = clients ?? [];
      for (const client of list) {
        if (!SUPPORTED_CLIENTS.includes(client as (typeof SUPPORTED_CLIENTS)[number])) {
          throw new UnknownClientError(client, SUPPORTED_CLIENTS);
        }
      }
      installResult = { clients: list, dryRun: !!opts.dryRun };
    });

  root
    .command('uninstall [clients...]')
    .description(
      `从 MCP 客户端配置中移除 tapd 条目。与 install 对称:可选传零个或多个 client;零参且在 TTY 下会弹出多选界面。\n` +
        `<client> 取值:${SUPPORTED_CLIENTS.join(' / ')}\n` +
        `--purge 额外清理 ~/.config/tapd-mcp/cookie 与 token 文件(默认保留以便再次安装)。`,
    )
    .option('--dry-run', '只打印将移除的目标路径与内容,不实际写入或删除文件')
    .option('--purge', '额外清理 ~/.config/tapd-mcp/cookie 与 ~/.config/tapd-mcp/token 文件')
    .allowExcessArguments(false)
    .action(
      (clients: string[] | undefined, opts: { dryRun?: boolean; purge?: boolean }) => {
        const list = clients ?? [];
        for (const client of list) {
          if (!SUPPORTED_CLIENTS.includes(client as (typeof SUPPORTED_CLIENTS)[number])) {
            throw new UnknownClientError(client, SUPPORTED_CLIENTS);
          }
        }
        uninstallResult = {
          clients: list,
          dryRun: !!opts.dryRun,
          purge: !!opts.purge,
        };
      },
    );

  root
    .command('login')
    .description(
      '弹独立浏览器登录 TAPD,把 cookie 抓回并写到 ~/.config/tapd-mcp/cookie。\n' +
        '替代旧 MCP 工具 tapd.login——直接终端运行,不需要 MCP 客户端在线。',
    )
    .option('--timeout <seconds>', '总等待秒数(默认 300)', (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 10 || n > 3600) {
        throw new Error(`--timeout 必须是 10-3600 间的整数,收到 "${v}"`);
      }
      return n;
    })
    .allowExcessArguments(false)
    .action((opts: { timeout?: number }) => {
      loginResult = { timeout: opts.timeout ?? 300 };
    });

  root
    .command('logout')
    .description('删除 ~/.config/tapd-mcp/cookie。文件不存在不算错。')
    .allowExcessArguments(false)
    .action(() => {
      logoutResult = true;
    });

  root
    .command('update')
    .description(
      '检查 npm 上是否有 tapd-server-cli 新版。仅检查不自动升级——\n' +
        '输出建议命令让用户决定。替代 §A 删除的 MCP 工具 tapd.update。',
    )
    .option('--json', '以 JSON 输出(适合脚本消费)')
    .allowExcessArguments(false)
    .action((opts: { json?: boolean }) => {
      updateResult = { json: !!opts.json };
    });

  root
    .command('install-skills [clients...]')
    .description(
      `安装 TAPD MCP Skill 包到客户端（与 install 子命令独立——install 仅写 mcpServers.tapd 条目）。\n` +
        `本版本仅交付 4 个共享 + 6 个普通用户 skill（共 10 个），不暴露 --role 选项。\n` +
        `<client> 取值: ${SUPPORTED_CLIENTS.join(' / ')}`,
    )
    .option('--scope <scope>', '安装范围: user 或 project', (v) => {
      if (v !== 'user' && v !== 'project') {
        throw new Error(`--scope 必须是 user 或 project，收到 "${v}"`);
      }
      return v;
    })
    .option('--dry-run', '只打印将写入的目标路径与摘要，不实际写入')
    .allowExcessArguments(false)
    .action(
      (
        clients: string[] | undefined,
        opts: { scope?: 'user' | 'project'; dryRun?: boolean },
      ) => {
        const list = clients ?? [];
        for (const client of list) {
          if (!SUPPORTED_CLIENTS.includes(client as (typeof SUPPORTED_CLIENTS)[number])) {
            throw new UnknownClientError(client, SUPPORTED_CLIENTS);
          }
        }
        installSkillsResult = {
          clients: list,
          dryRun: !!opts.dryRun,
          scope: opts.scope,
        };
      },
    );

  root
    .command('uninstall-skills [clients...]')
    .description(
      `卸载 TAPD MCP Skill 包。反向清理 install-skills 写入的产物（SKILL 文件 / managed block / config）。\n` +
        `<client> 取值: ${SUPPORTED_CLIENTS.join(' / ')}\n` +
        `--purge-cache 同时删除 ~/.tapd/cache.json（默认保留以便 server 启动复用）。`,
    )
    .option('--scope <scope>', '卸载范围: user 或 project', (v) => {
      if (v !== 'user' && v !== 'project') {
        throw new Error(`--scope 必须是 user 或 project，收到 "${v}"`);
      }
      return v;
    })
    .option('--dry-run', '只打印将清理的目标路径，不实际删除')
    .option('--purge-cache', '同时删除 ~/.tapd/cache.json')
    .allowExcessArguments(false)
    .action(
      (
        clients: string[] | undefined,
        opts: {
          scope?: 'user' | 'project';
          dryRun?: boolean;
          purgeCache?: boolean;
        },
      ) => {
        const list = clients ?? [];
        for (const client of list) {
          if (!SUPPORTED_CLIENTS.includes(client as (typeof SUPPORTED_CLIENTS)[number])) {
            throw new UnknownClientError(client, SUPPORTED_CLIENTS);
          }
        }
        uninstallSkillsResult = {
          clients: list,
          dryRun: !!opts.dryRun,
          scope: opts.scope,
          purgeCache: !!opts.purgeCache,
        };
      },
    );

  root
    .command('switch-role <role>')
    .description(
      '切换 skill 安装包对应的角色——本版本仅占位，等管理者 skill 上线时再启用。',
    )
    .allowExcessArguments(false)
    .action((role: string) => {
      switchRoleResult = { role };
    });

  root.parse(argv as string[], { from: 'user' });

  if (installResult) {
    return { mode: 'install', clients: installResult.clients, dryRun: installResult.dryRun };
  }
  if (uninstallResult) {
    return {
      mode: 'uninstall',
      clients: uninstallResult.clients,
      dryRun: uninstallResult.dryRun,
      purge: uninstallResult.purge,
    };
  }
  if (loginResult) {
    return { mode: 'login', timeout: loginResult.timeout };
  }
  if (logoutResult) {
    return { mode: 'logout' };
  }
  if (updateResult) {
    return { mode: 'update', json: updateResult.json };
  }
  if (installSkillsResult) {
    return {
      mode: 'install-skills',
      clients: installSkillsResult.clients,
      dryRun: installSkillsResult.dryRun,
      scope: installSkillsResult.scope,
    };
  }
  if (uninstallSkillsResult) {
    return {
      mode: 'uninstall-skills',
      clients: uninstallSkillsResult.clients,
      dryRun: uninstallSkillsResult.dryRun,
      scope: uninstallSkillsResult.scope,
      purgeCache: uninstallSkillsResult.purgeCache,
    };
  }
  if (switchRoleResult) {
    return { mode: 'switch-role', role: switchRoleResult.role };
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
    // 走到这里说明调用方还没接 install 路由，但用户输入了 install 子命令
    throw new Error('install 子命令需通过 parseCli + installer 模块处理');
  }
  return parsed.args;
}

export const SUPPORTED_INSTALL_CLIENTS = SUPPORTED_CLIENTS;
