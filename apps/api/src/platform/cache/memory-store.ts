import type { RateLimitPolicy } from './rate-limit-policies';
import type { RateLimitStore } from './rate-limit-store';
import {
  applyWindow,
  type RateLimitDecision,
  type WindowMode,
  type WindowState,
} from './sliding-window';

export const DEFAULT_MAX_ENTRIES = 10_000;

interface Entry {
  readonly state: WindowState;
  readonly expiresAt: number;
}

/**
 * In-process fallback with a fixed maximum size, so an outage under heavy traffic cannot exhaust memory. When full,
 * expired entries go first, then the least recently written. Limits are per replica while it is in use (two
 * replicas: up to twice the configured limit), which L2 §9.2 accepts for the duration of a Redis outage.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get size(): number {
    return this.entries.size;
  }

  apply(
    key: string,
    policy: RateLimitPolicy,
    nowMs: number,
    mode: WindowMode,
  ): Promise<RateLimitDecision> {
    const entry = this.entries.get(key);
    const stored = entry && entry.expiresAt > nowMs ? entry.state : undefined;
    const result = applyWindow(stored, policy, nowMs, mode);
    if (result.changed) {
      // Delete then set moves the key to the end of the Map's insertion order (most recently written).
      this.entries.delete(key);
      this.makeRoom(nowMs);
      this.entries.set(key, { state: result.state, expiresAt: nowMs + result.ttlMs });
    }
    return Promise.resolve(result.decision);
  }

  reset(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  private makeRoom(nowMs: number): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= nowMs) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
