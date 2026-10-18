import { describe, expect, it } from 'vitest';
import { en, ERROR_CODES, ERROR_HTTP_STATUS, ErrorCodeSchema, fr } from '../src/index.js';

describe('error codes (L2 Table 7)', () => {
  it('maps exactly the 14 codes to their HTTP status', () => {
    expect(ERROR_HTTP_STATUS).toEqual({
      VALIDATION_ERROR: 400,
      UNAUTHENTICATED: 401,
      TOKEN_EXPIRED: 401,
      MFA_REQUIRED: 401,
      TOKEN_REUSE_DETECTED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      IDEMPOTENCY_KEY_REUSED: 422,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      SERVICE_UNAVAILABLE: 503,
    });
    expect(ERROR_CODES).toHaveLength(14);
  });

  it('has no tenant-specific code (other tenants get NOT_FOUND)', () => {
    expect(ERROR_CODES.some((code) => /TENANT|ORG/.test(code))).toBe(false);
  });

  it('validates codes', () => {
    expect(ErrorCodeSchema.safeParse('NOT_FOUND').success).toBe(true);
    expect(ErrorCodeSchema.safeParse('TENANT_MISMATCH').success).toBe(false);
  });

  it('has a fr and en message for every code', () => {
    for (const locale of [fr, en]) {
      expect(Object.keys(locale.errors).sort()).toEqual([...ERROR_CODES].sort());
    }
  });
});
