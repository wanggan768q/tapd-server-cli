/**
 * 登录工具：tapd.login / tapd.logout
 *
 * tapd.login：弹出隔离浏览器窗口让用户登录 TAPD，自动抓 cookie，
 * 持久化到 server 自有目录，并热加载 webClient + 注册 attachments.download。
 *
 * tapd.logout：清空 cookie 文件 + 注销 attachments.download。
 *
 * 行为约束（写在 description 里）：仅在用户明确表达"登录 TAPD"意图时调用，
 * 不要在 unauthenticated 错误后自动重试。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';
import { z } from 'zod';

import { TapdApiError } from '../api/errors.js';
import type { TapdWebClient } from '../api/web-client.js';
import {
  BrowserNotFoundError,
  CdpConnectError,
  LoginAbortedError,
  LoginTimeoutError,
  launchAndGrabCookie as defaultLaunchAndGrabCookie,
  type LaunchLoginOptions,
  type LaunchLoginResult,
} from '../auth/browser-login.js';
import type { CookieStore } from '../auth/cookie-store.js';

import { DOWNLOAD_TOOL_NAME, type AttachmentRegistry } from './attachments-download.js';

export interface LoginToolDeps {
  cookieStore: CookieStore;
  attachmentRegistry: AttachmentRegistry;
  /** HTTP 模式启用时拒绝调用 login（spawn 本地浏览器无意义） */
  httpModeEnabled: boolean;
  /** 用于装配新的 webClient（关 + 重建） */
  createWebClient: (cookie: string) => TapdWebClient;
  /** 当前进程 env 快照，用于检测 env_cookie_warning */
  env: NodeJS.ProcessEnv;
  logger: Logger;
  /** 测试覆盖：替换浏览器登录抓 cookie 实现 */
  launchAndGrabCookie?: (opts: LaunchLoginOptions) => Promise<LaunchLoginResult>;
}

const loginInputShape = {
  timeout_minutes: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('用户登录超时时间（分钟），默认 5'),
} as const;

const logoutInputShape = {} as const;

const LOGIN_DESCRIPTION =
  '[需要本地浏览器] 弹出一个隔离的浏览器窗口让用户登录 TAPD（不影响日常浏览器），' +
  '登录完成后自动抓取 cookie，持久化到 ~/.config/tapd-mcp/cookie，' +
  '并立即装配 tapd.attachments.download 工具，无需重启 MCP 客户端。' +
  ' 仅在用户明确表达"登录 TAPD"/"重新登录"/"刷新 cookie" 时调用；' +
  '在收到 unauthenticated 错误时不要自动重试调用，应先告知用户并等待确认。' +
  ' 仅在 stdio 传输模式下可用，HTTP 远程模式会拒绝。';

const LOGOUT_DESCRIPTION =
  '清除 server 端的 TAPD cookie 文件并销毁 tapd.attachments.download 工具；' +
  '不影响浏览器登录态。';

export function registerLoginTools(server: McpServer, deps: LoginToolDeps): void {
  const launch = deps.launchAndGrabCookie ?? defaultLaunchAndGrabCookie;

  server.registerTool(
    'tapd.login',
    {
      title: 'TAPD 浏览器登录并装配下载工具',
      description: LOGIN_DESCRIPTION,
      inputSchema: loginInputShape,
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (rawInput: unknown) => {
      try {
        if (deps.httpModeEnabled) {
          throw new TapdApiError({
            kind: 'invalid_argument',
            tapdStatus: 0,
            httpStatus: 0,
            info:
              'tapd.login 仅支持 stdio 传输模式（本地客户端启动）。当前服务以 HTTP 模式运行，' +
              '请改用 TAPD_WEB_COOKIE 环境变量手动配置，或在本地以 stdio 模式启动 server 后调用。',
          });
        }

        const parsed = z.object(loginInputShape).parse(rawInput ?? {});
        const timeoutMs = (parsed.timeout_minutes ?? 5) * 60_000;

        deps.logger.info(
          { msg: 'tapd_login_start', timeout_ms: timeoutMs },
          'launching browser for TAPD login',
        );

        let result: LaunchLoginResult;
        try {
          result = await launch({ timeoutMs, logger: deps.logger });
        } catch (err) {
          if (err instanceof BrowserNotFoundError) {
            throw new TapdApiError({
              kind: 'invalid_argument',
              tapdStatus: 0,
              httpStatus: 0,
              info:
                '未在常见路径找到 Chrome 或 Edge 浏览器。请安装 Chrome / Edge，或设置 BROWSER 环境变量指向浏览器可执行文件，' +
                '或回退用 scripts/grab-cookie.mjs / TAPD_WEB_COOKIE 环境变量。',
            });
          }
          if (err instanceof LoginTimeoutError) {
            throw new TapdApiError({
              kind: 'unauthenticated',
              tapdStatus: 0,
              httpStatus: 0,
              info: `${err.message}。请在浏览器中完成登录，或调高 timeout_minutes 后重试。`,
            });
          }
          if (err instanceof LoginAbortedError) {
            throw new TapdApiError({
              kind: 'invalid_argument',
              tapdStatus: 0,
              httpStatus: 0,
              info: '登录流程被中止',
            });
          }
          if (err instanceof CdpConnectError) {
            throw new TapdApiError({
              kind: 'internal',
              tapdStatus: 0,
              httpStatus: 0,
              info: err.message,
            });
          }
          throw err;
        }

        // 持久化（写文件 + 600）
        const saved = await deps.cookieStore.save(result.cookieHeader);
        deps.logger.info(
          {
            msg: 'tapd_login_cookie_saved',
            cookie_count: result.cookieCount,
            path: saved.path,
          },
          'cookie persisted to server-private file',
        );

        // 替换 webClient：先关旧的，再装新的，然后 arm
        const previousClient = deps.attachmentRegistry.currentClient();
        const newClient = deps.createWebClient(result.cookieHeader);
        deps.attachmentRegistry.arm(newClient);
        if (previousClient && previousClient !== newClient) {
          // 异步关闭，不阻塞返回
          previousClient.close().catch((err) => {
            deps.logger.warn(
              { msg: 'previous_web_client_close_failed', err: serialize(err) },
              'failed to close previous web client',
            );
          });
        }

        const envCookie = deps.env.TAPD_WEB_COOKIE;
        const envCookieWarning =
          envCookie && envCookie.length > 0
            ? '检测到 TAPD_WEB_COOKIE 环境变量已设置；进程下次重启会优先使用 env 值而非新写入的文件。建议在重启前 unset 该变量。'
            : null;

        return ok({
          status: 'ok',
          cookie_chars: result.cookieHeader.length,
          cookie_count: result.cookieCount,
          cookie_file: saved.path,
          web_client: 'armed',
          tools_added: [DOWNLOAD_TOOL_NAME],
          env_cookie_warning: envCookieWarning,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'tapd.logout',
    {
      title: 'TAPD 登出并销毁下载工具',
      description: LOGOUT_DESCRIPTION,
      inputSchema: logoutInputShape,
      annotations: { destructiveHint: true },
    },
    async () => {
      try {
        const wasArmed = deps.attachmentRegistry.isArmed();
        const { previousClient } = deps.attachmentRegistry.disarm();
        const cleared = await deps.cookieStore.clear();

        if (previousClient) {
          previousClient.close().catch((err) => {
            deps.logger.warn(
              { msg: 'web_client_close_failed', err: serialize(err) },
              'failed to close web client during logout',
            );
          });
        }

        deps.logger.info(
          {
            msg: 'tapd_logout',
            was_armed: wasArmed,
            cookie_file_existed: cleared.existed,
          },
          'tapd logout completed',
        );

        return ok({
          status: 'ok',
          cookie_file_existed: cleared.existed,
          tools_removed: wasArmed ? [DOWNLOAD_TOOL_NAME] : [],
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(err: unknown) {
  if (err instanceof TapdApiError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: err.kind,
              tapdStatus: err.tapdStatus,
              info: err.info,
              requestId: err.requestId,
              message: err.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  if (err instanceof z.ZodError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: 'invalid_argument',
              issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: `Unexpected error: ${message}` }],
    isError: true,
  };
}

function serialize(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}
