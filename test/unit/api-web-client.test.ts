import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { TapdApiError } from '../../src/api/errors.js';
import {
  createTapdWebClient,
  type WebHttpRequestFn,
  type WebHttpResponse,
} from '../../src/api/web-client.js';

const silentLogger = pino({ level: 'silent' });

function makeClient(httpRequest: WebHttpRequestFn) {
  return createTapdWebClient({
    webBase: 'https://www.tapd.cn',
    cookie: 'sess=abc; another=def',
    concurrency: 2,
    timeoutMs: 5_000,
    logger: silentLogger,
    sleep: () => Promise.resolve(),
    httpRequest,
  });
}

function binaryResp(bytes: Uint8Array, headers: Record<string, string> = {}): WebHttpResponse {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body: bytes,
  };
}

describe('TapdWebClient.downloadBinary', () => {
  it('injects Cookie header and returns body bytes', async () => {
    const data = new TextEncoder().encode('hello world');
    const httpRequest = vi.fn<WebHttpRequestFn>(async (url, init) => {
      expect(url).toBe('https://www.tapd.cn/61376769/attachments/download/123/bug');
      expect(init.method).toBe('GET');
      expect(init.headers.Cookie).toBe('sess=abc; another=def');
      return binaryResp(data, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="x.log"',
      });
    });
    const c = makeClient(httpRequest);
    const r = await c.downloadBinary('/61376769/attachments/download/123/bug', {});
    expect(r.statusCode).toBe(200);
    expect(r.contentType).toBe('text/plain');
    expect(r.filename).toBe('x.log');
    expect(new TextDecoder().decode(r.bytes)).toBe('hello world');
  });

  it('flags 2-byte HTML response as expired cookie', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () =>
      binaryResp(new Uint8Array([0x5b, 0x5d]), { 'content-type': 'text/html; charset=utf-8' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toMatchObject({
      kind: 'unauthenticated',
      info: expect.stringContaining('TAPD_WEB_COOKIE 已失效'),
    });
  });

  it('flags login-page HTML as expired cookie', async () => {
    const html = '<!DOCTYPE html><html><head><title>登录-TAPD</title></head>';
    const httpRequest = vi.fn<WebHttpRequestFn>(async () =>
      binaryResp(new TextEncoder().encode(html), { 'content-type': 'text/html' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('flags HTML on attachments/download URL as expired cookie', async () => {
    const html = '<!DOCTYPE html><html><body>not login page but still html</body></html>';
    const httpRequest = vi.fn<WebHttpRequestFn>(async () =>
      binaryResp(new TextEncoder().encode(html), { 'content-type': 'text/html' }),
    );
    const c = makeClient(httpRequest);
    await expect(
      c.downloadBinary('/61376769/attachments/download/1/bug', {}),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('does NOT flag legitimate small binary as expired', async () => {
    const tiny = new Uint8Array([1, 2, 3, 4, 5]);
    const httpRequest = vi.fn<WebHttpRequestFn>(async () =>
      binaryResp(tiny, { 'content-type': 'application/octet-stream' }),
    );
    const c = makeClient(httpRequest);
    const r = await c.downloadBinary('/path', {});
    expect(r.bytes.byteLength).toBe(5);
  });

  it('treats 302 redirect as expired cookie', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () => ({
      statusCode: 302,
      headers: { location: 'https://www.tapd.cn/login' },
      body: new Uint8Array(0),
    }));
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('maps 403 to permission_denied', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () => ({
      statusCode: 403,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('forbidden'),
    }));
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toMatchObject({ kind: 'permission_denied' });
  });

  it('maps 404 to not_found', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () => ({
      statusCode: 404,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('not found'),
    }));
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('retries 5xx up to 2 times then surfaces internal', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () => ({
      statusCode: 502,
      headers: { 'content-type': 'text/html' },
      body: new TextEncoder().encode('<html>bad gateway</html>'),
    }));
    const c = makeClient(httpRequest);
    await expect(c.downloadBinary('/path', {})).rejects.toBeInstanceOf(TapdApiError);
    expect(httpRequest).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('retries 5xx then succeeds', async () => {
    let n = 0;
    const httpRequest = vi.fn<WebHttpRequestFn>(async () => {
      n++;
      if (n === 1) {
        return {
          statusCode: 503,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('busy'),
        };
      }
      return binaryResp(new TextEncoder().encode('OK'));
    });
    const c = makeClient(httpRequest);
    const r = await c.downloadBinary('/path', {});
    expect(r.bytes.byteLength).toBe(2);
  });

  it('falls back to last URL segment as filename when no Content-Disposition', async () => {
    const httpRequest = vi.fn<WebHttpRequestFn>(async () =>
      binaryResp(new Uint8Array([0x41]), { 'content-type': 'application/octet-stream' }),
    );
    const c = makeClient(httpRequest);
    const r = await c.downloadBinary('/61376769/attachments/download/123/bug', {});
    expect(r.filename).toBe('bug');
  });
});
