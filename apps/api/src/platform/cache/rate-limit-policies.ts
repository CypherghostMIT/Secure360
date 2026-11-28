import { createHmac, type KeyObject } from 'node:crypto';

/**
 * What happens when a policy is exceeded:
 * - reject: 429 RATE_LIMITED + Retry-After (rateLimit() middleware).
 * - flag:   no 429; req.context.rateLimited is set and the route sends its usual generic response without doing
 *           the work (no account enumeration on password.forgot; client error reports dropped silently).
 * - lock:   enforced by the login service itself (peek before checking the password, consume on failure), which
 *           also writes the audit event. Not usable as middleware.
 */
export type RateLimitOutcome = 'reject' | 'flag' | 'lock';

export interface RateLimitPolicy {
  /** Redis key segment: rl:{name}:{id}. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** Once the limit is reached, refuse everything for this long (account lock). */
  readonly blockSeconds?: number;
  readonly onExceed: RateLimitOutcome;
}

/**
 * Application rate limits (L2 §4.3, Table 5). Per-IP limits are Nginx's job only: carrier-grade NAT in Cameroon puts
 * many subscribers behind one address, so the application limits per account, user or device. Each route's own task
 * mounts its policy; api.user goes after authenticate (Figure F04).
 */
export const RATE_LIMIT_POLICIES = {
  loginFailed: {
    name: 'login.failed',
    limit: 5,
    windowSeconds: 15 * 60,
    blockSeconds: 15 * 60,
    onExceed: 'lock',
  },
  passwordForgot: { name: 'password.forgot', limit: 3, windowSeconds: 60 * 60, onExceed: 'flag' },
  apiUser: { name: 'api.user', limit: 120, windowSeconds: 60, onExceed: 'reject' },
  incidentCreate: {
    name: 'incident.create',
    limit: 20,
    windowSeconds: 60 * 60,
    onExceed: 'reject',
  },
  clientErrors: { name: 'client.errors', limit: 10, windowSeconds: 60, onExceed: 'flag' },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Rate-limit identifier for an e-mail address, so no personal data is stored in Redis (BNF16, OWASP M6). Keyed
 * (HMAC-SHA256 with RATE_LIMIT_HMAC_KEY): an unkeyed hash could be reversed by hashing known addresses.
 * Rotating RATE_LIMIT_HMAC_KEY only changes every key, which resets the rate-limit windows; that is accepted.
 */
export function hashEmailKey(email: string, key: KeyObject): string {
  const normalized = email.trim().normalize('NFC').toLowerCase();
  return createHmac('sha256', key).update(normalized, 'utf8').digest('hex');
}
