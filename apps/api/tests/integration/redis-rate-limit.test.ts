// Rate limiting against a real Redis 8 (local compose, or the CI service). Uses database 15 and deletes only the
// keys it creates. REDIS_URL comes from the environment (CI) or the repository .env (loaded by the global setup).
import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { createRateLimit, type MiddlewarePolicy } from '../../src/http/rate-limit';
import { MemoryRateLimitStore } from '../../src/platform/cache/memory-store';
import { hashEmailKey, RATE_LIMIT_POLICIES } from '../../src/platform/cache/rate-limit-policies';
import { RATE_LIMIT_SCRIPT } from '../../src/platform/cache/rate-limit-script';
import { RateLimiter } from '../../src/platform/cache/rate-limiter';
import { createRedisConnection, type RedisConnection } from '../../src/platform/cache/redis';
import { RedisRateLimitStore } from '../../src/platform/cache/redis-store';
import { applyWindow, type WindowState } from '../../src/platform/cache/sliding-window';
import { randomKey } from '../helpers/keys';
import { captureLogger } from '../helpers/log-capture';
import { buildTestApp, errorOf } from '../helpers/test-app';

const TEST_DB = '15';
const MINUTE = 60_000;
const T0 = 1_800_000_000_000;

function testRedisUrl(): string {
  const raw = process.env['REDIS_URL'];
  if (!raw) throw new Error('REDIS_URL is not set (see .env.example and npm run dev:secrets).');
  const url = new URL(raw);
  // Never point the suite at a remote Redis: it writes and deletes keys.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('REDIS_URL must point at a local Redis for the integration tests.');
  }
  url.pathname = `/${TEST_DB}`;
  return url.href;
}

// A policy name unique to this run, so keys never collide with another run or real data.
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const testPolicy = (overrides: Partial<MiddlewarePolicy> = {}): MiddlewarePolicy => ({
  name: `it.${runId}`,
  limit: 3,
  windowSeconds: 60,
  onExceed: 'reject',
  ...overrides,
});

let connection: RedisConnection;
let redis: Redis;
const createdKeys = new Set<string>();

beforeAll(async () => {
  connection = createRedisConnection(testRedisUrl(), captureLogger().logger);
  await connection.connect();
  redis = connection.client;
  expect(redis.status).toBe('ready');
});

afterAll(async () => {
  const keys = [...createdKeys, ...(await redis.keys(`rl:it.${runId}*`))];
  if (keys.length > 0) await redis.del(...keys);
  await connection.close();
});

function limiterAt(clock: { now: number }) {
  const captured = captureLogger();
  const fallback = new MemoryRateLimitStore();
  const limiter = new RateLimiter({
    primary: new RedisRateLimitStore(redis),
    fallback,
    logger: captured.logger,
    now: () => clock.now,
  });
  return { ...captured, limiter, fallback };
}

describe('Lua script', () => {
  it('returns integer replies {allowed, remaining, retryAfterMs} under the pinned protocol', async () => {
    const key = `rl:it.${runId}:raw`;
    createdKeys.add(key);
    const reply = await redis.eval(RATE_LIMIT_SCRIPT, 1, key, T0, 3, MINUTE, 0, 1);

    expect(reply).toEqual([1, 2, 0]);
  });

  it('matches applyWindow() decision for decision, across windows and a block', async () => {
    const policy = testPolicy({ name: `it.${runId}.parity`, limit: 4, blockSeconds: 90 });
    const store = new RedisRateLimitStore(redis);
    const key = `rl:${policy.name}:u1`;
    const times = [
      0, 1, 2, 3, 4, 59_999, 60_000, 75_000, 95_000, 130_000, 150_000, 200_000, 260_000,
    ];
    let state: WindowState | undefined;
    for (const offset of times) {
      const now = T0 + offset;
      const expected = applyWindow(state, policy, now, 'consume');
      if (expected.changed) state = expected.state;

      expect(await store.apply(key, policy, now, 'consume')).toEqual(expected.decision);
    }
  });
});

describe('RateLimiter on Redis', () => {
  it('limits, then frees the count when the window passes', async () => {
    const clock = { now: T0 };
    const { limiter, fallback } = limiterAt(clock);
    const policy = testPolicy({ name: `it.${runId}.window` });
    const results: boolean[] = [];
    for (let i = 0; i < 4; i += 1) results.push((await limiter.consume(policy, 'u1')).allowed);
    clock.now += 2 * MINUTE;
    results.push((await limiter.consume(policy, 'u1')).allowed);

    expect(results).toEqual([true, true, true, false, true]);
    expect(fallback.size).toBe(0);
  });

  it('always sets a TTL on the key', async () => {
    const clock = { now: Date.now() };
    const { limiter } = limiterAt(clock);
    const policy = testPolicy({ name: `it.${runId}.ttl` });
    await limiter.consume(policy, 'u1');
    const ttl = await redis.pttl(`rl:${policy.name}:u1`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2 * MINUTE);
  });

  it('stores e-mail identifiers only as an HMAC-SHA256, never the address or its plain SHA-256', async () => {
    const clock = { now: Date.now() };
    const { limiter } = limiterAt(clock);
    const hmacKey = randomKey();
    const email = `Someone.${runId}@Example.test`;
    const key = `rl:password.forgot:${hashEmailKey(email, hmacKey)}`;
    createdKeys.add(key);
    await limiter.consume(RATE_LIMIT_POLICIES.passwordForgot, hashEmailKey(email, hmacKey));
    const plainSha256 = createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex');

    expect(await redis.exists(key)).toBe(1);
    expect(key).toMatch(/^rl:password\.forgot:[0-9a-f]{64}$/);
    const stored = JSON.stringify([key, await redis.hgetall(key)]).toLowerCase();
    expect(stored).not.toContain(`someone.${runId}`);
    expect(stored).not.toContain('example.test');
    expect(stored).not.toContain(plainSha256);
  });
});

describe('rateLimit middleware on Redis', () => {
  it('answers 429 RATE_LIMITED with Retry-After once the limit is reached', async () => {
    const { limiter } = limiterAt({ now: Date.now() });
    const policy = testPolicy({ name: `it.${runId}.http`, limit: 2 });
    const router = Router();
    router.post(
      '/v1/things',
      createRateLimit(limiter)(policy, () => 'u1'),
      (_req, res) => {
        res.json({ success: true, data: null });
      },
    );
    const { app } = buildTestApp([router]);

    const statuses = [];
    for (let i = 0; i < 2; i += 1) statuses.push((await request(app).post('/v1/things')).status);
    const limited = await request(app).post('/v1/things');

    expect(statuses).toEqual([200, 200]);
    expect(limited.status).toBe(429);
    expect(errorOf(limited).code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});

describe('Redis unavailable', () => {
  it('falls back to in-process limits, warns once, and recovers', async () => {
    const own = createRedisConnection(testRedisUrl(), captureLogger().logger);
    await own.connect();
    const captured = captureLogger();
    const clock = { now: Date.now() };
    const limiter = new RateLimiter({
      primary: new RedisRateLimitStore(own.client),
      fallback: new MemoryRateLimitStore(),
      logger: captured.logger,
      now: () => clock.now,
    });
    const policy = testPolicy({ name: `it.${runId}.down`, limit: 2 });
    try {
      // The connection drops (the same path as Redis stopping): commands now fail fast.
      const ended = new Promise((resolve) => own.client.once('end', resolve));
      own.client.disconnect();
      await ended;
      const whileDown: boolean[] = [];
      for (let i = 0; i < 3; i += 1) whileDown.push((await limiter.consume(policy, 'u1')).allowed);

      expect(whileDown).toEqual([true, true, false]);
      const degraded = captured.lines().filter((l) => l.msg === 'rate_limit.store.degraded');
      expect(degraded).toHaveLength(1);
      expect(degraded[0]).toMatchObject({
        level: 'warn',
        module: 'rate-limit',
        err: { code: 'REDIS_NOT_READY' },
      });

      await own.client.connect();
      await limiter.consume(policy, 'u2');
      expect(captured.lines().filter((l) => l.msg === 'rate_limit.store.recovered')).toHaveLength(
        1,
      );
    } finally {
      await own.close();
    }
  });

  it('logs connection state changes once, not per retry, and never the URL', async () => {
    const captured = captureLogger();
    const unreachable = createRedisConnection(
      'redis://:not-a-real-password@127.0.0.1:1/0',
      captured.logger,
    );
    try {
      await unreachable.connect();
      // Several reconnect attempts (200 ms, 400 ms, 600 ms…) happen in this time.
      await new Promise((resolve) => setTimeout(resolve, 1_500));

      const down = captured.lines().filter((l) => l.msg === 'redis.connection.down');
      expect(down).toHaveLength(1);
      expect(down[0]).toMatchObject({
        level: 'warn',
        module: 'cache',
        err: { code: 'ECONNREFUSED' },
      });
      expect(captured.raw()).not.toContain('not-a-real-password');
    } finally {
      await unreachable.close();
    }
  });

  it('logs ready once and closes cleanly with QUIT', async () => {
    const captured = captureLogger();
    const own = createRedisConnection(testRedisUrl(), captured.logger);
    await own.connect();
    await own.close();

    expect(captured.lines().map((l) => l.msg)).toEqual([
      'redis.connection.ready',
      'redis.connection.closed',
    ]);
    expect(captured.lines()[1]).toMatchObject({ mode: 'quit' });
    expect(own.client.status).toBe('end');
  });
});
