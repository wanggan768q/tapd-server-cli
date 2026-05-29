/**
 * 元工具：whoami / list_workspaces / list_capabilities / refresh_permissions
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { TapdHttpClient } from '../api/client.js';
import type { Identity } from '../auth/identity.js';
import type { ProbeService } from '../permissions/probe.js';
import { refreshSnapshot } from '../permissions/refresh.js';
import type { PermissionSnapshot } from '../permissions/snapshot.js';
import { RESOURCES, toolName } from '../resources/definitions.js';
import { describeTool } from '../resources/factory.js';

import type { AttachmentRegistry } from './attachments-download.js';
import type { ResourceToolHandle } from './register.js';

export type CookieSource = 'env' | 'file' | 'none';

export interface MetaToolDeps {
  identity: Identity;
  snapshot: PermissionSnapshot;
  probes: ProbeService;
  client: TapdHttpClient;
  /** 当前已注册的资源工具句柄，用于 list_capabilities / refresh 时遍历 */
  resourceTools: ResourceToolHandle[];
  /** 附件下载注册中心：动态读取当前注册的工具列表与装配状态 */
  attachmentRegistry: AttachmentRegistry;
  /** 提供当前 cookie 来源（运行期可能因 login/logout 变化） */
  cookieSourceProvider: () => CookieSource;
  /** 网页基地址（用于 list_capabilities 输出） */
  webBase: string;
  /** 文件 CDN 基地址（附件下载实际域） */
  fileBase: string;
  /**
   * refresh 后调用：触发 tools/list_changed 通知。
   * 由 register 层注入。
   */
  notifyToolsChanged: () => void;
}

function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown> | undefined,
  };
}

export function registerMetaTools(server: McpServer, deps: MetaToolDeps): void {
  server.registerTool(
    'tapd.whoami',
    {
      title: 'TAPD 当前令牌身份',
      description: '返回当前 TAPD 个人访问令牌对应的用户信息（脱敏，不含完整令牌）。',
      inputSchema: {},
    },
    async () => {
      return ok({
        user_id: deps.identity.userId,
        user_name: deps.identity.userName,
        email: deps.identity.email,
        current_company_id: deps.identity.currentCompanyId,
        token_preview: deps.identity.tokenPreview,
      });
    },
  );

  server.registerTool(
    'tapd.list_workspaces',
    {
      title: 'TAPD 可访问的工作空间',
      description: '列出当前令牌可访问的全部 workspace（公司 + 项目）及其分类。',
      inputSchema: {},
    },
    async () => {
      const workspaces = [...deps.snapshot.workspaces.values()];
      return ok({ workspaces, snapshot_at: deps.snapshot.snapshotAt });
    },
  );

  server.registerTool(
    'tapd.list_capabilities',
    {
      title: 'TAPD 当前可用工具',
      description:
        '列出当前注册的全部资源工具、附件下载工具、cookie 来源和 web client 装配状态，便于调试令牌权限边界。',
      inputSchema: {},
    },
    async () => {
      const tools = deps.resourceTools.map((t) => ({
        name: t.name,
        resource: t.def.resource,
        action: t.spec.action,
        write: !!t.spec.write,
        description: describeTool(t.def, t.spec),
        allowed_workspaces: [...deps.snapshot.workspaces.keys()],
      }));
      const cookieSource = deps.cookieSourceProvider();
      return ok({
        meta_tools: [
          'tapd.whoami',
          'tapd.list_workspaces',
          'tapd.list_capabilities',
          'tapd.refresh_permissions',
          'tapd.login',
          'tapd.logout',
        ],
        resource_tools: tools,
        attachment_tools: deps.attachmentRegistry.currentTools(),
        web_client: {
          enabled: deps.attachmentRegistry.isArmed(),
          cookie_source: cookieSource,
          base: deps.webBase,
          file_base: deps.fileBase,
        },
        all_resource_names: RESOURCES.map((r) => r.resource),
        snapshot_at: deps.snapshot.snapshotAt,
      });
    },
  );

  server.registerTool(
    'tapd.refresh_permissions',
    {
      title: 'TAPD 刷新权限快照',
      description:
        '清空读探针缓存与写失败缓存，并重新拉取当前令牌可访问的 workspace 列表。',
      inputSchema: z.object({}).shape,
    },
    async () => {
      const result = await refreshSnapshot(deps.client, deps.snapshot, deps.probes);
      deps.notifyToolsChanged();
      return ok({
        workspaces: result.workspaces,
        snapshot_at: result.snapshotAt,
      });
    },
  );

  // 便于 typecheck 不报告未使用：toolName 在 register 模块导出
  void toolName;
}
