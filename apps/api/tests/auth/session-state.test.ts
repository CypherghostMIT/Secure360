import { randomUUID } from 'node:crypto';
import { RedisSessionStateReader } from '../../src/platform/auth/session-state';
import { captureLogger } from '../helpers/log-capture';

// The real Redis path is covered by tests/integration/redis-session-state.test.ts.
function fakeClient(replies: (() => Promise<(string | null)[]>)[]) {
  const mget = jest.fn((..._keys: string[]) => {
    const next = replies.shift();
    if (next === undefined) throw new Error('unexpected call');
    return next();
  });
  return { mget };
}

describe('RedisSessionStateReader', () => {
  it('asks for sv:{userId} and deny:jti:{jti} in one MGET', async () => {
    const client = fakeClient([() => Promise.resolve(['7', null])]);
    const userId = randomUUID();
    const jti = randomUUID();

    const state = await new RedisSessionStateReader(client, captureLogger().logger).read(
      userId,
      jti,
    );

    expect(client.mget).toHaveBeenCalledWith(`sv:${userId}`, `deny:jti:${jti}`);
    expect(state).toEqual({ sessionVersion: 7, isDenied: false });
  });

  it.each(['0', '-1', '1.5', ' 2', '1e3', '99999999999', ''])(
    'treats the cached value %p as a miss',
    async (value) => {
      const client = fakeClient([() => Promise.resolve([value, null])]);
      const state = await new RedisSessionStateReader(client, captureLogger().logger).read(
        randomUUID(),
        randomUUID(),
      );
      expect(state).toEqual({ sessionVersion: 'miss', isDenied: false });
    },
  );

  it('logs one warning when Redis fails and one info line when it recovers', async () => {
    const failure = () => Promise.reject(new Error('Connection is closed.'));
    const client = fakeClient([failure, failure, () => Promise.resolve([null, '1'])]);
    const { logger, lines } = captureLogger();
    const reader = new RedisSessionStateReader(client, logger);

    expect(await reader.read(randomUUID(), randomUUID())).toBe('unavailable');
    expect(await reader.read(randomUUID(), randomUUID())).toBe('unavailable');
    expect(await reader.read(randomUUID(), randomUUID())).toEqual({
      sessionVersion: 'miss',
      isDenied: true,
    });
    expect(lines().map((line) => [line.level, line.msg])).toEqual([
      ['warn', 'auth.session_state.degraded'],
      ['info', 'auth.session_state.recovered'],
    ]);
    // The Redis error text never reaches the log.
    expect(JSON.stringify(lines())).not.toContain('Connection is closed');
  });
});
