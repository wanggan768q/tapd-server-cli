import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  createTapdHttpClient,
  type HttpRequestFn,
  type HttpResponse,
} from '../../src/api/client.js';
import { TapdApiError } from '../../src/api/errors.js';

const silentLogger = pino({ level: 'silent' });

function makeClient(httpRequest: HttpRequestFn) {
  return createTapdHttpClient({
    apiBase: 'https://api.tapd.cn',
    token: 'test-token',
    concurrency: 4,
    timeoutMs: 5_000,
    logger: silentLogger,
    sleep: () => Promise.resolve(),
    httpRequest,
  });
}

function jsonResp(statusCode: number, payload: unknown): HttpResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

describe('TapdHttpClient.get', () => {
  it('injects Bearer auth and parses success envelope', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async (url, init) => {
      expect(url).toBe('https://api.tapd.cn/users/info');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test-token');
      return jsonResp(200, { status: 1, data: { id: '1', name: 'u' }, info: 'success' });
    });
    const c = makeClient(httpRequest);
    const data = await c.get('/users/info');
    expect(data).toEqual({ id: '1', name: 'u' });
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  it('appends query params and skips undefined', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async (url) => {
      expect(url).toBe('https://api.tapd.cn/stories?workspace_id=61376769&limit=2');
      return jsonResp(200, { status: 1, data: [], info: 'success' });
    });
    const c = makeClient(httpRequest);
    await c.get('/stories', { workspace_id: '61376769', limit: 2, page: undefined });
  });

  it('throws TapdApiError on 401', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async () =>
      jsonResp(401, { status: 401, data: '', info: '401 Unauthorized', meta: { request_id: 'r1' } }),
    );
    const c = makeClient(httpRequest);
    await expect(c.get('/users/info')).rejects.toMatchObject({
      name: 'TapdApiError',
      kind: 'unauthenticated',
      tapdStatus: 401,
    });
  });

  it('classifies 404 as not_found', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async () =>
      jsonResp(404, { status: 404, data: '', info: 'workspace 99999999 not existed' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.get('/stories', { workspace_id: '99999999' })).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('does not retry 422', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async () =>
      jsonResp(422, { status: 422, data: '', info: 'bad arg' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.get('/foo')).rejects.toMatchObject({ kind: 'invalid_argument' });
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  it('retries 429 up to 3 times then surfaces error', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async () =>
      jsonResp(429, { status: 429, data: '', info: 'rate limited' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.get('/foo')).rejects.toMatchObject({ kind: 'rate_limited' });
    // 初始 1 + 3 次重试 = 4
    expect(httpRequest).toHaveBeenCalledTimes(4);
  });

  it('retries 5xx up to 2 times then surfaces error', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async () =>
      jsonResp(500, { status: 500, data: '', info: 'oops' }),
    );
    const c = makeClient(httpRequest);
    await expect(c.get('/foo')).rejects.toMatchObject({ kind: 'internal' });
    // 初始 1 + 2 次重试 = 3
    expect(httpRequest).toHaveBeenCalledTimes(3);
  });

  it('retries 5xx then succeeds', async () => {
    let n = 0;
    const httpRequest = vi.fn<HttpRequestFn>(async () => {
      n++;
      if (n === 1) return jsonResp(500, { status: 500, data: '', info: 'transient' });
      return jsonResp(200, { status: 1, data: { ok: true }, info: 'success' });
    });
    const c = makeClient(httpRequest);
    const r = await c.get('/foo');
    expect(r).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it('honors Retry-After header on 429', async () => {
    const sleepSpy = vi.fn(() => Promise.resolve());
    let n = 0;
    const httpRequest = vi.fn<HttpRequestFn>(async () => {
      n++;
      if (n === 1) {
        return {
          statusCode: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
          body: JSON.stringify({ status: 429, data: '', info: 'rate limited' }),
        };
      }
      return jsonResp(200, { status: 1, data: 'ok', info: 'success' });
    });
    const c = createTapdHttpClient({
      apiBase: 'https://api.tapd.cn',
      token: 't',
      concurrency: 1,
      timeoutMs: 5_000,
      logger: silentLogger,
      sleep: sleepSpy,
      httpRequest,
    });
    const r = await c.get('/foo');
    expect(r).toBe('ok');
    expect(sleepSpy).toHaveBeenCalledWith(2000);
  });

  it('classifies non-JSON 502 response as internal and retries', async () => {
    let n = 0;
    const httpRequest = vi.fn<HttpRequestFn>(async () => {
      n++;
      if (n <= 1) {
        return {
          statusCode: 502,
          headers: { 'content-type': 'text/html' },
          body: '<html>Bad Gateway</html>',
        };
      }
      return jsonResp(200, { status: 1, data: 'ok', info: 'success' });
    });
    const c = makeClient(httpRequest);
    const r = await c.get('/foo');
    expect(r).toBe('ok');
    expect(n).toBe(2);
  });

  it('returns TapdApiError on timeout (AbortError)', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const c = createTapdHttpClient({
      apiBase: 'https://api.tapd.cn',
      token: 't',
      concurrency: 1,
      timeoutMs: 10,
      logger: silentLogger,
      sleep: () => Promise.resolve(),
      httpRequest,
    });
    await expect(c.get('/foo')).rejects.toBeInstanceOf(TapdApiError);
  });
});

describe('TapdHttpClient.post', () => {
  it('serializes body and sets Content-Type', async () => {
    const httpRequest = vi.fn<HttpRequestFn>(async (_url, init) => {
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body!)).toEqual({ name: 'X' });
      return jsonResp(200, { status: 1, data: { id: '7' }, info: 'success' });
    });
    const c = makeClient(httpRequest);
    const r = await c.post('/stories', { name: 'X' });
    expect(r).toEqual({ id: '7' });
  });
});
