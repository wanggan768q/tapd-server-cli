import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TapdWebClient } from '../../src/api/web-client.js';
import { createCookieStore } from '../../src/auth/cookie-store.js';
import {
  BrowserNotFoundError,
  LoginTimeoutError,
  type LaunchLoginResult,
} from '../../src/auth/browser-login.js';
import {
  createAttachmentRegistry,
  DOWNLOAD_TOOL_NAME,
} from '../../src/tools/attachments-download.js';
import { registerLoginTools } from '../../src/tools/login.js';

function makeServer() {
  return new McpServer({ name: 'tapd-mcp-test', version: '0.0.0' });
}

function fakeWebClient(): TapdWebClient {
  return {
    downloadBinary: vi.fn(() => Promise.reject(new Error('unused'))),
    close: vi.fn(() => Promise.resolve()),
  };
}

function getTool(server: McpServer, name: string) {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })
    ._registeredTools;
  const t = tools[name];
  if (!t) throw new Error(`tool ${name} not registered`);
  return t.handler;
}

function getRegisteredTools(server: McpServer) {
  return (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
}

function silentLogger() {
  return pino({ level: 'silent' });
}

describe('registerLoginTools — tapd.login', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tapd-login-test-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('refuses to run in HTTP transport mode', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: true,
      createWebClient: () => fakeWebClient(),
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: vi.fn(),
    });

    const handler = getTool(server, 'tapd.login');
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('invalid_argument');
    expect(text).toContain('stdio');
  });

  it('saves cookie, arms registry, returns tools_added on success', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    const fakeClient = fakeWebClient();
    const create = vi.fn(() => fakeClient);
    const launch = vi.fn(
      async (): Promise<LaunchLoginResult> => ({
        cookieHeader: 't_i_token=abc; user=bob',
        cookieCount: 2,
        domainSuffix: 'tapd.cn',
        browserPath: '/usr/bin/chromium',
      }),
    );

    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: create,
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: launch,
    });

    const handler = getTool(server, 'tapd.login');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      cookie_count: 2,
      cookie_file: join(baseDir, 'cookie'),
      web_client: 'armed',
      tools_added: [DOWNLOAD_TOOL_NAME],
      env_cookie_warning: null,
    });
    // 文件已写入
    const fileContent = await fs.readFile(join(baseDir, 'cookie'), 'utf8');
    expect(fileContent).toBe('t_i_token=abc; user=bob');
    // download 工具已注册
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeDefined();
    // 新 webClient 被装配
    expect(create).toHaveBeenCalledWith('t_i_token=abc; user=bob');
    expect(attachmentRegistry.isArmed()).toBe(true);
  });

  it('returns env_cookie_warning when TAPD_WEB_COOKIE is set', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: () => fakeWebClient(),
      env: { TAPD_WEB_COOKIE: 'env-precedes' },
      logger: silentLogger(),
      launchAndGrabCookie: async () => ({
        cookieHeader: 'new=1',
        cookieCount: 1,
        domainSuffix: 'tapd.cn',
        browserPath: '/x',
      }),
    });

    const handler = getTool(server, 'tapd.login');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    const warning = (result.structuredContent as { env_cookie_warning: string | null })
      .env_cookie_warning;
    expect(warning).toMatch(/TAPD_WEB_COOKIE/);
  });

  it('surfaces BrowserNotFoundError as invalid_argument', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: () => fakeWebClient(),
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: async () => {
        throw new BrowserNotFoundError();
      },
    });

    const handler = getTool(server, 'tapd.login');
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('invalid_argument');
    expect(text).toContain('Chrome');
  });

  it('surfaces LoginTimeoutError as unauthenticated', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: () => fakeWebClient(),
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: async () => {
        throw new LoginTimeoutError(60_000);
      },
    });

    const handler = getTool(server, 'tapd.login');
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('unauthenticated');
  });
});

describe('registerLoginTools — tapd.logout', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tapd-login-test-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('removes download tool and clears cookie file', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    await cookieStore.save('existing-cookie');
    const initialClient = fakeWebClient();
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: initialClient,
      },
    });
    expect(attachmentRegistry.isArmed()).toBe(true);

    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: () => fakeWebClient(),
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: vi.fn(),
    });

    const handler = getTool(server, 'tapd.logout');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      cookie_file_existed: true,
      tools_removed: [DOWNLOAD_TOOL_NAME],
    });
    expect(attachmentRegistry.isArmed()).toBe(false);
    expect(getRegisteredTools(server)[DOWNLOAD_TOOL_NAME]).toBeUndefined();
    await expect(fs.access(join(baseDir, 'cookie'))).rejects.toThrow();
    expect(initialClient.close).toHaveBeenCalled();
  });

  it('is idempotent when never logged in', async () => {
    const server = makeServer();
    const cookieStore = createCookieStore({ baseDir, env: {} });
    const attachmentRegistry = createAttachmentRegistry({
      server,
      deps: {
        webBase: 'https://www.tapd.cn',
        fileBase: 'https://file.tapd.cn',
        webClient: undefined,
      },
    });
    registerLoginTools(server, {
      cookieStore,
      attachmentRegistry,
      httpModeEnabled: false,
      createWebClient: () => fakeWebClient(),
      env: {},
      logger: silentLogger(),
      launchAndGrabCookie: vi.fn(),
    });

    const handler = getTool(server, 'tapd.logout');
    const result = await handler({});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      cookie_file_existed: false,
      tools_removed: [],
    });
  });
});
