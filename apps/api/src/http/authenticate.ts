import type { Request, RequestHandler } from 'express';
import type { UserRole } from '@secure360/shared';
import { TokenError, type TokenFailureReason, verifyAccessToken } from '../platform/auth/jwt';
import type { SessionStateReader, SessionVersionLoader } from '../platform/auth/session-state';
import type { AccessTokenClaims } from '../platform/auth/token-claims';
import type { Keyring } from '../platform/crypto/keyring';
import { AppError, forbidden, unauthenticated } from './app-error';

export type AuthFailureReason =
  | TokenFailureReason
  | 'missing'
  | 'multiple_headers'
  | 'bad_scheme'
  | 'denied'
  | 'stale_session'
  | 'inactive_or_missing';

export interface AuthenticateDeps {
  readonly keyring: Keyring;
  readonly sessionState: SessionStateReader;
  /** Decides a cache miss; without it a revoked token would stay valid once its sv key is lost. */
  readonly loadSessionVersion: SessionVersionLoader;
  readonly now?: () => number;
}

// RFC 6750 §2.1: scheme case-insensitive, then exactly one token68-like value. A second token, a comma or a trailing
// space does not match. The token never comes from the query string or a cookie.
const BEARER = /^Bearer +([A-Za-z0-9._-]+)$/i;

// Expired tokens and a session the client can refresh into get TOKEN_EXPIRED (the client refreshes; task 13 decides
// whether the session survives). Every other failure is UNAUTHENTICATED with no hint of which check failed.
const EXPIRED_REASONS: ReadonlySet<AuthFailureReason> = new Set(['expired', 'stale_session']);

// Ordinary traffic stays quiet; what only a forged or tampered token produces is a warning.
const QUIET_REASONS: ReadonlySet<AuthFailureReason> = new Set(['missing']);
const ROUTINE_REASONS: ReadonlySet<AuthFailureReason> = new Set([
  'expired',
  'stale_session',
  'denied',
  'inactive_or_missing',
]);

class AuthFailure extends Error {
  constructor(readonly reason: AuthFailureReason) {
    super(reason);
  }
}

function reject(req: Request, reason: AuthFailureReason): AppError {
  const level = QUIET_REASONS.has(reason) ? 'debug' : ROUTINE_REASONS.has(reason) ? 'info' : 'warn';
  // The reason only: never the header, the token or its claims.
  req.log?.[level]({ reason }, 'auth.token.rejected');
  return EXPIRED_REASONS.has(reason) ? new AppError('TOKEN_EXPIRED') : unauthenticated();
}

// Node keeps only the first of repeated Authorization headers in req.headers; rawHeaders still has every line. A
// proxy or cache that reads the last one would then see a different identity than this API.
function countAuthorizationHeaders(req: Request): number {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === 'authorization') count += 1;
  }
  return count;
}

function readBearerToken(req: Request): string {
  if (countAuthorizationHeaders(req) > 1) throw new AuthFailure('multiple_headers');
  const header = req.get('authorization');
  if (header === undefined || header === '') throw new AuthFailure('missing');
  const match = BEARER.exec(header);
  if (match?.[1] === undefined) throw new AuthFailure('bad_scheme');
  return match[1];
}

async function checkSession(
  deps: AuthenticateDeps,
  req: Request,
  claims: AccessTokenClaims,
): Promise<void> {
  const state = await deps.sessionState.read(claims.sub, claims.jti);
  // Redis down (L2 §9.2): the token's sv is trusted and the deny-list is skipped until it returns.
  if (state === 'unavailable') return;
  if (state.isDenied) throw new AuthFailure('denied');
  let current = state.sessionVersion;
  if (current === 'miss') {
    const record = await deps.loadSessionVersion(claims);
    if (record === 'not_found' || !record.isActive) throw new AuthFailure('inactive_or_missing');
    current = record.sessionVersion;
  }
  // session_version only grows (users_guard_update): a token above the cache means the cache lags, not a forgery.
  if (claims.sv < current) throw new AuthFailure('stale_session');
}

/**
 * Authenticates the request from its Bearer access token (Figure F04: after the body parser, before rateLimit) and
 * fills req.context for the rate limiter, tenant middleware and logs.
 *
 * `loadSessionVersion` is required (type and runtime check): a cache miss always goes to the database, never to the
 * token's sv. Task 12 supplies it (withTenant + set-if-greater write-back). Only a Redis outage trusts the token's sv.
 */
export function createAuthenticate(deps: AuthenticateDeps): RequestHandler {
  // Also enforced at runtime for callers that bypass the type (casts, plain JS).
  if (typeof deps.loadSessionVersion !== 'function') {
    throw new TypeError('authenticate needs a session version loader');
  }
  const now = deps.now ?? Date.now;
  return async (req, _res, next) => {
    const context = req.context;
    if (context === undefined) {
      next(new TypeError('authenticate runs after assignRequestId'));
      return;
    }
    try {
      const claims = verifyAccessToken(deps.keyring, readBearerToken(req), now());
      await checkSession(deps, req, claims);
      context.userId = claims.sub;
      context.orgId = claims.org;
      context.role = claims.role;
      context.tokenId = claims.jti;
      context.sessionVersion = claims.sv;
      next();
    } catch (error) {
      if (error instanceof AuthFailure || error instanceof TokenError) {
        next(reject(req, error.reason));
        return;
      }
      next(error);
    }
  };
}

/**
 * Route guard on the role claim (L2 §8.3, first of three layers). Fails closed: a request that was not
 * authenticated gets UNAUTHENTICATED, a role outside the list FORBIDDEN.
 */
export function requireRole(...roles: [UserRole, ...UserRole[]]): RequestHandler {
  if (roles.length === 0) throw new TypeError('requireRole needs at least one role');
  const allowed: ReadonlySet<UserRole> = new Set(roles);
  return (req, _res, next) => {
    const role = req.context?.role;
    if (role === undefined) {
      next(unauthenticated());
      return;
    }
    next(allowed.has(role) ? undefined : forbidden());
  };
}
