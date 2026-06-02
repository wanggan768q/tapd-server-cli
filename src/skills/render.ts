/**
 * Skill 模板渲染器。
 *
 * 模板里允许的占位符（与 spec 中 `install-skills 模板渲染` 需求对齐）：
 *   - {{identity.tapdUserName}}
 *   - {{identity.tapdUserId}}
 *   - {{identity.tapdEmail}}
 *   - {{role}}
 *   - {{installedAt}}
 *   - {{defaultWorkspaceId}}
 *   - {{workspaces}}                  → 渲染为 markdown 列表
 *   - {{workspaces.json}}             → 渲染为单行 JSON
 *
 * 设计要点：
 *   - 字符串占位符使用点路径访问（identity.tapdUserName）。
 *   - 缺失字段保留原文 + 收集到 `missing` 列表给调用方决定怎么处理（warn / error）。
 *     不抛错，是为了让 install-skills 在 cache.json 字段不全时仍能产出可用的（虽不完美）skill 文件，
 *     而不是因为 email 缺失就整个失败。
 *   - 列表型占位符（`workspaces`）走单独 case，避免点路径误命中。
 *   - 不引入 mustache / handlebars 等模板引擎依赖（保持包体积，不需要条件 / 循环 / 转义）。
 */

import type { Logger } from 'pino';

export interface RenderContext {
  identity: {
    tapdUserName: string;
    tapdUserId: string;
    tapdEmail?: string;
  };
  workspaces: Array<{ id: string; name: string; role?: string }>;
  defaultWorkspaceId?: string;
  role: 'user';
  installedAt: string;
}

export interface RenderResult {
  output: string;
  /** 模板里出现但 context 里找不到的占位符（去重）。 */
  missing: string[];
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export interface RenderOptions {
  /** 可选 logger；若提供且 missing 非空，会以 warn 级别输出一条诊断。 */
  logger?: Pick<Logger, 'warn'>;
}

export function renderTemplate(
  template: string,
  ctx: RenderContext,
  options: RenderOptions = {},
): RenderResult {
  const missing = new Set<string>();

  const output = template.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
    const key = rawKey.trim();

    // 列表型占位符：单独处理
    if (key === 'workspaces') {
      if (ctx.workspaces.length === 0) {
        missing.add(key);
        return match;
      }
      return ctx.workspaces.map((w) => `- ${w.id} — ${w.name}`).join('\n');
    }
    if (key === 'workspaces.json') {
      return JSON.stringify(ctx.workspaces);
    }

    // 标量占位符：点路径解析
    const value = resolvePath(ctx as unknown as Record<string, unknown>, key);
    if (value === undefined || value === null || value === '') {
      missing.add(key);
      return match;
    }
    return String(value);
  });

  if (missing.size > 0 && options.logger) {
    options.logger.warn(
      { missingPlaceholders: Array.from(missing) },
      'skill template rendered with missing placeholders',
    );
  }

  return { output, missing: Array.from(missing) };
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
