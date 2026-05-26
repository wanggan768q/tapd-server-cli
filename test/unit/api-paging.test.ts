import { describe, expect, it } from 'vitest';

import { pagingToQuery, PagingSchema } from '../../src/api/paging.js';

describe('PagingSchema', () => {
  it('accepts undefined fields', () => {
    expect(PagingSchema.parse({})).toEqual({});
  });

  it('accepts positive page and limit', () => {
    expect(PagingSchema.parse({ page: 2, limit: 50 })).toEqual({ page: 2, limit: 50 });
  });

  it('rejects non-positive page', () => {
    expect(() => PagingSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects limit > 200', () => {
    expect(() => PagingSchema.parse({ limit: 999 })).toThrow();
  });
});

describe('pagingToQuery', () => {
  it('returns empty object for undefined input', () => {
    expect(pagingToQuery(undefined)).toEqual({});
  });

  it('stringifies page and limit', () => {
    expect(pagingToQuery({ page: 1, limit: 30 })).toEqual({ page: '1', limit: '30' });
  });

  it('skips undefined fields', () => {
    expect(pagingToQuery({ page: 1 })).toEqual({ page: '1' });
  });
});
