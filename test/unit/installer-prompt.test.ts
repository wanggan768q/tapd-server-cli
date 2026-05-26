import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';

import { promptToken, TokenInputError } from '../../src/installer/prompt.js';

function fakeStdout() {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (b: Buffer) => chunks.push(b.toString('utf8')));
  return { stream: stream as unknown as NodeJS.WritableStream, chunks };
}

describe('promptToken — non-tty paths', () => {
  it('uses TAPD_TOKEN env when stdin is not a TTY', async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;
    const { stream: stdout, chunks } = fakeStdout();
    const r = await promptToken({
      stdin: stdin as unknown as NodeJS.ReadableStream & { isTTY?: boolean },
      stdout,
      env: { TAPD_TOKEN: 'env-pat' },
    });
    expect(r.source).toBe('env');
    expect(r.token).toBe('env-pat');
    expect(chunks.join('')).toContain('从 TAPD_TOKEN');
  });

  it('throws TokenInputError when non-tty and no env', async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;
    const { stream: stdout } = fakeStdout();
    await expect(
      promptToken({
        stdin: stdin as unknown as NodeJS.ReadableStream & { isTTY?: boolean },
        stdout,
        env: {},
      }),
    ).rejects.toThrow(TokenInputError);
  });

  it('trims whitespace from env-provided token', async () => {
    const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
    stdin.isTTY = false;
    const { stream: stdout } = fakeStdout();
    const r = await promptToken({
      stdin: stdin as unknown as NodeJS.ReadableStream & { isTTY?: boolean },
      stdout,
      env: { TAPD_TOKEN: '  trimmed-pat  ' },
    });
    expect(r.token).toBe('trimmed-pat');
  });
});
