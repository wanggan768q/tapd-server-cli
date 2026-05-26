/**
 * TAPD → MCP 错误归一化。
 *
 * TAPD 响应包络：
 *   成功: { status: 1, data: ..., info: "success" }
 *   失败: { status: <http_or_business_code>, data: "", info: "<msg>", meta: { request_id } }
 *
 * 错误类型对应 design.md D7 表格。
 */

export type TapdErrorKind =
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_found'
  | 'invalid_argument'
  | 'rate_limited'
  | 'internal'
  | 'unknown';

export interface TapdEnvelope<T = unknown> {
  status: number;
  data: T | '';
  info: string;
  meta?: { request_id?: string };
}

const HUMAN_HINT: Record<TapdErrorKind, string> = {
  unauthenticated: 'TAPD 令牌无效或已过期，请检查 TAPD_TOKEN',
  permission_denied: '当前令牌没有访问该资源的权限',
  not_found: '资源不存在或当前令牌无权访问（TAPD 不区分二者）',
  invalid_argument: '请求参数无效，请检查参数说明',
  rate_limited: 'TAPD 接口限流，请稍后重试',
  internal: 'TAPD 服务暂时不可用',
  unknown: '未知 TAPD 错误',
};

export interface TapdApiErrorOptions {
  kind: TapdErrorKind;
  tapdStatus: number;
  httpStatus: number;
  info: string;
  requestId?: string;
  retryAfterMs?: number;
}

export class TapdApiError extends Error {
  readonly kind: TapdErrorKind;
  readonly tapdStatus: number;
  readonly httpStatus: number;
  readonly info: string;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(opts: TapdApiErrorOptions) {
    const hint = HUMAN_HINT[opts.kind];
    const reqIdSuffix = opts.requestId ? ` (request_id=${opts.requestId})` : '';
    super(`${hint} | TAPD info: ${opts.info}${reqIdSuffix}`);
    this.name = 'TapdApiError';
    this.kind = opts.kind;
    this.tapdStatus = opts.tapdStatus;
    this.httpStatus = opts.httpStatus;
    this.info = opts.info;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
  }

  toJSON() {
    return {
      name: this.name,
      kind: this.kind,
      tapdStatus: this.tapdStatus,
      httpStatus: this.httpStatus,
      info: this.info,
      requestId: this.requestId,
      retryAfterMs: this.retryAfterMs,
      message: this.message,
    };
  }
}

/**
 * 把 TAPD `status` + HTTP code 映射为错误类型。
 * 对于 TAPD 把 401/403/404 等也写在响应 body status 字段的情况，优先用 body 的 status。
 */
export function classifyError(input: {
  bodyStatus: number;
  httpStatus: number;
}): TapdErrorKind {
  const s = input.bodyStatus || input.httpStatus;
  if (s === 401) return 'unauthenticated';
  if (s === 403) return 'permission_denied';
  if (s === 404) return 'not_found';
  if (s === 422 || s === 400) return 'invalid_argument';
  if (s === 429) return 'rate_limited';
  if (s >= 500 && s <= 599) return 'internal';
  return 'unknown';
}

/**
 * 解析 TAPD 响应包络。
 * - 成功（status=1）：返回 data
 * - 失败：抛出 TapdApiError
 *
 * 注意：HTTP 层面失败（如 5xx）也可能携带类似包络；调用方应保证传入解析后的 JSON。
 */
export function unwrapEnvelope<T>(
  envelope: TapdEnvelope<T>,
  httpStatus: number,
  retryAfterMs?: number,
): T {
  if (envelope.status === 1) {
    return envelope.data as T;
  }
  let kind = classifyError({ bodyStatus: envelope.status, httpStatus });
  // TAPD 的特殊约定：无效 token 返回 422 + info 含 "access token" 字样。
  // 把这种情况重新归类为 unauthenticated，方便上层提示"请检查 TAPD_TOKEN"。
  if (kind === 'invalid_argument' && /access\s+token.*invalid/i.test(envelope.info)) {
    kind = 'unauthenticated';
  }
  throw new TapdApiError({
    kind,
    tapdStatus: envelope.status,
    httpStatus,
    info: envelope.info || '(no info)',
    requestId: envelope.meta?.request_id,
    retryAfterMs,
  });
}
