/**
 * 令牌脱敏与日志路径定义。
 * 提取到独立模块的原因：auth/token.ts、tools/meta.ts、tests 都需要相同的脱敏函数。
 */

export const TOKEN_MASK = '***';

/**
 * 把 PAT 脱敏为 "前 4 字符 + *** + 后 4 字符" 的可读片段。
 * 短于 8 字符的输入按整体长度全部用 '*' 替换，避免泄露任何字符。
 */
export function maskToken(token: string | undefined | null): string {
  if (!token) return '';
  if (token.length < 8) return '*'.repeat(token.length);
  return `${token.slice(0, 4)}${TOKEN_MASK}${token.slice(-4)}`;
}
