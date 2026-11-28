import { type KeyObject, randomUUID } from 'node:crypto';
import { JsonWebTokenError, sign, verify } from 'jsonwebtoken';
import type { UserRole } from '@secure360/shared';
import type { z } from 'zod';
import type { Keyring } from '../crypto/keyring';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_TTL_SECONDS,
  type AccessTokenClaims,
  AccessTokenClaimsSchema,
  CLOCK_TOLERANCE_SECONDS,
  MAX_TOKEN_BYTES,
  MFA_TOKEN_AUDIENCE,
  MFA_TOKEN_TTL_SECONDS,
  type MfaTokenClaims,
  MfaTokenClaimsSchema,
  TOKEN_ISSUER,
  TokenHeaderSchema,
} from './token-claims';

const ALGORITHM = 'HS256';
// Three non-empty base64url segments. An unsigned (alg "none") token has an empty third segment and stops here.
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type TokenFailureReason =
  | 'too_long'
  | 'malformed'
  | 'bad_header'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired'
  | 'wrong_audience'
  | 'wrong_issuer'
  | 'claims_invalid';

/**
 * The only error verification produces. The message never says which check failed; `reason` is a fixed value for
 * internal logs only, so callers can map it to TOKEN_EXPIRED or UNAUTHENTICATED without leaking it.
 */
export class TokenError extends Error {
  override readonly name = 'TokenError';

  constructor(readonly reason: TokenFailureReason) {
    super('Invalid token');
  }
}

export interface AccessTokenSubject {
  readonly userId: string;
  readonly orgId: string;
  readonly role: UserRole;
  readonly sessionVersion: number;
}

interface TokenKind<T extends { iat: number; exp: number }> {
  readonly audience: string;
  readonly ttlSeconds: number;
  readonly schema: z.ZodType<T>;
}

const ACCESS_TOKEN: TokenKind<AccessTokenClaims> = {
  audience: ACCESS_TOKEN_AUDIENCE,
  ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  schema: AccessTokenClaimsSchema,
};

const MFA_TOKEN: TokenKind<MfaTokenClaims> = {
  audience: MFA_TOKEN_AUDIENCE,
  ttlSeconds: MFA_TOKEN_TTL_SECONDS,
  schema: MfaTokenClaimsSchema,
};

const toSeconds = (ms: number): number => Math.floor(ms / 1000);

function signClaims<T extends { iat: number; exp: number }>(
  keyring: Keyring,
  kind: TokenKind<T>,
  claims: unknown,
): string {
  // Our own input, checked anyway: a token this API signs must always pass its own verification.
  const parsed = kind.schema.safeParse(claims);
  if (!parsed.success) throw new TypeError('Refusing to sign invalid token claims');
  const key = keyring.keyFor(keyring.activeKeyId);
  if (key === undefined) throw new TypeError('The active key is missing from the keyring');
  // iat and exp are in the payload, so jsonwebtoken adds no timestamp of its own.
  return sign(parsed.data, key, { algorithm: ALGORITHM, keyid: String(keyring.activeKeyId) });
}

/** Access token (1 h, BNF05) with header kid = the active key id. `now` is for tests. */
export function signAccessToken(
  keyring: Keyring,
  subject: AccessTokenSubject,
  now = Date.now(),
): string {
  const iat = toSeconds(now);
  return signClaims(keyring, ACCESS_TOKEN, {
    sub: subject.userId,
    org: subject.orgId,
    role: subject.role,
    sv: subject.sessionVersion,
    jti: randomUUID(),
    iss: TOKEN_ISSUER,
    aud: ACCESS_TOKEN_AUDIENCE,
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** 5-minute token restricted to the verify-2fa endpoint (L2 §8.2); returns the token and its jti. */
export function signMfaToken(
  keyring: Keyring,
  userId: string,
  now = Date.now(),
): { token: string; jti: string } {
  const iat = toSeconds(now);
  const jti = randomUUID();
  const token = signClaims(keyring, MFA_TOKEN, {
    sub: userId,
    jti,
    iss: TOKEN_ISSUER,
    aud: MFA_TOKEN_AUDIENCE,
    typ: 'mfa',
    iat,
    exp: iat + MFA_TOKEN_TTL_SECONDS,
  });
  return { token, jti };
}

function decodeSegment(segment: string): unknown {
  const bytes = Buffer.from(segment, 'base64url');
  // Buffer.from skips characters it does not expect: only canonical base64url is accepted.
  if (bytes.toString('base64url') !== segment) return undefined;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

// The key is chosen by kid alone: an unknown kid is refused, never retried against the other keys.
function selectKey(keyring: Keyring, token: string): KeyObject {
  if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) throw new TokenError('too_long');
  if (!COMPACT_JWS.test(token)) throw new TokenError('malformed');
  const header = TokenHeaderSchema.safeParse(decodeSegment(token.slice(0, token.indexOf('.'))));
  if (!header.success) throw new TokenError('bad_header');
  const key = keyring.keyFor(Number(header.data.kid));
  if (key === undefined) throw new TokenError('unknown_kid');
  return key;
}

// Never 'expired': the library checks no time here, and expiry must not be reported before the class is proven.
function libraryFailure(error: unknown): TokenError {
  // Messages of jsonwebtoken 9 (verify.js); anything unrecognised is still a rejection.
  const message = error instanceof JsonWebTokenError ? error.message : '';
  if (message === 'invalid signature') return new TokenError('bad_signature');
  if (message.startsWith('jwt audience invalid')) return new TokenError('wrong_audience');
  if (message.startsWith('jwt issuer invalid')) return new TokenError('wrong_issuer');
  return new TokenError('claims_invalid');
}

/** Runs on claims of the right class only, so 'expired' (TOKEN_EXPIRED) is never reported for a token of another. */
function checkTimeline(
  { iat, exp }: { iat: number; exp: number },
  ttlSeconds: number,
  nowSeconds: number,
): void {
  // An iat in the future would stretch the age limit.
  if (iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) throw new TokenError('claims_invalid');
  // Age limit before the lifetime check: an old token stays 'expired' even if its exp was forged later.
  if (nowSeconds > iat + ttlSeconds + CLOCK_TOLERANCE_SECONDS) throw new TokenError('expired');
  if (exp <= iat || exp - iat > ttlSeconds) throw new TokenError('claims_invalid');
  if (nowSeconds > exp + CLOCK_TOLERANCE_SECONDS) throw new TokenError('expired');
}

function verifyToken<T extends { iat: number; exp: number }>(
  keyring: Keyring,
  token: string,
  kind: TokenKind<T>,
  now: number,
): T {
  const key = selectKey(keyring, token);
  const nowSeconds = toSeconds(now);
  let payload: unknown;
  try {
    // Time is checked below, after the token's class is proven: jsonwebtoken checks exp before the audience, so an
    // expired token of the wrong class would come back as 'expired' (TOKEN_EXPIRED). Its maxAge is left out too:
    // it rejects at iat + maxAge + tolerance inclusive, one second earlier than the exp check below.
    payload = verify(token, key, {
      algorithms: [ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: kind.audience,
      ignoreExpiration: true,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      clockTimestamp: nowSeconds,
    });
  } catch (error) {
    throw libraryFailure(error);
  }
  const claims = kind.schema.safeParse(payload);
  if (!claims.success) throw new TokenError('claims_invalid');
  checkTimeline(claims.data, kind.ttlSeconds, nowSeconds);
  return claims.data;
}

/** Verifies an access token. Throws TokenError, and nothing else, for any bad input. */
export function verifyAccessToken(
  keyring: Keyring,
  token: string,
  now = Date.now(),
): AccessTokenClaims {
  return verifyToken(keyring, token, ACCESS_TOKEN, now);
}

/** Verifies an MFA token. Single use and attempt limits belong to the verify-2fa service (BUILD_CHECKLIST). */
export function verifyMfaToken(keyring: Keyring, token: string, now = Date.now()): MfaTokenClaims {
  return verifyToken(keyring, token, MFA_TOKEN, now);
}
