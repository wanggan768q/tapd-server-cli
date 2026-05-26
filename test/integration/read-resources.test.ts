/**
 * 集成测试：对真实 workspace 跑 stories.list / bugs.list / iterations.list 的 read 路径。
 *
 * 需要 TAPD_TOKEN + TAPD_TEST_WORKSPACE_ID 两个环境变量。
 */

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createTapdHttpClient } from '../../src/api/client.js';
import { createProbeService } from '../../src/permissions/probe.js';
import { createSnapshot } from '../../src/permissions/snapshot.js';
import { RESOURCES } from '../../src/resources/definitions.js';
import { executeResourceTool } from '../../src/resources/factory.js';

const TOKEN = process.env.TAPD_TOKEN;
const WS = process.env.TAPD_TEST_WORKSPACE_ID;
const ENABLED = !!TOKEN && !!WS;
const skipUnless = ENABLED ? describe : describe.skip;

const logger = pino({ level: 'silent' });

function setup() {
  const client = createTapdHttpClient({
    apiBase: process.env.TAPD_API_BASE ?? 'https://api.tapd.cn',
    token: TOKEN!,
    concurrency: 4,
    timeoutMs: 30_000,
    logger,
  });
  const snapshot = createSnapshot([
    { id: WS!, name: 'test-workspace', category: 'project' },
  ]);
  const probes = createProbeService({ client, snapshot, readTtlSec: 600 });
  return { client, snapshot, probes };
}

skipUnless('resource list calls (integration)', () => {
  it.each([
    ['stories', { limit: 2 }],
    ['bugs', { limit: 2 }],
    ['iterations', { limit: 2 }],
  ])('lists %s with limit', async (resource, filters) => {
    const def = RESOURCES.find((r) => r.resource === resource)!;
    const list = def.actions.find((a) => a.action === 'list')!;
    const ctx = setup();
    try {
      const result = await executeResourceTool(
        def,
        list,
        { workspace_id: WS, ...filters },
        ctx,
      );
      expect(Array.isArray(result)).toBe(true);
    } finally {
      await ctx.client.close();
    }
  });
});
