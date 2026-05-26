import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';

import { createTapdHttpClient, type TapdHttpClient } from '../api/client.js';
import { createTapdWebClient, type TapdWebClient } from '../api/web-client.js';
import { fetchIdentity, type Identity } from '../auth/identity.js';
import { createCookieStore, type CookieSource, type CookieStore } from '../auth/cookie-store.js';
import type { AppConfig } from '../config.js';
import { createProbeService, type ProbeService } from '../permissions/probe.js';
import { type PermissionSnapshot } from '../permissions/snapshot.js';
import { fetchAccessibleWorkspaces } from '../permissions/workspaces.js';
import { createSnapshot } from '../permissions/snapshot.js';
import {
  createAttachmentRegistry,
  type AttachmentRegistry,
} from '../tools/attachments-download.js';
import { registerLoginTools } from '../tools/login.js';
import { registerMetaTools } from '../tools/meta.js';
import { registerResourceTools, type ResourceToolHandle } from '../tools/register.js';
import { registerSetupPrompt } from '../prompts/setup.js';

import { maskToken } from '../auth/mask.js';

export interface ServerBundle {
  mcp: McpServer;
  client: TapdHttpClient;
  webBase: string;
  identity: Identity;
  snapshot: PermissionSnapshot;
  probes: ProbeService;
  resourceTools: ResourceToolHandle[];
  attachmentRegistry: AttachmentRegistry;
  cookieStore: CookieStore;
  cookieSource: CookieSource;
  /** 优雅停止：释放资源 */
  close: () => Promise<void>;
}

const PACKAGE_NAME = 'tapd-mcp-server';
const PACKAGE_VERSION = '0.1.0';

/**
 * 装配启动流程：
 * 1) 创建 HTTP 客户端
 * 2) 校验令牌（/users/info）
 * 3) 加载 workspace 白名单
 * 4) 构造 snapshot + ProbeService
 * 5) 通过 CookieStore 解析 cookie 来源（env > file > none）；非 none 则装配 webClient
 * 6) 创建 McpServer，注册元工具 + 资源工具 + 附件下载 registry（含 login/logout）
 * 7) 返回 bundle（由调用方绑定 transport）
 */
export async function buildServer(config: AppConfig, logger: Logger): Promise<ServerBundle> {
  logger.info(
    { msg: 'startup', step: 'http_client', apiBase: config.apiBase, tokenPreview: maskToken(config.token) },
    'creating http client',
  );
  const client = createTapdHttpClient({
    apiBase: config.apiBase,
    token: config.token,
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    logger,
  });

  logger.info({ msg: 'startup', step: 'verify_token' }, 'verifying TAPD token');
  const identity = await fetchIdentity(client, config.token);
  logger.info(
    { msg: 'startup', step: 'token_ok', user_id: identity.userId, user_name: identity.userName },
    'token verified',
  );

  logger.info({ msg: 'startup', step: 'load_workspaces' }, 'loading workspace whitelist');
  const workspaces = await fetchAccessibleWorkspaces(client);
  const snapshot = createSnapshot(workspaces);
  logger.info(
    { msg: 'startup', step: 'workspaces_loaded', count: workspaces.length },
    `loaded ${workspaces.length} workspace(s)`,
  );

  const probes = createProbeService({
    client,
    snapshot,
    readTtlSec: config.permissionTtlSec,
  });

  // Step 5: cookie 装配（env > file > none）
  const cookieStore = createCookieStore({ logger });
  const loadedCookie = await cookieStore.load();
  const cookieSource: CookieSource = loadedCookie?.source ?? 'none';

  const buildWebClient = (cookie: string): TapdWebClient =>
    createTapdWebClient({
      webBase: config.webBase,
      cookie,
      concurrency: config.webConcurrency,
      timeoutMs: config.timeoutMs,
      logger,
    });

  let initialWebClient: TapdWebClient | undefined;
  if (loadedCookie) {
    initialWebClient = buildWebClient(loadedCookie.value);
    logger.info(
      {
        msg: 'startup',
        step: 'web_client_ready',
        web_base: config.webBase,
        concurrency: config.webConcurrency,
        cookie_source: cookieSource,
      },
      `web cookie client armed (no probe) from ${cookieSource}`,
    );
  } else {
    logger.info(
      { msg: 'startup', step: 'web_client_skipped', cookie_source: 'none' },
      'cookie not set in env or file; tapd.attachments.download will not register until tapd.login is called',
    );
  }

  const mcp = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });

  const notifyToolsChanged = () => {
    if (mcp.isConnected()) mcp.sendToolListChanged();
  };

  const resourceTools = registerResourceTools({ server: mcp, client, snapshot, probes });
  const attachmentRegistry = createAttachmentRegistry({
    server: mcp,
    deps: {
      webBase: config.webBase,
      fileBase: config.fileBase,
      webClient: initialWebClient,
    },
    notifyToolsChanged,
  });

  registerLoginTools(mcp, {
    cookieStore,
    attachmentRegistry,
    httpModeEnabled: config.httpPort !== undefined,
    createWebClient: buildWebClient,
    env: process.env,
    logger,
  });

  registerMetaTools(mcp, {
    identity,
    snapshot,
    probes,
    client,
    resourceTools,
    attachmentRegistry,
    cookieSourceProvider: () => {
      // 从运行状态推导：未装配 → none；装配且 env 存在 → env；否则 file（启动时文件 or login 写入文件）
      if (!attachmentRegistry.isArmed()) return 'none';
      const envCookie = process.env.TAPD_WEB_COOKIE;
      if (envCookie && envCookie.length > 0) return 'env';
      return 'file';
    },
    webBase: config.webBase,
    fileBase: config.fileBase,
    notifyToolsChanged,
  });

  registerSetupPrompt(mcp);

  logger.info(
    {
      msg: 'startup',
      step: 'tools_registered',
      resource_tools: resourceTools.length,
      attachment_tools: attachmentRegistry.currentTools().length,
      cookie_source: cookieSource,
      setup_prompt: 'registered',
    },
    `registered ${resourceTools.length} resource tools + ${attachmentRegistry.currentTools().length} attachment tools + login/logout + 4 meta tools + setup prompt`,
  );

  return {
    mcp,
    client,
    webBase: config.webBase,
    identity,
    snapshot,
    probes,
    resourceTools,
    attachmentRegistry,
    cookieStore,
    cookieSource,
    close: async () => {
      try {
        await mcp.close();
      } catch (err) {
        logger.warn({ err: serializeError(err) }, 'mcp.close failed');
      }
      await client.close();
      const webClient = attachmentRegistry.currentClient();
      if (webClient) await webClient.close();
    },
  };
}

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}
