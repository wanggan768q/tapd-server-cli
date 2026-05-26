import { describe, expect, it } from 'vitest';

import { maskToken } from '../../src/auth/mask.js';

describe('maskToken', () => {
  it('returns empty string for nullish input', () => {
    expect(maskToken(undefined)).toBe('');
    expect(maskToken(null)).toBe('');
    expect(maskToken('')).toBe('');
  });

  it('masks short tokens with asterisks only', () => {
    expect(maskToken('abc')).toBe('***');
    expect(maskToken('1234567')).toBe('*******');
  });

  it('shows first 4 + *** + last 4 for normal-length tokens', () => {
    expect(maskToken('b5725a609c40e29f73b74e3b578fc281e0d21f73')).toBe('b572***1f73');
    expect(maskToken('12345678')).toBe('1234***5678');
  });

  it('never leaks the full token even in long inputs', () => {
    const token = 'b5725a609c40e29f73b74e3b578fc281e0d21f73';
    const masked = maskToken(token);
    expect(masked).not.toContain(token);
  });
});
