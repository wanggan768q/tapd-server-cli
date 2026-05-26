/**
 * 资源工具的动态注册器。
 *
 * 设计要点：
 * - 启动时遍历 RESOURCES × actions 注册所有资源工具
 * - workspace_id 参数 enum 来自当前 snapshot.workspaces；启动前 snapshot 已加载
 * - refresh_permissions 后通过 server.sendToolListChanged() 通知客户端重新拉取
 *
 * 注意：MCP SDK 没有动态 unregister 接口，因此 enum 收紧不是通过"重注册"实现的，
 * 而是通过 inputSchema 在每次调用前重新校验。为此我们：
 * - 注册时使用一个"宽松 schema"（workspace_id 接受任意字符串）
 * - 在 handler 内部用 `buildInputSchema(snapshot 当前白名单)` 做严格校验
 * 这样客户端看到的 schema 在启动后保持稳定（避免协议复杂度），但实际语义随 snapshot 收紧。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { TapdHttpClient } from '../api/client.js';
import { TapdApiError } from '../api/errors.js';
import type { ProbeService } from '../permissions/probe.js';
import { listWorkspaceIds, type PermissionSnapshot } from '../permissions/snapshot.js';
import {
  pathForAction,
  RESOURCES,
  type ResourceActionSpec,
  type ResourceDef,
  toolName,
} from '../resources/definitions.js';
import {
  buildInputSchema,
  describeTool,
  executeResourceTool,
} from '../resources/factory.js';

export interface ResourceToolHandle {
  name: string;
  def: ResourceDef;
  spec: ResourceActionSpec;
}

export interface RegisterResourceToolsInput {
  server: McpServer;
  client: TapdHttpClient;
  snapshot: PermissionSnapshot;
  probes: ProbeService;
}

const wsField = z
  .string()
  .min(1)
  .describe('workspace_id（公司或项目 ID）。可用值见 tapd.list_workspaces。');

/**
 * 构造 MCP `inputSchema` 的 raw shape（不是完整 z.object）。
 * 这是 SDK 的 ZodRawShape 约定：传入 shape 字典，让 SDK 内部生成 z.object。
 */
function buildAdvertisedShape(def: ResourceDef, spec: ResourceActionSpec): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  if (def.requiresWorkspaceId) {
    shape.workspace_id = wsField;
  } else {
    shape.workspace_id = wsField.optional();
  }

  if (spec.action === 'list' || spec.action === 'count') {
    shape.filters = z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe('TAPD 接口可接受的查询参数集合，将原样追加到 query string。');
    shape.page = z.number().int().positive().optional();
    shape.limit = z.number().int().positive().max(200).optional();
  }
  if (spec.action === 'get') {
    shape.filters = z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .describe('用于定位单条记录的查询参数（至少包含 id）。');
  }
  if (spec.action === 'list' || spec.action === 'get') {
    shape.fields = z
      .array(z.string())
      .optional()
      .describe('字段投影：只返回这些字段。');
  }
  if (spec.write) {
    shape.data = z
      .record(z.unknown())
      .describe('要写入/更新的字段对象。字段语义见 TAPD 官方文档。');
  }
  return shape;
}

export function registerResourceTools(
  input: RegisterResourceToolsInput,
): ResourceToolHandle[] {
  const { server, client, snapshot, probes } = input;
  const handles: ResourceToolHandle[] = [];

  for (const def of RESOURCES) {
    for (const spec of def.actions) {
      const name = toolName(def, spec);
      const shape = buildAdvertisedShape(def, spec);

      server.registerTool(
        name,
        {
          title: name,
          description:
            describeTool(def, spec) +
            ` | TAPD path=${pathForAction(def, spec)}` +
            ` | workspace 白名单见 tapd.list_workspaces`,
          inputSchema: shape,
          annotations: spec.write
            ? { destructiveHint: true, idempotentHint: spec.action === 'update' }
            : { readOnlyHint: true },
        },
        async (rawInput: unknown) => {
          try {
            // 在 handler 内部用当前 snapshot 重新校验 workspace enum
            const strict = buildInputSchema(def, spec, listWorkspaceIds(snapshot));
            const validated = strict.parse(rawInput);
            const result = await executeResourceTool(def, spec, validated, {
              client,
              snapshot,
              probes,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
              structuredContent:
                result && typeof result === 'object' && !Array.isArray(result)
                  ? (result as Record<string, unknown>)
                  : { data: result },
            };
          } catch (err) {
            return formatErrorResult(err);
          }
        },
      );

      handles.push({ name, def, spec });
    }
  }

  return handles;
}

function formatErrorResult(err: unknown) {
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
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: `Unexpected error: ${message}` }],
    isError: true,
  };
}
