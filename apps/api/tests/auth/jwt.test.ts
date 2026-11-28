import { createHmac, type KeyObject, randomUUID } from 'node:crypto';
import {
  signAccessToken,
  signMfaToken,
  TokenError,
  type TokenFailureReason,
  verifyAccessToken,
  verifyMfaToken,
} from '../../src/platform/auth/jwt';
import { MAX_TOKEN_BYTES } from '../../src/platform/auth/token-claims';
import { jwtKeyring, randomKey } from '../helpers/keys';

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const NOW_S = NOW / 1000;
const subject = {
  userId: randomUUID(),
  orgId: randomUUID(),
  role: 'TECHNICIAN',
  sessionVersion: 3,
} as const;

const key1 = randomKey(32);
const keyring = jwtKeyring(new Map([[1, key1]]), 1);

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Builds a compact JWS by hand, so tests can sign anything the library itself would refuse to produce. */
function forge(
  header: Record<string, unknown>,
  payload: unknown,
  key: KeyObject = key1,
  hash = 'sha256',
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${createHmac(hash, key).update(input).digest('base64url')}`;
}

const header = (overrides: Record<string, unknown> = {}) => ({
  alg: 'HS256',
  typ: 'JWT',
  kid: '1',
  ...overrides,
});

const accessClaims = (overrides: Record<string, unknown> = {}) => ({
  sub: subject.userId,
  org: subject.orgId,
  role: subject.role,
  sv: subject.sessionVersion,
  jti: randomUUID(),
  iss: 'secure360-api',
  aud: 'secure360-api',
  iat: NOW_S,
  exp: NOW_S + 3600,
  ...overrides,
});

function failureOf(fn: () => unknown): TokenFailureReason {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof TokenError)) throw error;
    // The message is the same for every failure: the reason is for logs only.
    expect(error.message).toBe('Invalid token');
    return error.reason;
  }
  throw new Error('expected a TokenError');
}

const verifyAt = (token: string, now = NOW) => verifyAccessToken(keyring, token, now);

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips the claims, with kid = active key id, issuer, audience and a 1 h lifetime', () => {
    const token = signAccessToken(keyring, subject, NOW);
    const claims = verifyAt(token);

    expect(claims).toEqual({
      sub: subject.userId,
      org: subject.orgId,
      role: 'TECHNICIAN',
      sv: 3,
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      iss: 'secure360-api',
      aud: 'secure360-api',
      iat: NOW_S,
      exp: NOW_S + 3600,
    });
    const decodedHeader: unknown = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
    );
    expect(decodedHeader).toEqual({ alg: 'HS256', typ: 'JWT', kid: '1' });
  });

  it('gives every token its own jti', () => {
    const first = verifyAt(signAccessToken(keyring, subject, NOW));
    const second = verifyAt(signAccessToken(keyring, subject, NOW));

    expect(first.jti).not.toBe(second.jti);
  });

  it('accepts a hand-built token with valid claims (the forging helper is sound)', () => {
    expect(verifyAt(forge(header(), accessClaims())).sv).toBe(3);
  });

  it.each([
    ['session version 0', { ...subject, sessionVersion: 0 }],
    ['a non-UUID user id', { ...subject, userId: 'admin' }],
  ])('refuses to sign %s', (_label, bad) => {
    expect(() => signAccessToken(keyring, bad, NOW)).toThrow(TypeError);
  });
});

describe('verifyAccessToken: time', () => {
  const token = () => signAccessToken(keyring, subject, NOW);

  it('rejects an expired token as expired', () => {
    expect(failureOf(() => verifyAt(token(), NOW + 3606_000))).toBe('expired');
  });

  it('accepts a token up to exp + 5 s and rejects it at exp + 6 s', () => {
    expect(verifyAt(token(), NOW + 3605_000).sv).toBe(3);
    expect(failureOf(() => verifyAt(token(), NOW + 3606_000))).toBe('expired');
  });

  it('checks the claims before expiry: an expired token with invalid claims is not "expired"', () => {
    const forged = forge(header(), accessClaims({ admin: true }));
    expect(failureOf(() => verifyAt(forged, NOW + 7200_000))).toBe('claims_invalid');
  });

  it('rejects a token older than the 1 h maxAge even when its exp is later', () => {
    const forged = forge(header(), accessClaims({ iat: NOW_S - 4000, exp: NOW_S + 100 }));
    expect(failureOf(() => verifyAt(forged))).toBe('expired');
  });

  it('rejects an iat in the future beyond the tolerance', () => {
    const forged = forge(header(), accessClaims({ iat: NOW_S + 60, exp: NOW_S + 3660 }));
    expect(failureOf(() => verifyAt(forged))).toBe('claims_invalid');
  });

  it('rejects a lifetime longer than 1 h', () => {
    const forged = forge(header(), accessClaims({ exp: NOW_S + 3601 }));
    expect(failureOf(() => verifyAt(forged))).toBe('claims_invalid');
  });
});

describe('verifyAccessToken: signature, algorithm and key id', () => {
  it('rejects a tampered payload', () => {
    const [head, , signature] = signAccessToken(keyring, subject, NOW).split('.');
    const tampered = `${head}.${b64(accessClaims({ role: 'ADMIN' }))}.${signature}`;
    expect(failureOf(() => verifyAt(tampered))).toBe('bad_signature');
  });

  it('rejects a tampered signature', () => {
    const [head, payload, signature = ''] = signAccessToken(keyring, subject, NOW).split('.');
    const flipped = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    expect(failureOf(() => verifyAt(`${head}.${payload}.${flipped}`))).toBe('bad_signature');
  });

  it('rejects a token signed with a key outside the ring under a valid kid', () => {
    expect(failureOf(() => verifyAt(forge(header(), accessClaims(), randomKey())))).toBe(
      'bad_signature',
    );
  });

  it('rejects alg "none" without a signature', () => {
    const unsigned = `${b64(header({ alg: 'none' }))}.${b64(accessClaims())}.`;
    expect(failureOf(() => verifyAt(unsigned))).toBe('malformed');
  });

  it('rejects alg "none" with a signature attached', () => {
    expect(failureOf(() => verifyAt(forge(header({ alg: 'none' }), accessClaims())))).toBe(
      'bad_header',
    );
  });

  it('rejects an RS256 header (algorithm confusion)', () => {
    expect(failureOf(() => verifyAt(forge(header({ alg: 'RS256' }), accessClaims())))).toBe(
      'bad_header',
    );
  });

  it('rejects HS512 even when signed with the real key', () => {
    const forged = forge(header({ alg: 'HS512' }), accessClaims(), key1, 'sha512');
    expect(failureOf(() => verifyAt(forged))).toBe('bad_header');
  });

  it.each([
    ['a missing kid', { kid: undefined }],
    ['a numeric kid', { kid: 1 }],
    ['a leading-zero kid', { kid: '01' }],
    ['an extra header parameter', { jku: 'https://attacker.example/keys' }],
    ['another typ', { typ: 'at+jwt' }],
  ])('rejects %s', (_label, overrides) => {
    expect(failureOf(() => verifyAt(forge(header(overrides), accessClaims())))).toBe('bad_header');
  });

  it('rejects an unknown kid without trying the other keys', () => {
    // Signed with key 1, the only key in the ring: trying the other keys would accept it.
    expect(failureOf(() => verifyAt(forge(header({ kid: '2' }), accessClaims())))).toBe(
      'unknown_kid',
    );
  });
});

describe('verifyAccessToken: claims', () => {
  it('rejects a wrong issuer', () => {
    expect(failureOf(() => verifyAt(forge(header(), accessClaims({ iss: 'other' }))))).toBe(
      'wrong_issuer',
    );
  });

  it('rejects a wrong audience', () => {
    expect(failureOf(() => verifyAt(forge(header(), accessClaims({ aud: 'other' }))))).toBe(
      'wrong_audience',
    );
  });

  it.each([
    ['an extra claim', { admin: true }],
    ['an nbf claim', { nbf: NOW_S }],
    ['an audience array', { aud: ['secure360-api'] }],
    ['a missing sv', { sv: undefined }],
    ['a missing jti', { jti: undefined }],
    ['a missing org', { org: undefined }],
    ['sv 0', { sv: 0 }],
    ['a fractional sv', { sv: 1.5 }],
    ['an unknown role', { role: 'SUPERADMIN' }],
    ['an upper-case sub', { sub: subject.userId.toUpperCase() }],
  ])('rejects %s', (_label, overrides) => {
    expect(failureOf(() => verifyAt(forge(header(), accessClaims(overrides))))).toBe(
      'claims_invalid',
    );
  });
});

describe('verifyAccessToken: input shape', () => {
  it('rejects a token over 4 KB before parsing it', () => {
    const padding = 'A'.repeat(MAX_TOKEN_BYTES);
    expect(failureOf(() => verifyAt(`${padding}.${padding}.${padding}`))).toBe('too_long');
  });

  it.each([
    ['an empty string', ''],
    ['two segments', 'a.b'],
    ['four segments', 'a.b.c.d'],
    ['non-base64url characters', 'a+b.c.d'],
  ])('rejects %s as malformed', (_label, token) => {
    expect(failureOf(() => verifyAt(token))).toBe('malformed');
  });

  it('rejects a header that is not JSON', () => {
    const token = `${Buffer.from('not json').toString('base64url')}.${b64(accessClaims())}.c2ln`;
    expect(failureOf(() => verifyAt(token))).toBe('bad_header');
  });
});

describe('key rotation', () => {
  const oldKey = randomKey(32);
  const newKey = randomKey(48);

  it('verifies old tokens while the old key is in the ring, signs new ones with the new kid', () => {
    const before = jwtKeyring(new Map([[1, oldKey]]), 1);
    const oldToken = signAccessToken(before, subject, NOW);
    const during = jwtKeyring(
      new Map([
        [1, oldKey],
        [2, newKey],
      ]),
      2,
    );
    const newToken = signAccessToken(during, subject, NOW);

    expect(verifyAccessToken(during, oldToken, NOW).sv).toBe(3);
    expect(verifyAccessToken(during, newToken, NOW).sv).toBe(3);
    expect(JSON.parse(Buffer.from(newToken.split('.')[0] ?? '', 'base64url').toString())).toEqual(
      expect.objectContaining({ kid: '2' }),
    );
  });

  it('rejects old tokens once the old key is removed', () => {
    const oldToken = signAccessToken(jwtKeyring(new Map([[1, oldKey]]), 1), subject, NOW);
    const after = jwtKeyring(new Map([[2, newKey]]), 2);

    expect(failureOf(() => verifyAccessToken(after, oldToken, NOW))).toBe('unknown_kid');
  });
});

describe('MFA tokens', () => {
  it('round-trips sub and jti with the MFA audience, typ and a 5 min lifetime', () => {
    const { token, jti } = signMfaToken(keyring, subject.userId, NOW);

    expect(verifyMfaToken(keyring, token, NOW)).toEqual({
      sub: subject.userId,
      jti,
      iss: 'secure360-api',
      aud: 'secure360-mfa',
      typ: 'mfa',
      iat: NOW_S,
      exp: NOW_S + 300,
    });
  });

  it('expires after 5 minutes', () => {
    const { token } = signMfaToken(keyring, subject.userId, NOW);
    expect(failureOf(() => verifyMfaToken(keyring, token, NOW + 306_000))).toBe('expired');
  });

  it('is rejected by verifyAccessToken', () => {
    const { token } = signMfaToken(keyring, subject.userId, NOW);
    expect(failureOf(() => verifyAt(token))).toBe('wrong_audience');
  });

  it('is rejected by verifyAccessToken for its class, not as expired, once expired', () => {
    const { token } = signMfaToken(keyring, subject.userId, NOW);
    expect(failureOf(() => verifyAt(token, NOW + 600_000))).toBe('wrong_audience');
  });

  it('an expired access token is rejected by verifyMfaToken for its class, not as expired', () => {
    const token = signAccessToken(keyring, subject, NOW);
    expect(failureOf(() => verifyMfaToken(keyring, token, NOW + 7200_000))).toBe('wrong_audience');
  });

  it('is rejected by verifyAccessToken even with the access audience (strict claims)', () => {
    const forged = forge(header(), {
      sub: subject.userId,
      jti: randomUUID(),
      iss: 'secure360-api',
      aud: 'secure360-api',
      typ: 'mfa',
      iat: NOW_S,
      exp: NOW_S + 300,
    });
    expect(failureOf(() => verifyAt(forged))).toBe('claims_invalid');
  });

  it('an access token is rejected by verifyMfaToken', () => {
    const token = signAccessToken(keyring, subject, NOW);
    expect(failureOf(() => verifyMfaToken(keyring, token, NOW))).toBe('wrong_audience');
  });

  it('an access-shaped token with the MFA audience is rejected by verifyMfaToken', () => {
    const forged = forge(header(), accessClaims({ aud: 'secure360-mfa', exp: NOW_S + 300 }));
    expect(failureOf(() => verifyMfaToken(keyring, forged, NOW))).toBe('claims_invalid');
  });
});
