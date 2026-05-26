import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import type { TapdHttpClient } from '../../src/api/client.js';
import { createProbeService } from '../../src/permissions/probe.js';
import { createSnapshot } from '../../src/permissions/snapshot.js';
import { createAttachmentRegistry } from '../../src/tools/attachments-download.ts';
import { registerMetaTools } from '../../src/tools/meta.ts';
import { registerResourceTools } from '../../src/tools/register.ts';

function makeServer() {
  return new McpServer({ name: 'tapd-mcp-test', version: '0.0.0' });
}

function fakeClient(): TapdHttpClient {
  return {
    get: () => Promise.resolve([]),
    post: () => Promise.resolve({}),
    close: () => Promise.resolve(),
  };
}

describe('registerResourceTools', () => {
  it('registers a tool per (resource, action)', () => {
    const server = makeServer();
    const snapshot = createSnapshot([
      { id: '47384552', name: 'Org', category: 'organization' },
      { id: '61376769', name: 'GSTM', category: 'project' },
    ]);
    const probes = createProbeService({
      client: fakeClient(),
      snapshot,
      readTtlSec: 600,
    });
    const handles = registerResourceTools({
      server,
      client: fakeClient(),
      snapshot,
      probes,
    });
    // 至少 13 个资源 × ≥2 个动作
    expect(handles.length).toBeGreaterThan(20);
    // 必含核心工具
    const names = handles.map((h) => h.name);
    expect(names).toContain('tapd.stories.list');
    expect(names).toContain('tapd.bugs.create');
    expect(names).toContain('tapd.iterations.list');
    expect(names).toContain('tapd.users.list');
  });

  it('registered tools differ in name and write flag', () => {
    const server = makeServer();
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient(),
      snapshot,
      readTtlSec: 600,
    });
    const handles = registerResourceTools({
      server,
      client: fakeClient(),
      snapshot,
      probes,
    });
    const writeNames = handles
      .filter((h) => h.spec.write)
      .map((h) => h.name);
    expect(writeNames).toContain('tapd.stories.create');
    expect(writeNames).toContain('tapd.bugs.create');
    // 只读工具不应在 write 列表
    expect(writeNames).not.toContain('tapd.stories.list');
  });
});

describe('registerMetaTools', () => {
  it('registers exactly 4 meta tools', () => {
    const server = makeServer();
    const snapshot = createSnapshot([{ id: '1', name: 'X', category: 'project' }]);
    const probes = createProbeService({
      client: fakeClient(),
      snapshot,
      readTtlSec: 600,
    });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerMetaTools(server, {
      identity: {
        userId: '1',
        userName: 'u',
        email: undefined,
        currentCompanyId: '1',
        tokenPreview: '****',
      },
      snapshot,
      probes,
      client: fakeClient(),
      resourceTools: [],
      attachmentRegistry,
      cookieSourceProvider: () => 'none',
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      notifyToolsChanged: () => {},
    });
    // SDK 没有公开 list；用内部 _registeredTools 检查（私有但稳定）
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools['tapd.whoami']).toBeDefined();
    expect(tools['tapd.list_workspaces']).toBeDefined();
    expect(tools['tapd.list_capabilities']).toBeDefined();
    expect(tools['tapd.refresh_permissions']).toBeDefined();
  });
});
