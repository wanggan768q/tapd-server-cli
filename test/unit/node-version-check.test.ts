/**
 * Unit tests for src/runtime/node-version-check.ts.
 *
 * v0.3.x 引入 Node 版本运行时自检的契约保证：
 *   - 阈值 22.13.0（与 package.json.engines.node 字面一致）
 *   - 不满足 → stderr 写人类可读消息 + exit(2)
 *   - 满足 → 静默返回 ok=true，不影响后续流程
 */

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  assertNodeVersion,
  parseNodeVersion,
} from '../../src/runtime/node-version-check.js';

function fakeStderr() {
  const out: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (b: Buffer) => out.push(b.toString('utf8')));
  return {
    stderr: stream as unknown as NodeJS.WritableStream,
    out,
  };
}

describe('parseNodeVersion', () => {
  it('parses standard process.version with leading v', () => {
    expect(parseNodeVersion('v22.13.0')).toEqual([22, 13, 0]);
  });

  it('parses without leading v', () => {
    expect(parseNodeVersion('20.17.5')).toEqual([20, 17, 5]);
  });

  it('strips prerelease tag', () => {
    expect(parseNodeVersion('22.13.0-rc.1')).toEqual([22, 13, 0]);
  });

  it('returns [0,0,0] for malformed input', () => {
    expect(parseNodeVersion('not-a-version')).toEqual([0, 0, 0]);
    expect(parseNodeVersion('')).toEqual([0, 0, 0]);
  });

  it('handles missing minor/patch as 0', () => {
    expect(parseNodeVersion('v22')).toEqual([22, 0, 0]);
    expect(parseNodeVersion('22.13')).toEqual([22, 13, 0]);
  });
});

describe('assertNodeVersion', () => {
  it('passes silently on Node ≥ 22.13.0', () => {
    const { stderr, out } = fakeStderr();
    let exitCalled = false;
    const result = assertNodeVersion({
      versionOverride: 'v22.13.0',
      stderr,
      exit: () => {
        exitCalled = true;
        return 'exited' as const;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.current).toBe('v22.13.0');
    expect(result.required).toBe('22.13.0');
    expect(exitCalled).toBe(false);
    expect(out.join('')).toBe('');
  });

  it('passes on much newer Node', () => {
    const { out } = fakeStderr();
    const result = assertNodeVersion({
      versionOverride: 'v24.14.1',
      stderr: { write: () => true } as unknown as NodeJS.WritableStream,
      exit: () => 'exited' as const,
    });
    expect(result.ok).toBe(true);
    expect(out.join('')).toBe('');
  });

  it('rejects Node 20.x with friendly Chinese message + exit(2)', () => {
    const { stderr, out } = fakeStderr();
    let exitCode: number | undefined;
    assertNodeVersion({
      versionOverride: 'v20.17.0',
      stderr,
      exit: (code) => {
        exitCode = code;
        return 'exited' as const;
      },
    });
    const joined = out.join('');
    expect(exitCode).toBe(2);
    expect(joined).toContain('Node.js 版本不满足要求');
    expect(joined).toContain('当前: v20.17.0');
    expect(joined).toContain('要求: ≥ 22.13.0');
    expect(joined).toContain('nvm install 22');
  });

  it('rejects Node 22.12.0 (one patch below threshold)', () => {
    const { stderr, out } = fakeStderr();
    let exitCode: number | undefined;
    assertNodeVersion({
      versionOverride: 'v22.12.0',
      stderr,
      exit: (code) => {
        exitCode = code;
        return 'exited' as const;
      },
    });
    expect(exitCode).toBe(2);
    expect(out.join('')).toContain('当前: v22.12.0');
  });

  it('rejects malformed version (parses to 0.0.0)', () => {
    const { stderr, out } = fakeStderr();
    let exitCode: number | undefined;
    assertNodeVersion({
      versionOverride: 'garbage',
      stderr,
      exit: (code) => {
        exitCode = code;
        return 'exited' as const;
      },
    });
    expect(exitCode).toBe(2);
    expect(out.join('')).toContain('当前: garbage');
  });

  it('returns result object with ok=false even when exit is mocked to no-op', () => {
    // 验证 result 的可观测性：测试代码可在不真退出的情况下断言 ok=false
    const result = assertNodeVersion({
      versionOverride: 'v18.19.0',
      stderr: { write: () => true } as unknown as NodeJS.WritableStream,
      exit: () => 'exited' as const,
    });
    expect(result.ok).toBe(false);
    expect(result.current).toBe('v18.19.0');
  });
});
