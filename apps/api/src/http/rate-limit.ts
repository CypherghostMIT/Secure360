import type { Request, RequestHandler } from 'express';
import { hashEmailKey, type RateLimitPolicy } from '../platform/cache/rate-limit-policies';
import type { RateLimiter } from '../platform/cache/rate-limiter';
import { isHealthPath } from '../platform/observability/health-path';
import { rateLimited } from './app-error';

/** Policies a route can mount; login.failed ('lock') is enforced by the login service instead. */
export type MiddlewarePolicy = RateLimitPolicy & { readonly onExceed: 'reject' | 'flag' };

/**
 * Returns the identifier to limit on (user id, emailKey(...), deviceIdKey(...)), or undefined when the request has
 * none. A route may only mount a policy whose key field is REQUIRED in its Zod schema: "no key" lets the request
 * through to that validator, which must then reject it (BUILD_CHECKLIST, task 9).
 */
export type RateLimitKeyFn = (req: Request) => string | undefined;

// RFC 5321 path limit; the longest device id we accept from a client.
export const MAX_EMAIL_KEY_LENGTH = 254;
export const MAX_DEVICE_ID_KEY_LENGTH = 128;

// The body is still unvalidated here (rateLimit runs before validate): anything but a short non-empty string is
// "no key", so an array, object or megabyte string can neither spread one client over many keys nor bloat Redis.
function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= maxLength ? trimmed : undefined;
}

/** Key for an e-mail taken from an unvalidated body (password.forgot); hashed, never stored as is. */
export function emailKey(value: unknown): string | undefined {
  const email = boundedString(value, MAX_EMAIL_KEY_LENGTH);
  return email === undefined ? undefined : hashEmailKey(email);
}

/** Key for a device id taken from an unvalidated body or header (client.errors). */
export function deviceIdKey(value: unknown): string | undefined {
  return boundedString(value, MAX_DEVICE_ID_KEY_LENGTH);
}

const pathOf = (req: Request): string => req.originalUrl.split('?')[0] ?? '';

/**
 * Binds the factory to the process's limiter: `const rateLimit = createRateLimit(limiter)`, then each route's task
 * mounts `rateLimit(RATE_LIMIT_POLICIES.apiUser, (req) => req.context?.userId)` at its place in Figure F04.
 */
export function createRateLimit(limiter: RateLimiter) {
  return function rateLimit(policy: MiddlewarePolicy, keyFn: RateLimitKeyFn): RequestHandler {
    return async (req, _res, next) => {
      // Health probes are never limited: a throttled probe would take a healthy replica out of rotation.
      if (isHealthPath(pathOf(req))) return next();
      const id = keyFn(req);
      if (id === undefined) {
        // Passing is safe only because the route's validator requires the key field and rejects the request.
        req.log?.warn({ policy: policy.name }, 'rate_limit.key.missing');
        return next();
      }
      const decision = await limiter.consume(policy, id);
      if (decision.allowed) return next();
      req.log?.info({ policy: policy.name }, 'rate_limit.exceeded');
      if (policy.onExceed === 'flag') {
        if (req.context) req.context.rateLimited = true;
        return next();
      }
      return next(rateLimited(decision.retryAfterMs / 1000));
    };
  };
}
