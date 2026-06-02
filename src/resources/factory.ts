/**
 * 资源工具的输入 schema 与执行逻辑。
 *
 * 输入 schema 设计：
 * - 所有动作都接受可选 `workspace_id`（受 enum 限定到当前权限快照）
 * - list/get/count：还接受 `filters`（透传查询参数）、`page`、`limit`、`fields`
 * - create/update：接受 `fields`（要写入或更新的字段对象）
 *
 * 字段投影：当 `fields` 数组提供时，list/get 的每条结果只保留指定字段。
 *
 * 字段透传给 TAPD：query 参数（GET）或 JSON body（POST）。
 */

import { z } from 'zod';

import type { TapdHttpClient } from '../api/client.js';
import { TapdApiError } from '../api/errors.js';
import type { ProbeService } from '../permissions/probe.js';
import { listWorkspaceIds, type PermissionSnapshot } from '../permissions/snapshot.js';

import {
  methodForAction,
  pathForAction,
  type ResourceActionSpec,
  type ResourceDef,
} from './definitions.js';
import { maybeRecordKnownUsers } from './known-users-hook.js';

export interface ResourceToolDeps {
  client: TapdHttpClient;
  snapshot: PermissionSnapshot;
  probes: ProbeService;
}

export interface ResourceToolInput {
  workspace_id?: string;
  filters?: Record<string, string | number | boolean | undefined>;
  fields?: string[];
  page?: number;
  limit?: number;
  /** create/update 时透传给 TAPD 的字段对象 */
  data?: Record<string, unknown>;
}

/**
 * 构造给定 (resource, action) 的 zod input schema。
 * workspace_id 的 enum 在运行时由 listWorkspaceIds 动态决定。
 */
export function buildInputSchema(
  def: ResourceDef,
  spec: ResourceActionSpec,
  workspaceIds: string[],
): z.ZodTypeAny {
  const workspaceField =
    workspaceIds.length > 0
      ? z.enum(workspaceIds as [string, ...string[]])
      : z.string().min(1);

  const base: Record<string, z.ZodTypeAny> = {};

  if (def.requiresWorkspaceId) {
    base.workspace_id = workspaceField;
  } else {
    base.workspace_id = workspaceField.optional();
  }

  if (spec.action === 'list' || spec.action === 'count') {
    base.filters = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();
    base.page = z.number().int().positive().optional();
    base.limit = z.number().int().positive().max(200).optional();
  }
  if (spec.action === 'get') {
    base.filters = z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .describe('查询单条记录所需的过滤条件，通常至少包含 id')
      .refine((v) => v && Object.keys(v).length > 0, {
        message: 'get 动作必须提供 filters，至少包含 id',
      });
  }
  if (spec.action === 'list' || spec.action === 'get') {
    base.fields = z.array(z.string()).optional().describe('返回字段投影（仅保留这些字段）');
  }
  if (spec.write) {
    base.data = z
      .record(z.unknown())
      .describe('要写入/更新的字段对象，字段语义以 TAPD 官方文档为准');
  }

  return z.object(base);
}

/**
 * 执行资源工具调用。
 */
export async function executeResourceTool(
  def: ResourceDef,
  spec: ResourceActionSpec,
  rawInput: unknown,
  deps: ResourceToolDeps,
): Promise<unknown> {
  const workspaceIds = listWorkspaceIds(deps.snapshot);
  const schema = buildInputSchema(def, spec, workspaceIds);
  const parsed = schema.parse(rawInput ?? {}) as ResourceToolInput;

  const workspaceId = parsed.workspace_id;
  const isWrite = !!spec.write;

  // 写权限失败短缓存：在请求前直接拒绝
  if (isWrite && workspaceId && deps.probes.isWriteDenied(def.resource, workspaceId)) {
    throw new TapdApiError({
      kind: 'permission_denied',
      tapdStatus: 0,
      httpStatus: 0,
      info: `cached: ${def.resource}.${spec.action} on workspace ${workspaceId} 在最近 1 小时内调用失败，视为无权限`,
    });
  }

  // 读权限懒探针（仅 list；get/count 不预探针，因为 get 必须传 id，可能与白名单 workspace 错配）
  if (
    !isWrite &&
    spec.action === 'list' &&
    workspaceId &&
    !deps.probes.knownReadAllowed(def.resource, workspaceId)
  ) {
    try {
      await deps.probes.ensureRead(def.resource, workspaceId);
    } catch (err) {
      if (err instanceof TapdApiError) throw err;
      throw err;
    }
  }

  const method = methodForAction(spec);
  const path = pathForAction(def, spec);

  try {
    let raw: unknown;
    if (method === 'GET') {
      const query: Record<string, string | number | undefined> = {};
      if (workspaceId) query.workspace_id = workspaceId;
      if (parsed.page !== undefined) query.page = parsed.page;
      if (parsed.limit !== undefined) query.limit = parsed.limit;
      if (parsed.filters) {
        for (const [k, v] of Object.entries(parsed.filters)) {
          if (v === undefined) continue;
          query[k] = typeof v === 'boolean' ? String(v) : v;
        }
      }
      raw = await deps.client.get(path, query);
    } else {
      const body: Record<string, unknown> = { ...(parsed.data ?? {}) };
      if (workspaceId) body.workspace_id = workspaceId;
      raw = await deps.client.post(path, body);
    }

    if (parsed.fields && parsed.fields.length > 0) {
      const projected = projectFields(raw, parsed.fields);
      maybeRecordKnownUsers(def, spec, projected);
      return projected;
    }
    maybeRecordKnownUsers(def, spec, raw);
    return raw;
  } catch (err) {
    if (err instanceof TapdApiError && isWrite && err.kind === 'permission_denied' && workspaceId) {
      deps.probes.markWriteDenied(def.resource, workspaceId);
    }
    throw err;
  }
}

/**
 * 字段投影：对 array / object 都生效。
 * 对 TAPD 数组项 `{ Resource: { ... } }` 的嵌套包装，递归投影内部对象。
 */
function projectFields(value: unknown, fields: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => projectFields(item, fields));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // 如果 obj 只有一个 key 且其 value 是对象，认为是 TAPD 的 { ResourceName: {...} } 包装
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const inner = obj[keys[0]!];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return { [keys[0]!]: projectFields(inner, fields) };
      }
    }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in obj) out[f] = obj[f];
    }
    return out;
  }
  return value;
}

export function describeTool(def: ResourceDef, spec: ResourceActionSpec): string {
  const prefix = spec.write ? '[写操作] ' : '';
  const actionLabel: Record<string, string> = {
    list: '列表查询',
    get: '查询单条',
    create: '创建',
    update: '更新',
    delete: '删除',
    count: '计数',
  };
  return `${prefix}${def.description}：${actionLabel[spec.action] ?? spec.action}`;
}
