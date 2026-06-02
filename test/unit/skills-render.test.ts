import { describe, expect, it, vi } from 'vitest';

import { renderTemplate, type RenderContext } from '../../src/skills/render.js';

function ctx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    identity: { tapdUserName: '张三', tapdUserId: '1000' },
    workspaces: [
      { id: '12345', name: '项目A' },
      { id: '67890', name: '项目B' },
    ],
    role: 'user',
    installedAt: '2026-05-30T08:00:00Z',
    ...overrides,
  };
}

describe('renderTemplate', () => {
  it('替换单个标量占位符', () => {
    const r = renderTemplate('Hello {{identity.tapdUserName}}', ctx());
    expect(r.output).toBe('Hello 张三');
    expect(r.missing).toEqual([]);
  });

  it('支持点路径访问嵌套对象', () => {
    const r = renderTemplate(
      '{{identity.tapdUserName}} ({{identity.tapdUserId}})',
      ctx(),
    );
    expect(r.output).toBe('张三 (1000)');
  });

  it('缺失占位符保留原文并收集到 missing', () => {
    const r = renderTemplate('{{identity.tapdEmail}} foo', ctx());
    expect(r.output).toBe('{{identity.tapdEmail}} foo');
    expect(r.missing).toEqual(['identity.tapdEmail']);
  });

  it('workspaces 占位符渲染为 markdown 列表', () => {
    const r = renderTemplate('Workspaces:\n{{workspaces}}', ctx());
    expect(r.output).toBe('Workspaces:\n- 12345 — 项目A\n- 67890 — 项目B');
  });

  it('workspaces 为空时记入 missing，原文保留', () => {
    const r = renderTemplate('{{workspaces}}', ctx({ workspaces: [] }));
    expect(r.output).toBe('{{workspaces}}');
    expect(r.missing).toEqual(['workspaces']);
  });

  it('workspaces.json 输出 JSON 串，不算 missing', () => {
    const r = renderTemplate('cfg={{workspaces.json}}', ctx());
    expect(r.output).toBe('cfg=[{"id":"12345","name":"项目A"},{"id":"67890","name":"项目B"}]');
    expect(r.missing).toEqual([]);
  });

  it('多次相同占位符全部替换', () => {
    const r = renderTemplate(
      '{{role}}/{{role}}/{{installedAt}}',
      ctx(),
    );
    expect(r.output).toBe('user/user/2026-05-30T08:00:00Z');
  });

  it('占位符里的空白被容忍', () => {
    const r = renderTemplate('{{ identity.tapdUserName }}', ctx());
    expect(r.output).toBe('张三');
  });

  it('空字符串字段视为缺失', () => {
    const r = renderTemplate(
      '{{defaultWorkspaceId}}',
      ctx({ defaultWorkspaceId: '' }),
    );
    expect(r.missing).toEqual(['defaultWorkspaceId']);
  });

  it('提供 logger 时缺失字段触发 warn', () => {
    const warn = vi.fn();
    renderTemplate('{{identity.tapdEmail}}', ctx(), { logger: { warn } });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      missingPlaceholders: ['identity.tapdEmail'],
    });
  });

  it('未提供 logger 时不抛错', () => {
    expect(() =>
      renderTemplate('{{identity.tapdEmail}}', ctx()),
    ).not.toThrow();
  });
});
