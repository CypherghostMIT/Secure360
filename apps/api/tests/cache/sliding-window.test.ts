import { createHash, createHmac, createSecretKey, randomBytes } from 'node:crypto';
import {
  hashEmailKey,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
} from '../../src/platform/cache/rate-limit-policies';
import { applyWindow, type WindowState } from '../../src/platform/cache/sliding-window';
import { randomKey } from '../helpers/keys';

const MINUTE = 60_000;
// Aligned on a window boundary so the arithmetic in the tests is easy to follow.
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % (60 * MINUTE));

const policy = (overrides: Partial<RateLimitPolicy> = {}): RateLimitPolicy => ({
  name: 'test.policy',
  limit: 3,
  windowSeconds: 60,
  onExceed: 'reject',
  ...overrides,
});

/** Runs consumes on a fake clock, carrying the state like a store would. */
function run(p: RateLimitPolicy, times: readonly number[], start?: WindowState) {
  let state = start;
  return times.map((now) => {
    const result = applyWindow(state, p, now, 'consume');
    if (result.changed) state = result.state;
    return result.decision;
  });
}

describe('applyWindow (sliding-window counter)', () => {
  it('allows up to the limit, then rejects', () => {
    const decisions = run(policy(), [T0, T0 + 1, T0 + 2, T0 + 3]);

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('does not count a rejected request, so a retry loop cannot extend the lock forever', () => {
    const p = policy();
    let state: WindowState | undefined;
    for (const now of [T0, T0 + 1, T0 + 2]) state = applyWindow(state, p, now, 'consume').state;
    const rejected = applyWindow(state, p, T0 + 10, 'consume');

    expect(rejected.decision.allowed).toBe(false);
    expect(rejected.changed).toBe(false);
  });

  it('gives a Retry-After that is exactly when the next request passes', () => {
    const p = policy();
    let state: WindowState | undefined;
    for (const now of [T0, T0 + 1, T0 + 2]) state = applyWindow(state, p, now, 'consume').state;

    const { retryAfterMs } = applyWindow(state, p, T0 + 3, 'consume').decision;
    expect(retryAfterMs).toBeGreaterThan(0);
    const justBefore = applyWindow(state, p, T0 + 3 + retryAfterMs - 2, 'peek').decision;
    const at = applyWindow(state, p, T0 + 3 + retryAfterMs, 'peek').decision;
    expect(justBefore.allowed).toBe(false);
    expect(at.allowed).toBe(true);
  });

  it('slides: the previous window counts in proportion to its remaining overlap', () => {
    const p = policy({ limit: 10 });
    // 30 s into the next window, half of the previous 10 still count: 5 more are allowed, not 10.
    const halfway = T0 + MINUTE + 30_000;
    const decisions = run(
      p,
      Array.from({ length: 6 }, () => halfway),
      rebuild(p, 10, T0),
    );

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, true, false]);
  });

  it('forgets everything after two quiet windows', () => {
    const p = policy();
    const state = rebuild(p, 3, T0);

    expect(applyWindow(state, p, T0 + 2 * MINUTE, 'consume').decision).toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });

  it('peek reports without counting', () => {
    const p = policy();
    const result = applyWindow(rebuild(p, 2, T0), p, T0 + 5, 'peek');

    expect(result.decision).toMatchObject({ allowed: true, remaining: 1 });
    expect(result.changed).toBe(false);
  });

  it('always sets a TTL that outlives the window used for the next estimate', () => {
    const p = policy();
    const { ttlMs } = applyWindow(undefined, p, T0 + 10_000, 'consume');

    expect(ttlMs).toBe(2 * MINUTE - 10_000);
  });

  describe('with a block period (login.failed)', () => {
    const login = RATE_LIMIT_POLICIES.loginFailed;
    const FIFTEEN_MIN = 15 * MINUTE;

    it('blocks for 15 minutes from the 5th failure', () => {
      const decisions = run(login, [T0, T0 + 1, T0 + 2, T0 + 3, T0 + 4]);
      expect(decisions.every((d) => d.allowed)).toBe(true);

      let state: WindowState | undefined;
      for (const now of [T0, T0 + 1, T0 + 2, T0 + 3, T0 + 4]) {
        state = applyWindow(state, login, now, 'consume').state;
      }
      const blocked = applyWindow(state, login, T0 + 5, 'peek').decision;
      expect(blocked).toMatchObject({ allowed: false, retryAfterMs: FIFTEEN_MIN - 1 });
      expect(applyWindow(state, login, T0 + 4 + FIFTEEN_MIN - 1, 'peek').decision.allowed).toBe(
        false,
      );
    });

    it('keeps the key alive for the whole block', () => {
      let result = applyWindow(undefined, login, T0, 'consume');
      for (let i = 1; i < 5; i += 1) result = applyWindow(result.state, login, T0 + i, 'consume');

      expect(result.ttlMs).toBeGreaterThanOrEqual(FIFTEEN_MIN);
    });
  });
});

describe('policies (L2 Table 5)', () => {
  it('defines the five application policies', () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      loginFailed: {
        name: 'login.failed',
        limit: 5,
        windowSeconds: 900,
        blockSeconds: 900,
        onExceed: 'lock',
      },
      passwordForgot: { name: 'password.forgot', limit: 3, windowSeconds: 3600, onExceed: 'flag' },
      apiUser: { name: 'api.user', limit: 120, windowSeconds: 60, onExceed: 'reject' },
      incidentCreate: {
        name: 'incident.create',
        limit: 20,
        windowSeconds: 3600,
        onExceed: 'reject',
      },
      clientErrors: { name: 'client.errors', limit: 10, windowSeconds: 60, onExceed: 'flag' },
    });
  });
});

describe('hashEmailKey', () => {
  const keyBytes = randomBytes(32);
  const key = randomKey();
  const hmacOf = (text: string) =>
    createHmac('sha256', keyBytes).update(text, 'utf8').digest('hex');

  it('is HMAC-SHA256 of the trimmed, NFC-normalised, lower-cased address with the server key', () => {
    const expected = hmacOf('amélie@example.test');
    const serverKey = createSecretKey(keyBytes);

    // "e" + combining acute accent (NFD) must give the same key as the precomposed "é".
    expect(hashEmailKey('  Amélie@Example.TEST ', serverKey)).toBe(expected);
    expect(hashEmailKey('amélie@example.test', serverKey)).toBe(expected);
  });

  it('is no longer the plain SHA-256 of the address', () => {
    const plain = createHash('sha256').update('someone@example.test', 'utf8').digest('hex');
    expect(hashEmailKey('someone@example.test', key)).not.toBe(plain);
  });

  it('is stable for the same input and key, and changes with the key', () => {
    expect(hashEmailKey('someone@example.test', key)).toBe(
      hashEmailKey('Someone@example.test', key),
    );
    expect(hashEmailKey('someone@example.test', key)).not.toBe(
      hashEmailKey('someone@example.test', randomKey()),
    );
  });

  it('returns 64 hex characters and no trace of the address', () => {
    const hashed = hashEmailKey('someone@example.test', key);

    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain('someone');
  });
});

/** State as if `count` hits had landed in the window starting at `windowStart`. */
function rebuild(p: RateLimitPolicy, count: number, windowStart: number): WindowState | undefined {
  let state: WindowState | undefined;
  for (let i = 0; i < count; i += 1) {
    state = applyWindow(state, p, windowStart + i, 'consume').state;
  }
  return state;
}
