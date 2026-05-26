import { describe, expect, it } from 'vitest';

import {
  classifyError,
  TapdApiError,
  unwrapEnvelope,
  type TapdEnvelope,
} from '../../src/api/errors.js';

describe('classifyError', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'permission_denied'],
    [404, 'not_found'],
    [422, 'invalid_argument'],
    [400, 'invalid_argument'],
    [429, 'rate_limited'],
    [500, 'internal'],
    [503, 'internal'],
    [999, 'unknown'],
  ])('maps status %i to %s', (status, expected) => {
    expect(classifyError({ bodyStatus: status, httpStatus: 200 })).toBe(expected);
  });

  it('prefers body status over HTTP status', () => {
    expect(classifyError({ bodyStatus: 401, httpStatus: 200 })).toBe('unauthenticated');
  });

  it('falls back to HTTP status when body status is 0', () => {
    expect(classifyError({ bodyStatus: 0, httpStatus: 502 })).toBe('internal');
  });
});

describe('unwrapEnvelope', () => {
  it('returns data on success (status=1)', () => {
    const env: TapdEnvelope<{ id: string }> = {
      status: 1,
      data: { id: '1' },
      info: 'success',
    };
    expect(unwrapEnvelope(env, 200)).toEqual({ id: '1' });
  });

  it('throws TapdApiError with all metadata on failure', () => {
    const env: TapdEnvelope = {
      status: 422,
      data: '',
      info: 'company_id is required.',
      meta: { request_id: 'abc-123' },
    };
    try {
      unwrapEnvelope(env, 200);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TapdApiError);
      const err = e as TapdApiError;
      expect(err.kind).toBe('invalid_argument');
      expect(err.tapdStatus).toBe(422);
      expect(err.info).toBe('company_id is required.');
      expect(err.requestId).toBe('abc-123');
    }
  });

  it('passes retryAfterMs through for rate limit', () => {
    const env: TapdEnvelope = { status: 429, data: '', info: 'too many requests' };
    try {
      unwrapEnvelope(env, 429, 1500);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as TapdApiError;
      expect(err.kind).toBe('rate_limited');
      expect(err.retryAfterMs).toBe(1500);
    }
  });

  it('reclassifies 422 + "access token invalid" as unauthenticated', () => {
    const env: TapdEnvelope = {
      status: 422,
      data: '',
      info: 'The access token provided is invalid',
    };
    try {
      unwrapEnvelope(env, 200);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as TapdApiError).kind).toBe('unauthenticated');
    }
  });
});

describe('TapdApiError.toJSON', () => {
  it('serializes all observable fields', () => {
    const err = new TapdApiError({
      kind: 'not_found',
      tapdStatus: 404,
      httpStatus: 200,
      info: 'workspace 99999999 not existed',
      requestId: 'req-42',
    });
    const json = err.toJSON();
    expect(json).toMatchObject({
      kind: 'not_found',
      tapdStatus: 404,
      info: 'workspace 99999999 not existed',
      requestId: 'req-42',
    });
  });
});
