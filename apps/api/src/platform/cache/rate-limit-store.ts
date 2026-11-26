import type { RateLimitPolicy } from './rate-limit-policies';
import type { RateLimitDecision, WindowMode } from './sliding-window';

/** Where rate-limit state lives: Redis, or the in-process fallback while Redis is unavailable (L2 §9.2). */
export interface RateLimitStore {
  apply(
    key: string,
    policy: RateLimitPolicy,
    nowMs: number,
    mode: WindowMode,
  ): Promise<RateLimitDecision>;
  reset(key: string): Promise<void>;
}
