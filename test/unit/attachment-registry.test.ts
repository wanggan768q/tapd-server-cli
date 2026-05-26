import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

import {
  createAttachmentRegistry,
  DOWNLOAD_TOOL_NAME,
  GET_URL_TOOL_NAME,
} from '../../src/tools/attachments-download.js';
import type { TapdWebClient } from '../../src/api/web-client.js';

function makeServer() {
  return new McpServer({ name: 'tapd-mcp-test', version: '0.0.0' });
}

function fakeClient(): TapdWebClient {
  return {
    downloadBinary: vi.fn(() => Promise.reject(new Error('not used'))),
    close: vi.fn(() => Promise.resolve()),
  };
}

function getRegisteredTools(server: McpServer) {
  return (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
}

describe('AttachmentRegistry — hot reload', () => {
  it('starts disarmed when webClient is undefined', () => {
    const server = makeServer();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    expect(r.isArmed()).toBe(false);
    expect(r.currentTools()).toEqual([GET_URL_TOOL_NAME]);
    const tools = getRegisteredTools(server);
    expect(tools[GET_URL_TOOL_NAME]).toBeDefined();
    expect(tools[DOWNLOAD_TOOL_NAME]).toBeUndefined();
  });

  it('starts armed when webClient is provided', () => {
    const server = makeServer();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: fakeClient(),
      },
    });
    expect(r.isArmed()).toBe(true);
    expect(r.currentTools().sort()).toEqual([DOWNLOAD_TOOL_NAME, GET_URL_TOOL_NAME].sort());
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeDefined();
  });

  it('arm() registers download tool and triggers notify', () => {
    const server = makeServer();
    const notify = vi.fn();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
      notifyToolsChanged: notify,
    });
    r.arm(fakeClient());
    expect(r.isArmed()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeDefined();
  });

  it('disarm() removes download tool and triggers notify', () => {
    const server = makeServer();
    const notify = vi.fn();
    const client = fakeClient();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: client,
      },
      notifyToolsChanged: notify,
    });
    expect(r.isArmed()).toBe(true);
    const { previousClient } = r.disarm();
    expect(r.isArmed()).toBe(false);
    expect(previousClient).toBe(client);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeUndefined();
    // get_url 仍然在
    expect(getRegisteredTools(server)[GET_URL_TOOL_NAME]).toBeDefined();
  });

  it('arm() is idempotent: no double-register, no double-notify', () => {
    const server = makeServer();
    const notify = vi.fn();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
      notifyToolsChanged: notify,
    });
    r.arm(fakeClient());
    r.arm(fakeClient());
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('disarm() is idempotent when already disarmed', () => {
    const server = makeServer();
    const notify = vi.fn();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
      notifyToolsChanged: notify,
    });
    const { previousClient } = r.disarm();
    expect(r.isArmed()).toBe(false);
    expect(previousClient).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('arm → disarm → arm cycle leaves working state', () => {
    const server = makeServer();
    const notify = vi.fn();
    const r = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
      notifyToolsChanged: notify,
    });
    r.arm(fakeClient());
    expect(r.isArmed()).toBe(true);
    r.disarm();
    expect(r.isArmed()).toBe(false);
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeUndefined();
    r.arm(fakeClient());
    expect(r.isArmed()).toBe(true);
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeDefined();
    expect(notify).toHaveBeenCalledTimes(3);
  });
});
