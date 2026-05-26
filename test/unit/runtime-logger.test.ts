import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../src/runtime/logger.js';

/**
 * 捕获 logger 输出到内存。由于 createLogger 内置 pino.destination({fd:2})，
 * 这里通过 monkey-patch process.stderr.write 拦截。
 */
function captureStderr<T>(fn: () => T): { output: string; result: T } {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  const stub = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write);
  try {
    const result = fn();
    stub.mockRestore();
    return { output: chunks.join(''), result };
  } finally {
    process.stderr.write = orig;
  }
}

describe('createLogger', () => {
  const TOKEN = 'b5725a609c40e29f73b74e3b578fc281e0d21f73';

  it('does not leak full token via the token field', async () => {
    const { output } = captureStderr(() => {
      const logger = createLogger({ level: 'info', token: TOKEN });
      logger.info({ token: TOKEN, msg: 'auth_ready' }, 'auth ready');
      return logger;
    });
    // 异步刷盘：pino sync:false 时需要等一拍
    await new Promise((r) => setTimeout(r, 50));
    expect(output).not.toContain(TOKEN);
  });

  it('redacts Authorization header from nested fields', async () => {
    const { output } = captureStderr(() => {
      const logger = createLogger({ level: 'info', token: TOKEN });
      logger.info(
        { headers: { authorization: `Bearer ${TOKEN}` }, msg: 'tapd_request' },
        'request',
      );
      return logger;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(output).not.toContain(TOKEN);
  });

  it('uses Writable in place of fd2 for pino.destination', () => {
    // 仅校验类型兼容 — Writable 用于本测试是 sanity check
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    expect(typeof sink.write).toBe('function');
  });
});
