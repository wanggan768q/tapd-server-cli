/**
 * 集成测试：访问 workspace_id=99999999 触发 404，验证错误归一化为 `not_found`。
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createTapdHttpClient } from '../../src/api/client.js';
import { TapdApiError } from '../../src/api/errors.js';

const TOKEN = process.env.TAPD_TOKEN;
const ENABLED = !!TOKEN;
const skipUnless = ENABLED ? describe : describe.skip;

const logger = pino({ level: 'silent' });

skipUnless('error normalization (integration)', () => {
  it('GET /stories with non-existent workspace_id maps to not_found', async () => {
    const c = createTapdHttpClient({
      apiBase: process.env.TAPD_API_BASE ?? 'https://api.tapd.cn',
      token: TOKEN!,
      concurrency: 1,
      timeoutMs: 30_000,
      logger,
    });
    try {
      let caught: unknown;
      try {
        await c.get('/stories', { workspace_id: '99999999', limit: 1 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(TapdApiError);
      const e = caught as TapdApiError;
      expect(e.kind).toBe('not_found');
      expect(e.info).toMatch(/not existed|not\s+found/i);
    } finally {
      await c.close();
    }
  });

  it('invalid token maps to unauthenticated', async () => {
    const c = createTapdHttpClient({
      apiBase: process.env.TAPD_API_BASE ?? 'https://api.tapd.cn',
      token: 'invalid-token-deadbeef',
      concurrency: 1,
      timeoutMs: 30_000,
      logger,
    });
    try {
      let caught: unknown;
      try {
        await c.get('/users/info');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(TapdApiError);
      expect((caught as TapdApiError).kind).toBe('unauthenticated');
    } finally {
      await c.close();
    }
  });
});
