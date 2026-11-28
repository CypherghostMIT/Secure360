import { Router } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { ErrorResponseSchema } from '@secure360/shared';
import {
  createRateLimit,
  deviceIdKey,
  emailKey,
  MAX_DEVICE_ID_KEY_LENGTH,
  MAX_EMAIL_KEY_LENGTH,
  type MiddlewarePolicy,
} from '../../src/http/rate-limit';
import { MemoryRateLimitStore } from '../../src/platform/cache/memory-store';
import { hashEmailKey, type RateLimitPolicy } from '../../src/platform/cache/rate-limit-policies';
import type { RateLimitStore } from '../../src/platform/cache/rate-limit-store';
import { keyFor, RateLimiter } from '../../src/platform/cache/rate-limiter';
import { randomKey } from '../helpers/keys';
import { captureLogger } from '../helpers/log-capture';
import { buildTestApp, errorOf } from '../helpers/test-app';

const T0 = 1_800_000_000_000;
const USER_ID = '20000000-0000-4000-8000-0000000000a1';
const policy: MiddlewarePolicy = {
  name: 'test.reject',
  limit: 2,
  windowSeconds: 60,
  onExceed: 'reject',
};
const flagPolicy: MiddlewarePolicy = { ...policy, name: 'test.flag', onExceed: 'flag' };

class SwitchableStore implements RateLimitStore {
  isDown = false;
  readonly inner = new MemoryRateLimitStore();
  apply(...args: Parameters<RateLimitStore['apply']>) {
    if (this.isDown)
      return Promise.reject(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }));
    return this.inner.apply(...args);
  }
  reset(key: string) {
    return this.isDown ? Promise.reject(new Error('down')) : this.inner.reset(key);
  }
}

function setup() {
  const captured = captureLogger();
  const primary = new SwitchableStore();
  const fallback = new MemoryRateLimitStore();
  let now = T0;
  const limiter = new RateLimiter({ primary, fallback, logger: captured.logger, now: () => now });
  return { ...captured, primary, fallback, limiter, tick: (ms: number) => (now += ms) };
}

const allowedSeq = async (limiter: RateLimiter, p: RateLimitPolicy, n: number) => {
  const results: boolean[] = [];
  for (let i = 0; i < n; i += 1) results.push((await limiter.consume(p, USER_ID)).allowed);
  return results;
};

describe('RateLimiter', () => {
  it('limits through the primary store', async () => {
    const { limiter, fallback } = setup();

    expect(await allowedSeq(limiter, policy, 3)).toEqual([true, true, false]);
    expect(fallback.size).toBe(0);
  });

  it('keeps limiting in-process when the primary fails, and warns once', async () => {
    const { limiter, primary, lines } = setup();
    primary.isDown = true;

    expect(await allowedSeq(limiter, policy, 4)).toEqual([true, true, false, false]);
    const warnings = lines().filter((line) => line.msg === 'rate_limit.store.degraded');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 'warn', err: { code: 'ECONNREFUSED' } });
  });

  it('logs the recovery once and goes back to the primary', async () => {
    const { limiter, primary, lines } = setup();
    primary.isDown = true;
    await allowedSeq(limiter, policy, 1);
    primary.isDown = false;
    await allowedSeq(limiter, policy, 2);

    expect(lines().filter((line) => line.msg === 'rate_limit.store.recovered')).toHaveLength(1);
  });

  it('peek does not count', async () => {
    const { limiter } = setup();
    await limiter.peek(policy, USER_ID);
    await limiter.peek(policy, USER_ID);

    expect(await allowedSeq(limiter, policy, 2)).toEqual([true, true]);
  });

  it('reset clears the count', async () => {
    const { limiter } = setup();
    await allowedSeq(limiter, policy, 2);
    await limiter.reset(policy, USER_ID);

    expect(await allowedSeq(limiter, policy, 1)).toEqual([true]);
  });

  it('frees the count when the window passes (fake clock)', async () => {
    const { limiter, tick } = setup();
    await allowedSeq(limiter, policy, 3);
    tick(120_000);

    expect(await allowedSeq(limiter, policy, 1)).toEqual([true]);
  });
});

describe('keyFor', () => {
  it('builds rl:{policy}:{id}', () => {
    expect(keyFor(policy, USER_ID)).toBe(`rl:test.reject:${USER_ID}`);
  });

  it.each(['', 'someone@example.test', 'a b', 'x'.repeat(129), 'id\n'])(
    'refuses identifier %j',
    (id) => {
      expect(() => keyFor(policy, id)).toThrow('Invalid rate-limit identifier');
    },
  );
});

describe('MemoryRateLimitStore', () => {
  it('never holds more than its maximum entries', async () => {
    const store = new MemoryRateLimitStore(3);
    for (let i = 0; i < 10; i += 1) await store.apply(`k${i}`, policy, T0, 'consume');

    expect(store.size).toBe(3);
  });

  it('evicts expired entries before live ones', async () => {
    const store = new MemoryRateLimitStore(2);
    await store.apply('old', policy, T0, 'consume');
    await store.apply('live', policy, T0 + 125_000, 'consume');
    await store.apply('live', policy, T0 + 125_001, 'consume');
    // 'old' has expired (TTL 2 windows); adding a third key must drop it, not 'live'.
    await store.apply('new', policy, T0 + 130_000, 'consume');

    expect((await store.apply('live', policy, T0 + 130_001, 'consume')).allowed).toBe(false);
  });
});

describe('rateLimit middleware', () => {
  function app(p: MiddlewarePolicy, keyFn = (): string | undefined => USER_ID) {
    const { limiter } = setup();
    const rateLimit = createRateLimit(limiter);
    const router = Router();
    const guard = rateLimit(p, keyFn);
    router.post('/v1/things', guard, (req, res) => {
      res.json({ success: true, data: { isRateLimited: req.context?.rateLimited === true } });
    });
    router.get('/health/ready', guard, (_req, res) => {
      res.json({ success: true, data: { status: 'ok' } });
    });
    return buildTestApp([router]);
  }

  it('answers 429 RATE_LIMITED with Retry-After in whole seconds', async () => {
    const { app: server } = app(policy);
    await request(server).post('/v1/things');
    await request(server).post('/v1/things');
    const res = await request(server).post('/v1/things').set('Accept-Language', 'en');

    expect(res.status).toBe(429);
    expect(ErrorResponseSchema.safeParse(res.body).success).toBe(true);
    expect(errorOf(res)).toMatchObject({
      code: 'RATE_LIMITED',
      requestId: res.headers['x-request-id'],
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('flags instead of rejecting for a flag policy', async () => {
    const { app: server } = app(flagPolicy);
    const Flagged = z.object({ data: z.object({ isRateLimited: z.boolean() }) });
    const flags: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      flags.push(Flagged.parse((await request(server).post('/v1/things')).body).data.isRateLimited);
    }

    expect(flags).toEqual([false, false, true]);
  });

  it('never limits health routes', async () => {
    const { app: server } = app(policy);
    const statuses = [];
    for (let i = 0; i < 5; i += 1)
      statuses.push((await request(server).get('/health/ready')).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  it('logs a warning and lets the request through when there is no key', async () => {
    const { app: server, lines } = app(policy, () => undefined);
    const res = await request(server).post('/v1/things');

    expect(res.status).toBe(200);
    expect(lines().find((line) => line.msg === 'rate_limit.key.missing')).toMatchObject({
      level: 'warn',
      policy: 'test.reject',
    });
  });
});

describe('rate-limit key helpers', () => {
  const longEmail = (length: number) => `${'a'.repeat(length - '@x.cm'.length)}@x.cm`;
  const hmacKey = randomKey();

  it('hashes a trimmed e-mail, the same key whatever the surrounding spaces', () => {
    expect(emailKey('  Ada@Example.cm ', hmacKey)).toBe(hashEmailKey('ada@example.cm', hmacKey));
    expect(emailKey('ada@example.cm', hmacKey)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts an e-mail of exactly 254 characters and refuses 255', () => {
    expect(emailKey(longEmail(MAX_EMAIL_KEY_LENGTH), hmacKey)).toBeDefined();
    expect(emailKey(longEmail(MAX_EMAIL_KEY_LENGTH + 1), hmacKey)).toBeUndefined();
  });

  it('trims a device id and caps it at 128 characters', () => {
    expect(deviceIdKey('\tdevice-1 \n')).toBe('device-1');
    expect(deviceIdKey('d'.repeat(MAX_DEVICE_ID_KEY_LENGTH))).toHaveLength(
      MAX_DEVICE_ID_KEY_LENGTH,
    );
    expect(deviceIdKey('d'.repeat(MAX_DEVICE_ID_KEY_LENGTH + 1))).toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an array', ['ada@example.cm']],
    ['an object', { email: 'ada@example.cm' }],
    ['an empty string', ''],
    ['only spaces', '   '],
  ])('gives no key for %s', (_label, value) => {
    expect(emailKey(value, hmacKey)).toBeUndefined();
    expect(deviceIdKey(value)).toBeUndefined();
  });
});
