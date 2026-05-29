import { describe, expect, it } from 'vitest';

import { parseCli } from '../../src/cli.js';

describe('parseCli — logout subcommand', () => {
  it('parses bare logout', () => {
    const r = parseCli(['logout']);
    expect(r.mode).toBe('logout');
  });

  it('rejects extra args', () => {
    expect(() => parseCli(['logout', 'foo'])).toThrow();
  });
});
