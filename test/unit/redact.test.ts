/**
 * Tests for src/installer/redact.ts (PR #1 follow-up #4 + #5)。
 *
 * 验收：
 *   - 白名单：只 redact SENSITIVE_KEYS 里的值，TAPD_LOG_LEVEL='info' 不被破坏。
 *   - URL-encoded：token 经 encodeURIComponent 后的形态也被替成 ***。
 *   - err.stack：spawn 错误对象的 stack 里若含 PAT 也被替换。
 */

import { describe, expect, it } from 'vitest';

import { redact, redactError } from '../../src/installer/redact.js';

describe('redact', () => {
  it('redacts only SENSITIVE_KEYS values, not arbitrary env values', () => {
    const env = {
      TAPD_TOKEN: 'super-secret-pat-12345',
      TAPD_LOG_LEVEL: 'info',
    };
    const text = '[info] failed to connect: token=super-secret-pat-12345 (info-level)';
    const out = redact(text, env);
    expect(out).toContain('***'); // PAT 被替换
    expect(out).not.toContain('super-secret-pat-12345');
    // 非 sensitive 键的值不被破坏，原文里所有 'info' 字面都保留
    expect(out).toContain('[info]');
    expect(out).toContain('(info-level)');
  });

  it('redacts URL-encoded form of the token', () => {
    const token = 'tok+abc/def=xyz';
    const env = { TAPD_TOKEN: token };
    const encoded = encodeURIComponent(token); // tok%2Babc%2Fdef%3Dxyz
    const text = `error: failed (orig=${token}, encoded=${encoded})`;
    const out = redact(text, env);
    expect(out).not.toContain(token);
    expect(out).not.toContain(encoded);
    expect(out.match(/\*\*\*/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty / undefined-like values safely', () => {
    const out = redact('hello world', { TAPD_TOKEN: '' });
    expect(out).toBe('hello world');
  });

  it('does nothing when no SENSITIVE_KEYS are present', () => {
    const out = redact('some text with TAPD_LOG_LEVEL=info', { TAPD_LOG_LEVEL: 'info' });
    expect(out).toBe('some text with TAPD_LOG_LEVEL=info');
  });
});

describe('redactError', () => {
  it('redacts PAT from both message and stack', () => {
    const token = 'super-secret-pat-12345';
    const env = { TAPD_TOKEN: token };
    const err = new Error(`spawn EACCES: ${token}`);
    // 模拟 Node spawn 错误把 argv 拼进 stack 的情形
    err.stack = `Error: spawn EACCES: ${token}\n    at spawnSync (node:child_process:...)\n    at addJson [args=${token}]`;
    const out = redactError(err, env);
    expect(out).not.toContain(token);
    expect(out).toContain('***');
    // stack 里被替换的位置也变成 ***（验证至少 2 处命中：message 行 + stack 中 args）
    expect(out.match(/\*\*\*/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('handles non-Error inputs (string, undefined, plain object)', () => {
    const env = { TAPD_TOKEN: 'pat-xyz' };
    expect(redactError('boom: pat-xyz', env)).not.toContain('pat-xyz');
    expect(redactError(undefined, env)).toBe('undefined');
    expect(redactError({ msg: 'pat-xyz' }, env)).not.toContain('pat-xyz');
  });

  it('avoids duplicating message when stack already starts with it', () => {
    // V8 stack 默认以 "Error: <message>" 开头；redactError 不应再前置一遍 message。
    const err = new Error('boom');
    const out = redactError(err, { TAPD_TOKEN: 'x' });
    // "boom" 应只出现一次（在 stack 第一行），不被前置 message 重复一次
    expect(out.match(/boom/g)?.length).toBe(1);
  });
});
