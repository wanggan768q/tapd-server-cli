/**
 * 资源工具的元数据描述。每个 resource 由 list/get/create/update 等动作组成。
 *
 * 策略：
 * - list/get：默认透传所有字段；可选 `fields` 参数做字段投影
 * - create/update：参数仅声明必填的 `workspace_id`，其余字段作为 `fields` 透传给 TAPD
 *
 * 这种"薄封装"避免为 TAPD 200+ 字段维护 zod schema —— 让 TAPD 自己校验。
 * 字段语义以 TAPD 官方 API 文档为准（见 CLAUDE.md 本地规则）。
 */

export type ResourceAction = 'list' | 'get' | 'create' | 'update' | 'delete' | 'count';

export interface ResourceActionSpec {
  action: ResourceAction;
  /**
   * TAPD API 路径相对 base 的部分。`get`/`update` 等查询单条记录时 TAPD 同样以
   * `/<resource>?id=...&workspace_id=...` 形式访问（无 `/{id}` 风格），因此默认与 list 同 path；
   * 个别资源（如 attachments、workflows）有专门子路径，由具体定义覆盖。
   */
  pathSegment?: string;
  /** HTTP 方法：list/get/count→GET；create/update→POST；delete→POST（TAPD 多以 POST 表示） */
  method?: 'GET' | 'POST';
  /** 是否写操作（影响错误处理与工具 description 前缀） */
  write?: boolean;
}

export interface ResourceDef {
  /** kebab-case 资源名，作为工具名后缀 `tapd.<resource>.<action>` */
  resource: string;
  /** TAPD API 路径段（默认 = resource）。例如 stories→/stories */
  basePath?: string;
  /** 人类可读简介，用于 MCP 工具 description */
  description: string;
  /** 是否需要 workspace_id 参数（绝大多数资源都需要；少数如 users 也需要） */
  requiresWorkspaceId?: boolean;
  /** 支持的动作 */
  actions: ResourceActionSpec[];
}

/**
 * 资源清单。覆盖 TAPD 官方文档列出的核心资源模块。
 * 字段语义详见 https://o.tapd.tencent.com/document/api-doc/next/api/
 */
export const RESOURCES: readonly ResourceDef[] = [
  {
    resource: 'stories',
    description: '需求（user story）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'get' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
      { action: 'update', method: 'POST', write: true, pathSegment: '' },
    ],
  },
  {
    resource: 'bugs',
    description: '缺陷（bug）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'get' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
      { action: 'update', method: 'POST', write: true },
    ],
  },
  {
    resource: 'tasks',
    description: '任务（task）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'get' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
      { action: 'update', method: 'POST', write: true },
    ],
  },
  {
    resource: 'iterations',
    description: '迭代（iteration / sprint）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'get' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
      { action: 'update', method: 'POST', write: true },
    ],
  },
  {
    resource: 'releases',
    description: '发布计划（release）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'get' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
      { action: 'update', method: 'POST', write: true },
    ],
  },
  {
    resource: 'timesheets',
    description: '工时（timesheet）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
    ],
  },
  {
    resource: 'comments',
    description: '评论（comment）',
    requiresWorkspaceId: true,
    actions: [
      { action: 'list' },
      { action: 'count' },
      { action: 'create', method: 'POST', write: true },
    ],
  },
  {
    resource: 'attachments',
    description: '附件（attachment）',
    requiresWorkspaceId: true,
    actions: [{ action: 'list' }, { action: 'get' }],
  },
  {
    resource: 'workflows',
    description: '工作流与状态（workflow / workitem status）',
    requiresWorkspaceId: true,
    actions: [
      // 注：workflows 的具体 API 路径见 TAPD 官方文档；首版只暴露 list/get
      { action: 'list' },
      { action: 'get' },
    ],
  },
  {
    resource: 'users',
    description: '成员（user / project member）',
    requiresWorkspaceId: true,
    actions: [{ action: 'list' }, { action: 'get' }],
  },
  {
    resource: 'categories',
    description: '需求分类（story category）',
    requiresWorkspaceId: true,
    actions: [{ action: 'list' }, { action: 'get' }],
  },
  {
    resource: 'modules',
    description: '模块（module）',
    requiresWorkspaceId: true,
    actions: [{ action: 'list' }, { action: 'get' }],
  },
  {
    resource: 'custom-fields',
    description: '自定义字段（custom field 配置）',
    requiresWorkspaceId: true,
    actions: [{ action: 'list' }],
  },
];

export function pathForAction(def: ResourceDef, spec: ResourceActionSpec): string {
  const base = `/${def.basePath ?? def.resource}`;
  if (spec.pathSegment === '') return base;
  if (spec.pathSegment) return `${base}/${spec.pathSegment}`;
  if (spec.action === 'count') return `${base}/count`;
  return base;
}

export function methodForAction(spec: ResourceActionSpec): 'GET' | 'POST' {
  if (spec.method) return spec.method;
  return spec.write ? 'POST' : 'GET';
}

export function toolName(def: ResourceDef, spec: ResourceActionSpec): string {
  return `tapd.${def.resource}.${spec.action}`;
}
