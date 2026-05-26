/**
 * 集成测试：用真实 TAPD_TOKEN 跑端到端启动链路。
 *
 * 必须设置环境变量 TAPD_TOKEN；未设置时整组测试 skip（不让 CI 在缺凭据时失败）。
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createTapdHttpClient } from '../../src/api/client.js';
import { fetchIdentity } from '../../src/auth/identity.js';
import { fetchAccessibleWorkspaces } from '../../src/permissions/workspaces.js';

const TOKEN = process.env.TAPD_TOKEN;
const HAS_TOKEN = !!TOKEN;
const skipIfNoToken = HAS_TOKEN ? describe : describe.skip;

const logger = pino({ level: 'silent' });

function client() {
  return createTapdHttpClient({
    apiBase: process.env.TAPD_API_BASE ?? 'https://api.tapd.cn',
    token: TOKEN!,
    concurrency: 4,
    timeoutMs: 30_000,
    logger,
  });
}

skipIfNoToken('TAPD startup chain (integration)', () => {
  it('GET /users/info returns identity with current_company_id', async () => {
    const c = client();
    try {
      const id = await fetchIdentity(c, TOKEN!);
      expect(id.userId).toMatch(/^\d+$/);
      expect(id.userName.length).toBeGreaterThan(0);
      expect(id.currentCompanyId).toMatch(/^\d+$/);
      expect(id.tokenPreview).toMatch(/^.{4}\*\*\*.{4}$/);
    } finally {
      await c.close();
    }
  });

  it('GET /workspaces/user_participant_projects returns ≥1 workspace', async () => {
    const c = client();
    try {
      const ws = await fetchAccessibleWorkspaces(c);
      expect(ws.length).toBeGreaterThan(0);
      for (const w of ws) {
        expect(w.id).toMatch(/^\d+$/);
        expect(w.name.length).toBeGreaterThan(0);
        expect(typeof w.category).toBe('string');
      }
    } finally {
      await c.close();
    }
  });
});
