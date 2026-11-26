import type { Redis } from 'ioredis';
import type { RateLimitPolicy } from './rate-limit-policies';
import { RATE_LIMIT_SCRIPT } from './rate-limit-script';
import type { RateLimitStore } from './rate-limit-store';
import type { RateLimitDecision, WindowMode } from './sliding-window';

export class RedisNotReadyError extends Error {
  override readonly name = 'RedisNotReadyError';
  readonly code = 'REDIS_NOT_READY';
}

function parseReply(reply: unknown): RateLimitDecision {
  if (
    !Array.isArray(reply) ||
    reply.length !== 3 ||
    !reply.every((value) => typeof value === 'number' && Number.isInteger(value))
  ) {
    throw new Error('Unexpected rate-limit script reply');
  }
  const [allowed, remaining, retryAfterMs] = reply as [number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs };
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: Redis) {}

  async apply(
    key: string,
    policy: RateLimitPolicy,
    nowMs: number,
    mode: WindowMode,
  ): Promise<RateLimitDecision> {
    // Fail fast instead of waiting on a reconnect: the limiter then uses the in-process store.
    if (this.client.status !== 'ready') throw new RedisNotReadyError('Redis is not ready');
    // EVAL rather than EVALSHA: Redis caches the compiled script either way, and the ~1.5 kB per call is
    // negligible on a loopback network; it also avoids the NOSCRIPT retry after a Redis restart.
    const reply = await this.client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      key,
      nowMs,
      policy.limit,
      policy.windowSeconds * 1000,
      (policy.blockSeconds ?? 0) * 1000,
      mode === 'consume' ? 1 : 0,
    );
    return parseReply(reply);
  }

  async reset(key: string): Promise<void> {
    if (this.client.status !== 'ready') throw new RedisNotReadyError('Redis is not ready');
    await this.client.del(key);
  }
}
