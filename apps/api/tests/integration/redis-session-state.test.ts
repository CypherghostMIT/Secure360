// Session-version cache and deny-list reads against a real Redis 8 (local compose, or the CI service). Uses database
// 15 and deletes only the keys it creates (random UUIDs, so no collision with another run).
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  denyListKey,
  RedisSessionStateReader,
  sessionVersionKey,
} from '../../src/platform/auth/session-state';
import { createRedisConnection, type RedisConnection } from '../../src/platform/cache/redis';
import { captureLogger } from '../helpers/log-capture';

const TEST_DB = '15';

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

let connection: RedisConnection;
let redis: Redis;
const createdKeys = new Set<string>();

async function setKey(key: string, value: string): Promise<void> {
  createdKeys.add(key);
  await redis.set(key, value, 'EX', 60);
}

beforeAll(async () => {
  connection = createRedisConnection(testRedisUrl(), captureLogger().logger);
  await connection.connect();
  redis = connection.client;
  expect(redis.status).toBe('ready');
});

afterAll(async () => {
  if (createdKeys.size > 0) await redis.del(...createdKeys);
  await connection.close();
});

describe('RedisSessionStateReader (real Redis)', () => {
  it('reads the cached session version and the deny-list in one call', async () => {
    const userId = randomUUID();
    const jti = randomUUID();
    await setKey(sessionVersionKey(userId), '4');
    await setKey(denyListKey(jti), '1');
    const reader = new RedisSessionStateReader(redis, captureLogger().logger);

    expect(await reader.read(userId, jti)).toEqual({ sessionVersion: 4, isDenied: true });
    expect(await reader.read(userId, randomUUID())).toEqual({ sessionVersion: 4, isDenied: false });
  });

  it('uses the documented key formats', () => {
    const id = randomUUID();
    expect(sessionVersionKey(id)).toBe(`sv:${id}`);
    expect(denyListKey(id)).toBe(`deny:jti:${id}`);
  });

  it('reports a miss for an absent or malformed session version', async () => {
    const reader = new RedisSessionStateReader(redis, captureLogger().logger);
    const malformed = randomUUID();
    await setKey(sessionVersionKey(malformed), 'not-a-number');

    expect(await reader.read(randomUUID(), randomUUID())).toEqual({
      sessionVersion: 'miss',
      isDenied: false,
    });
    expect(await reader.read(malformed, randomUUID())).toEqual({
      sessionVersion: 'miss',
      isDenied: false,
    });
  });

  it('answers unavailable without waiting when Redis is unreachable, and warns once', async () => {
    const captured = captureLogger();
    const unreachable = createRedisConnection(
      'redis://:not-a-real-password@127.0.0.1:1/0',
      captured.logger,
    );
    try {
      await unreachable.connect();
      const reader = new RedisSessionStateReader(unreachable.client, captured.logger);
      const started = Date.now();

      expect(await reader.read(randomUUID(), randomUUID())).toBe('unavailable');
      expect(await reader.read(randomUUID(), randomUUID())).toBe('unavailable');
      expect(Date.now() - started).toBeLessThan(2_000);
      const degraded = captured.lines().filter((l) => l.msg === 'auth.session_state.degraded');
      expect(degraded).toHaveLength(1);
    } finally {
      await unreachable.close();
    }
  });
});
