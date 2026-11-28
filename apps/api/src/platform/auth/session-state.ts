import type { Logger } from '../observability/logger';
import type { AccessTokenClaims } from './token-claims';

/**
 * Redis keys shared with the writers (L2 §8.2, Table 22). Every writer must build keys with these functions.
 * - sv:{userId}: the users.session_version cache. Written on change (login, password reset or change,
 *   deactivation, role change) with a set-if-greater script, so a slow writer can never lower it.
 * - deny:jti:{jti}: a revoked access token (logout, refresh reuse), value "1", expiring with the token.
 * Both ids are canonical UUIDs (AccessTokenClaimsSchema), so a key can never contain a separator or a pattern.
 */
export const sessionVersionKey = (userId: string): string => `sv:${userId}`;
export const denyListKey = (jti: string): string => `deny:jti:${jti}`;

export interface SessionState {
  /** The cached session version, or 'miss' when the key is absent or holds anything but a positive integer. */
  readonly sessionVersion: number | 'miss';
  readonly isDenied: boolean;
}

/** Session state for one token, or 'unavailable' when Redis does not answer (L2 §9.2: the caller falls back). */
export interface SessionStateReader {
  read(userId: string, jti: string): Promise<SessionState | 'unavailable'>;
}

/** The users row as seen through RLS by its owner: what a cache miss needs to decide. */
export type SessionRecord =
  { readonly sessionVersion: number; readonly isActive: boolean } | 'not_found';

/**
 * Loads the session version on a cache miss. Implemented with the auth module (task 12): reads the caller's own row
 * inside withTenant(claims) and writes it back to sv:{userId} with the set-if-greater script. A failure (database
 * down) is thrown, not hidden.
 */
export type SessionVersionLoader = (claims: AccessTokenClaims) => Promise<SessionRecord>;

/** The one command the reader needs; an ioredis client satisfies it. */
export interface MgetClient {
  mget(...keys: string[]): Promise<(string | null)[]>;
}

const POSITIVE_INT = /^[1-9][0-9]{0,9}$/;

function parseSessionVersion(value: string | null | undefined): number | 'miss' {
  return value !== null && value !== undefined && POSITIVE_INT.test(value) ? Number(value) : 'miss';
}

/**
 * Reads both keys in one round trip on the limiter's fail-fast connection (no offline queue, 500 ms command
 * timeout), so a Redis outage costs a request at most that timeout. Warns once per transition, not per request.
 */
export class RedisSessionStateReader implements SessionStateReader {
  private isDegraded = false;
  private readonly log: Logger;

  constructor(
    private readonly client: MgetClient,
    logger: Logger,
  ) {
    this.log = logger.child({ module: 'auth' });
  }

  async read(userId: string, jti: string): Promise<SessionState | 'unavailable'> {
    let values: (string | null)[];
    try {
      values = await this.client.mget(sessionVersionKey(userId), denyListKey(jti));
    } catch {
      if (!this.isDegraded) {
        this.isDegraded = true;
        this.log.warn('auth.session_state.degraded');
      }
      return 'unavailable';
    }
    if (this.isDegraded) {
      this.isDegraded = false;
      this.log.info('auth.session_state.recovered');
    }
    const [sessionVersion, denied] = values;
    return {
      sessionVersion: parseSessionVersion(sessionVersion),
      isDenied: denied !== null && denied !== undefined,
    };
  }
}
