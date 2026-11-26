import { EventEmitter } from 'node:events';
import {
  type ClosableRedis,
  closeRedisClient,
  createRedisConnection,
} from '../../src/platform/cache/redis';
import { captureLogger } from '../helpers/log-capture';

const TIMEOUT_MS = 1_000;

/**
 * Like ioredis: the status changes at once, the matching event comes on a later tick. QUIT resolves on the server's
 * OK, before the socket is gone, so 'end' follows the resolved quit() only after `endAfterQuitMs` (never when null).
 */
class FakeRedis extends EventEmitter {
  status = 'ready';
  readonly order: string[] = [];

  constructor(
    private readonly endAfterQuitMs: number | null,
    private readonly endsOnDisconnect = true,
    private readonly quitFails = false,
  ) {
    super();
  }

  quit = jest.fn(() => {
    if (this.quitFails) return Promise.reject(new Error('Connection is closed.'));
    if (this.endAfterQuitMs !== null) setTimeout(() => this.end(), this.endAfterQuitMs);
    this.order.push('quit.resolved');
    return Promise.resolve('OK' as const);
  });

  disconnect = jest.fn(() => {
    if (this.endsOnDisconnect) setImmediate(() => this.end());
  });

  private end(): void {
    this.status = 'end';
    this.order.push('end');
    this.emit('end');
  }
}

function setup(fake: FakeRedis) {
  const captured = captureLogger();
  const messages = () => captured.lines().map((line) => line.msg);
  let isResolved = false;
  const closed = closeRedisClient(
    fake as unknown as ClosableRedis,
    captured.logger,
    TIMEOUT_MS,
  ).then(() => {
    isResolved = true;
    // Snapshot at resolution: the closed line must already be there.
    fake.order.push(`resolved after [${messages().join(', ')}]`);
  });
  return { captured, closed, isResolved: () => isResolved };
}

describe('closeRedisClient', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for the "end" that follows a resolved QUIT, and logs closed once before resolving', async () => {
    const fake = new FakeRedis(50);
    const { captured, closed, isResolved } = setup(fake);

    await jest.advanceTimersByTimeAsync(49);
    expect(fake.order).toEqual(['quit.resolved']);
    expect(isResolved()).toBe(false);
    expect(captured.lines()).toEqual([]);

    await jest.advanceTimersByTimeAsync(1);
    await closed;
    expect(fake.order).toEqual([
      'quit.resolved',
      'end',
      'resolved after [redis.connection.closed]',
    ]);
    expect(captured.lines()).toHaveLength(1);
    expect(captured.lines()[0]).toMatchObject({ level: 'info', mode: 'quit' });
    expect(fake.disconnect).not.toHaveBeenCalled();
    expect(fake.listenerCount('end')).toBe(0);
  });

  it('falls back to disconnect() when "end" never follows QUIT, and still logs closed once', async () => {
    const fake = new FakeRedis(null);
    const { captured, closed, isResolved } = setup(fake);

    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(isResolved()).toBe(false);
    expect(fake.disconnect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    await jest.runOnlyPendingTimersAsync();
    await closed;
    expect(fake.order).toEqual([
      'quit.resolved',
      'end',
      'resolved after [redis.connection.closed]',
    ]);
    expect(captured.lines()).toHaveLength(1);
    expect(captured.lines()[0]).toMatchObject({ mode: 'disconnect' });
    expect(fake.listenerCount('end')).toBe(0);
  });

  it('resolves after the bounded wait when even disconnect() emits no "end"', async () => {
    const fake = new FakeRedis(null, false);
    const { captured, closed, isResolved } = setup(fake);

    await jest.advanceTimersByTimeAsync(2 * TIMEOUT_MS - 1);
    expect(isResolved()).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await closed;
    expect(fake.order).toEqual(['quit.resolved', 'resolved after [redis.connection.closed]']);
    expect(captured.lines()).toHaveLength(1);
    expect(captured.lines()[0]).toMatchObject({ mode: 'disconnect' });
    expect(fake.listenerCount('end')).toBe(0);
  });

  it('disconnects at once, without waiting for the timeout, when QUIT fails', async () => {
    const fake = new FakeRedis(null, true, true);
    const { captured, closed } = setup(fake);

    await jest.advanceTimersByTimeAsync(0);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    await jest.runOnlyPendingTimersAsync();
    await closed;
    expect(captured.lines().map((line) => line.mode)).toEqual(['disconnect']);
  });

  it('disconnects without QUIT when the connection is not up', async () => {
    const fake = new FakeRedis(null);
    fake.status = 'reconnecting';
    const { captured, closed } = setup(fake);

    await jest.runOnlyPendingTimersAsync();
    await closed;
    expect(fake.quit).not.toHaveBeenCalled();
    expect(fake.order).toEqual(['end', 'resolved after [redis.connection.closed]']);
    expect(captured.lines().map((line) => line.mode)).toEqual(['disconnect']);
  });

  it('does nothing when the client has already ended', async () => {
    const fake = new FakeRedis(null);
    fake.status = 'end';
    const { captured, closed } = setup(fake);

    await closed;
    expect(fake.quit).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
    expect(captured.lines()).toEqual([]);
  });
});

describe('createRedisConnection close()', () => {
  it('closes once when called twice: one disconnect, one closed line', async () => {
    const captured = captureLogger();
    // lazyConnect and never connected: status 'wait', so no server is needed.
    const connection = createRedisConnection('redis://127.0.0.1:1/0', captured.logger);
    const disconnect = jest.spyOn(connection.client, 'disconnect');

    const first = connection.close();
    expect(connection.close()).toBe(first);
    await first;

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(connection.client.status).toBe('end');
    expect(captured.lines().map((line) => line.msg)).toEqual(['redis.connection.closed']);
  });
});
