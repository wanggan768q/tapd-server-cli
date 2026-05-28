/**
 * Shared redact util for installer CLI helpers (claude-cli.ts / codex-cli.ts).
 *
 * 设计目标（PR #1 review follow-up #4 + #5）：
 *
 *   1. 白名单脱敏：只对 SENSITIVE_KEYS 命中的 env 键做替换，避免短词误伤。
 *      老实现按 `v.length >= 4` 全替，TAPD_LOG_LEVEL='info' 也会被替成 ***，
 *      stderr 里所有 "info" 字面都被破坏，干扰诊断。
 *
 *   2. URL-encoded 兜底：CLI 输出错误时可能把 token 做 URL encode（%2B 等），
 *      直接 split 命中不到。这里 token 同时按 encoded 形态再替一次。
 *
 *   3. 覆盖 err.message + err.stack：spawn 错误对象有 .stack，部分 Node 实现会把
 *      argv 拼进 stack——PAT 可能从 stack 泄漏。redactError() 把两段一起清。
 */

/** env 键白名单：只对这些键的值做脱敏。 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'TAPD_TOKEN',
  // 未来扩展：'TAPD_*_SECRET' 等
]);

/** 单个 token 字符串，所有形态都替成 ***。 */
function redactToken(text: string, token: string): string {
  if (!token) return text;
  let out = text;
  // 字面替换
  out = out.split(token).join('***');
  // URL-encoded 形态（encodeURIComponent 后字面再替一次）
  const encoded = encodeURIComponent(token);
  if (encoded !== token) {
    out = out.split(encoded).join('***');
  }
  return out;
}

/**
 * 把 text 中出现的 env 里所有 SENSITIVE_KEYS 命中的值（含其 URL-encoded 形态）
 * 全部替成 `***`。
 *
 * 非 sensitive 键的值（如 TAPD_LOG_LEVEL='info'）一律不动。
 */
export function redact(text: string, env: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(env)) {
    if (!SENSITIVE_KEYS.has(k)) continue;
    out = redactToken(out, v);
  }
  return out;
}

/**
 * 把一个 unknown 错误对象（spawn 错、普通 Error 或字符串）格式化成单行/多行字符串，
 * 同时对 message + stack 应用 redact()，保证 PAT 不从 stack 泄漏。
 *
 * 大多数 Node 实现里 stack 已经以 "Error: <message>\n  at ..." 开头，自带了 message——
 * 这种情况只 redact + 返回 stack 即可，避免把 message 又前置一次出现两份。
 */
export function redactError(err: unknown, env: Record<string, string>): string {
  if (err instanceof Error) {
    const msg = err.message ?? '';
    const stack = err.stack ?? '';
    // V8 / Node 默认 stack 形如 "Error: <msg>\n    at ..."，已含 message；
    // 仅当 stack 不含 message（罕见的自定义错误实现）时才前置 message。
    const combined = stack && stack.includes(msg)
      ? stack
      : msg + (stack ? '\n' + stack : '');
    return redact(combined, env);
  }
  return redact(String(err), env);
}
