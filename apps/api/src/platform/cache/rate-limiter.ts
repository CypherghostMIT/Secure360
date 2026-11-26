import type { Logger } from '../observability/logger';
import { serializeError } from '../observability/serialize-error';
import type { RateLimitPolicy } from './rate-limit-policies';
import type { RateLimitStore } from './rate-limit-store';
import type { RateLimitDecision, WindowMode } from './sliding-window';

// Identifiers are user ids, device ids or e-mail hashes: never raw personal data, and safe inside a Redis key.
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

export interface RateLimiterDeps {
  /** Redis store; omitted only in tests that exercise the fallback alone. */
  readonly primary?: RateLimitStore;
  readonly fallback: RateLimitStore;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * Plain-data rate limiter (no Express): the middleware and the login service both use it. Uses Redis while it
 * answers and the bounded in-process store when it does not — never fails closed, never stops limiting, and warns
 * once per transition rather than once per request (L2 §9.2).
 */
export class RateLimiter {
  private isDegraded = false;
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(private readonly deps: RateLimiterDeps) {
    this.log = deps.logger.child({ module: 'rate-limit' });
    this.now = deps.now ?? Date.now;
  }

  consume(policy: RateLimitPolicy, id: string): Promise<RateLimitDecision> {
    return this.apply(policy, id, 'consume');
  }

  peek(policy: RateLimitPolicy, id: string): Promise<RateLimitDecision> {
    return this.apply(policy, id, 'peek');
  }

  /** E.g. after a successful login. Clears both stores so a stale fallback count cannot linger. */
  async reset(policy: RateLimitPolicy, id: string): Promise<void> {
    const key = keyFor(policy, id);
    await this.deps.fallback.reset(key);
    await this.withFallback((store) => store.reset(key));
  }

  private apply(policy: RateLimitPolicy, id: string, mode: WindowMode): Promise<RateLimitDecision> {
    const key = keyFor(policy, id);
    const nowMs = this.now();
    return this.withFallback((store) => store.apply(key, policy, nowMs, mode));
  }

  private async withFallback<T>(operation: (store: RateLimitStore) => Promise<T>): Promise<T> {
    const { primary, fallback } = this.deps;
    if (primary) {
      try {
        const result = await operation(primary);
        if (this.isDegraded) {
          this.isDegraded = false;
          this.log.info('rate_limit.store.recovered');
        }
        return result;
      } catch (error) {
        if (!this.isDegraded) {
          this.isDegraded = true;
          this.log.warn({ err: serializeError(error) }, 'rate_limit.store.degraded');
        }
      }
    }
    return operation(fallback);
  }
}

export function keyFor(policy: RateLimitPolicy, id: string): string {
  if (!IDENTIFIER.test(id)) throw new Error(`Invalid rate-limit identifier for ${policy.name}`);
  return `rl:${policy.name}:${id}`;
}
