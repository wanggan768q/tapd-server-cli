import { describe, expect, it } from 'vitest';

import { parseCli } from '../../src/cli.js';

function parseLogin(argv: string[]) {
  const r = parseCli(argv);
  if (r.mode !== 'login') throw new Error(`expected login mode, got ${r.mode}`);
  return r;
}

describe('parseCli — login subcommand', () => {
  it('parses bare login with default 300s timeout', () => {
    const r = parseLogin(['login']);
    expect(r.timeout).toBe(300);
  });

  it('parses --timeout option', () => {
    const r = parseLogin(['login', '--timeout', '60']);
    expect(r.timeout).toBe(60);
  });

  it('rejects non-integer --timeout', () => {
    expect(() => parseCli(['login', '--timeout', 'abc'])).toThrow();
  });

  it('rejects out-of-range --timeout', () => {
    expect(() => parseCli(['login', '--timeout', '0'])).toThrow();
    expect(() => parseCli(['login', '--timeout', '99999'])).toThrow();
  });
});
