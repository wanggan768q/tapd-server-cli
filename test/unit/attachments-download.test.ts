import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TapdApiError } from '../../src/api/errors.js';
import type { DownloadResult, TapdWebClient } from '../../src/api/web-client.js';
import { registerAttachmentDownloadTools } from '../../src/tools/attachments-download.js';

function makeServer() {
  return new McpServer({ name: 'tapd-mcp-test', version: '0.0.0' });
}

function fakeWebClient(impl: Partial<TapdWebClient>): TapdWebClient {
  return {
    downloadBinary: impl.downloadBinary ?? (() => Promise.reject(new Error('not impl'))),
    close: impl.close ?? (() => Promise.resolve()),
  };
}

function getTool(server: McpServer, name: string) {
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: Function }> })
    ._registeredTools;
  const t = tools[name];
  if (!t) throw new Error(`tool ${name} not registered`);
  return t.handler;
}

describe('registerAttachmentDownloadTools — without cookie', () => {
  it('registers only get_download_url when webClient is undefined', () => {
    const server = makeServer();
    const handles = registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: undefined,
    });
    expect(handles).toHaveLength(1);
    expect(handles[0]?.name).toBe('tapd.attachments.get_download_url');

    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(tools['tapd.attachments.get_download_url']).toBeDefined();
    expect(tools['tapd.attachments.download']).toBeUndefined();
  });

  it('get_download_url builds correct URL with default type=bug', async () => {
    const server = makeServer();
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: undefined,
    });
    const cb = getTool(server, 'tapd.attachments.get_download_url');
    const result = await cb({
      workspace_id: '61376769',
      attachment_id: '1161376769001048737',
    });
    expect(result.structuredContent).toMatchObject({
      url: 'https://file.tapd.cn/61376769/attachments/download/1161376769001048737/bug',
      workspace_id: '61376769',
      attachment_id: '1161376769001048737',
      type: 'bug',
    });
  });

  it('get_download_url respects custom type', async () => {
    const server = makeServer();
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: undefined,
    });
    const cb = getTool(server, 'tapd.attachments.get_download_url');
    const result = await cb({
      workspace_id: '1',
      attachment_id: '2',
      type: 'story',
    });
    expect((result.structuredContent as { url: string }).url).toBe(
      'https://file.tapd.cn/1/attachments/download/2/story',
    );
  });
});

describe('registerAttachmentDownloadTools — with cookie', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `tapd-att-${Date.now()}-${Math.random()}.bin`);
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true });
  });

  it('registers both tools when webClient provided', () => {
    const server = makeServer();
    const handles = registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({}),
    });
    expect(handles.map((h) => h.name).sort()).toEqual([
      'tapd.attachments.download',
      'tapd.attachments.get_download_url',
    ]);
  });

  it('download saves to file and returns sha256', async () => {
    const server = makeServer();
    const data = new TextEncoder().encode('hello world');
    const downloadBinary = vi.fn(
      async (): Promise<DownloadResult> => ({
        bytes: data,
        contentType: 'text/plain',
        filename: 'test.log',
        statusCode: 200,
      }),
    );
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({ downloadBinary }),
    });
    const cb = getTool(server, 'tapd.attachments.download');
    const result = await cb({
      workspace_id: '61376769',
      attachment_id: '123',
      save_to: tmpFile,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      mode: 'file',
      path: tmpFile,
      filename: 'test.log',
      content_type: 'text/plain',
      bytes: 11,
      sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9', // sha256("hello world")
    });
    const written = await fs.readFile(tmpFile);
    expect(written.toString('utf8')).toBe('hello world');
  });

  it('download returns base64 inline when no save_to', async () => {
    const server = makeServer();
    const data = new TextEncoder().encode('inline-bytes');
    const downloadBinary = vi.fn(
      async (): Promise<DownloadResult> => ({
        bytes: data,
        contentType: 'application/octet-stream',
        filename: 'x.bin',
        statusCode: 200,
      }),
    );
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({ downloadBinary }),
    });
    const cb = getTool(server, 'tapd.attachments.download');
    const result = await cb({
      workspace_id: '1',
      attachment_id: '1',
    });
    expect(result.structuredContent).toMatchObject({
      mode: 'inline',
      filename: 'x.bin',
      content_type: 'application/octet-stream',
      bytes: 12,
      base64: Buffer.from(data).toString('base64'),
    });
  });

  it('download rejects > max_inline_mb without save_to', async () => {
    const server = makeServer();
    const big = new Uint8Array(6 * 1024 * 1024);
    const downloadBinary = vi.fn(
      async (): Promise<DownloadResult> => ({
        bytes: big,
        contentType: 'application/octet-stream',
        filename: 'big.bin',
        statusCode: 200,
      }),
    );
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({ downloadBinary }),
    });
    const cb = getTool(server, 'tapd.attachments.download');
    const result = await cb({
      workspace_id: '1',
      attachment_id: '1',
      // no save_to, 6MB > default 5MB
    });
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('invalid_argument');
    expect(text).toContain('save_to');
  });

  it('download rejects relative save_to', async () => {
    const server = makeServer();
    const downloadBinary = vi.fn(
      async (): Promise<DownloadResult> => ({
        bytes: new Uint8Array([1]),
        contentType: 'application/octet-stream',
        filename: 'x.bin',
        statusCode: 200,
      }),
    );
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({ downloadBinary }),
    });
    const cb = getTool(server, 'tapd.attachments.download');
    const result = await cb({
      workspace_id: '1',
      attachment_id: '1',
      save_to: 'relative/path.bin',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('绝对路径');
  });

  it('download surfaces cookie-expired error from webClient', async () => {
    const server = makeServer();
    const downloadBinary = vi.fn(() =>
      Promise.reject(
        new TapdApiError({
          kind: 'unauthenticated',
          tapdStatus: 0,
          httpStatus: 0,
          info: 'TAPD_WEB_COOKIE 已失效（响应是 TAPD 登录页）',
        }),
      ),
    );
    registerAttachmentDownloadTools(server, {
      webBase: 'https://www.tapd.cn',
      fileBase: 'https://file.tapd.cn',
      webClient: fakeWebClient({ downloadBinary }),
    });
    const cb = getTool(server, 'tapd.attachments.download');
    const result = await cb({
      workspace_id: '1',
      attachment_id: '1',
    });
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    expect(text).toContain('unauthenticated');
    expect(text).toContain('TAPD_WEB_COOKIE');
  });
});
