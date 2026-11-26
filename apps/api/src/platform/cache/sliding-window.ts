import type { RateLimitPolicy } from './rate-limit-policies';

/**
 * Sliding-window counter: two fixed windows, the previous one weighted by how much of it still overlaps the
 * sliding window. Chosen over GCRA because Table 5 is written as "N per window" and login.failed is a failure count
 * followed by a lock, which a counter plus a blocked-until mark expresses directly; the approximation error is
 * bounded by the previous window's weight. State is four numbers, so Redis keeps it in one small hash.
 *
 * The same arithmetic, in the same order, runs in Lua (rate-limit-script.ts) and is compared by the integration
 * test, so the in-process fallback behaves exactly like Redis.
 */
export interface WindowState {
  readonly windowStart: number;
  readonly current: number;
  readonly previous: number;
  readonly blockedUntil: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** 0 when allowed; otherwise milliseconds until the next request would pass (at least 1). */
  readonly retryAfterMs: number;
}

export type WindowMode = 'consume' | 'peek';

export interface WindowResult {
  readonly state: WindowState;
  readonly decision: RateLimitDecision;
  /** True when the state must be written back (an allowed consume). */
  readonly changed: boolean;
  /** How long the stored state stays useful: the next window's estimate still reads it, and any block. */
  readonly ttlMs: number;
}

function roll(state: WindowState | undefined, bucket: number, windowMs: number): WindowState {
  const blockedUntil = state?.blockedUntil ?? 0;
  if (state?.windowStart === bucket) return state;
  if (state?.windowStart === bucket - windowMs) {
    return { windowStart: bucket, current: 0, previous: state.current, blockedUntil };
  }
  return { windowStart: bucket, current: 0, previous: 0, blockedUntil };
}

// Earliest time at which the estimate drops back under the limit, assuming no further hits.
function retryAfter(s: WindowState, limit: number, windowMs: number, nowMs: number): number {
  if (s.blockedUntil > nowMs) return s.blockedUntil - nowMs;
  const at =
    s.current < limit
      ? s.windowStart + windowMs * (1 - (limit - s.current) / s.previous) - nowMs + 1
      : s.windowStart + windowMs + windowMs * (1 - limit / s.current) - nowMs + 1;
  return Math.max(1, Math.ceil(at));
}

export function applyWindow(
  stored: WindowState | undefined,
  policy: RateLimitPolicy,
  nowMs: number,
  mode: WindowMode,
): WindowResult {
  const windowMs = policy.windowSeconds * 1000;
  const bucket = nowMs - (nowMs % windowMs);
  const s = roll(stored, bucket, windowMs);
  let estimate = (s.previous * (windowMs - (nowMs - bucket))) / windowMs + s.current;
  const allowed = s.blockedUntil <= nowMs && estimate < policy.limit;
  let state = s;
  if (allowed && mode === 'consume') {
    estimate += 1;
    const blockMs = (policy.blockSeconds ?? 0) * 1000;
    const blockedUntil = blockMs > 0 && estimate >= policy.limit ? nowMs + blockMs : s.blockedUntil;
    state = { ...s, current: s.current + 1, blockedUntil };
  }
  return {
    state,
    changed: allowed && mode === 'consume',
    ttlMs: Math.ceil(Math.max(bucket + 2 * windowMs - nowMs, state.blockedUntil - nowMs)),
    decision: {
      allowed,
      remaining: Math.max(0, Math.floor(policy.limit - estimate)),
      retryAfterMs: allowed ? 0 : retryAfter(s, policy.limit, windowMs, nowMs),
    },
  };
}
