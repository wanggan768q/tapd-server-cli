#!/usr/bin/env node
/**
 * tapd-mcp-server — 进程入口。
 *
 * 启动顺序（spec mcp-server-runtime.Requirement 启动顺序）：
 *   1) 加载并校验配置（含 CLI 与 env）
 *   2) 校验令牌
 *   3) 拉取 workspace 白名单
 *   4) 注册元工具与资源工具
 *   5) 绑定 MCP 传输
 *
 * 优雅停止：SIGINT/SIGTERM 5 秒内拒绝新请求并退出。
 */

import { loadToken } from './auth/token.js';
import { parseCli, UnknownClientError } from './cli.js';
import { loginCommand } from './commands/login-handler.js';
import { logoutCommand } from './commands/logout-handler.js';
import { updateCommand } from './commands/update-handler.js';
import { ConfigError, EXIT_CODE_CONFIG, resolveConfig } from './config.js';
import { ALL_ADAPTERS, runInstall } from './installer/flow.js';
import {
  NoClientsSelectedError,
  NonInteractiveNoClientError,
  resolveClients,
  UserCancelledError,
} from './installer/select-clients.js';
import { runUninstall, UNINSTALL_ADAPTERS } from './installer/uninstall-flow.js';
import { createLogger } from './runtime/logger.js';
import { buildServer } from './runtime/server.js';
import { bindHttp, bindStdio } from './runtime/transports.js';

const STARTED_AT = Date.now();
const SHUTDOWN_TIMEOUT_MS = 5_000;

async function main() {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.mode === 'install') {
    let clients: string[];
    try {
      clients = await resolveClients(parsed.clients, {
        adapters: Object.values(ALL_ADAPTERS),
        message: '选择要安装到的 MCP 客户端(空格选择,回车确认)',
        commandName: 'install',
      });
    } catch (err) {
      if (err instanceof NonInteractiveNoClientError) {
        process.stderr.write(`${err.message}\n`);
        process.stderr.write(
          '示例:tapd-server-cli install claude-code codex --dry-run\n',
        );
        process.exit(2);
      }
      if (err instanceof NoClientsSelectedError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      if (err instanceof UserCancelledError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(130);
      }
      throw err;
    }

    const result = await runInstall({ clients, dryRun: parsed.dryRun });
    process.exit(result.exitCode);
  }

  if (parsed.mode === 'uninstall') {
    let clients: string[];
    try {
      clients = await resolveClients(parsed.clients, {
        adapters: Object.values(UNINSTALL_ADAPTERS),
        message: '选择要卸载的 MCP 客户端(空格选择,回车确认)',
        commandName: 'uninstall',
      });
    } catch (err) {
      if (err instanceof NonInteractiveNoClientError) {
        process.stderr.write(`${err.message}\n`);
        process.stderr.write(
          '示例:tapd-server-cli uninstall claude-code codex --dry-run\n',
        );
        process.exit(2);
      }
      if (err instanceof NoClientsSelectedError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(1);
      }
      if (err instanceof UserCancelledError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(130);
      }
      throw err;
    }

    const result = await runUninstall({
      clients,
      dryRun: parsed.dryRun,
      purge: parsed.purge,
    });
    process.exit(result.exitCode);
  }

  if (parsed.mode === 'login') {
    const r = await loginCommand({ timeout: parsed.timeout });
    process.exit(r.exitCode);
  }

  if (parsed.mode === 'logout') {
    const r = await logoutCommand();
    process.exit(r.exitCode);
  }

  if (parsed.mode === 'update') {
    const r = await updateCommand({ json: parsed.json });
    process.exit(r.exitCode);
  }

  const cli = parsed.args;

  // 文件令牌的读取放到 config 解析之前；config.resolveConfig 已支持注入 fileToken
  const loaded = await loadToken({ cli, env: process.env });
  const fileToken = loaded?.source === 'file' ? loaded.token : undefined;

  const config = resolveConfig({
    env: process.env,
    cli,
    fileToken: fileToken ? () => fileToken : undefined,
  });

  const logger = createLogger({ level: config.logLevel, token: config.token });
  logger.info(
    {
      msg: 'startup',
      step: 'config_loaded',
      api_base: config.apiBase,
      concurrency: config.concurrency,
      timeout_ms: config.timeoutMs,
      log_level: config.logLevel,
      http_port: config.httpPort,
    },
    'config loaded',
  );

  const bundle = await buildServer(config, logger);

  const httpBinding =
    config.httpPort !== undefined
      ? await bindHttp({ bundle, port: config.httpPort, startedAt: STARTED_AT, logger })
      : undefined;
  const stdioTransport = httpBinding === undefined ? await bindStdio({ bundle, logger }) : undefined;

  // 启动完成后立即通知客户端可拉取工具列表
  if (bundle.mcp.isConnected()) bundle.mcp.sendToolListChanged();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ msg: 'shutdown', signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.warn({ msg: 'shutdown', signal }, 'shutdown timeout, force exit');
      process.exit(130);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      if (httpBinding) {
        await new Promise<void>((resolve) => httpBinding.server.close(() => resolve()));
      }
      await bundle.close();
      if (stdioTransport) {
        // StdioServerTransport.close 由 mcp.close 内部触发；这里不再单独调
      }
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      logger.error({ err: serializeError(err) }, 'error during shutdown');
      clearTimeout(timer);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`配置错误: ${err.message}\n`);
    process.exit(EXIT_CODE_CONFIG);
  }
  if (err instanceof UnknownClientError) {
    // install 子命令的"未识别客户端"——按 spec exit code 2，且不打堆栈
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  if (err && typeof err === 'object' && 'code' in (err as Record<string, unknown>)) {
    // commander 的 exitOverride 错误
    const code = (err as { code?: string; exitCode?: number }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version') {
      process.exit(0);
    }
  }
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`启动失败: ${message}\n`);
  process.exit(1);
});
