import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { Logger } from '../observability/logger';

const CONNECT_TIMEOUT_MS = 2_000;
// A limiter check must not hold a request: past this, the in-process fallback answers.
const COMMAND_TIMEOUT_MS = 500;
const RECONNECT_STEP_MS = 200;
const RECONNECT_MAX_MS = 5_000;
const CLOSE_TIMEOUT_MS = 1_000;

/**
 * Options for the request-path connection used by the rate limiter: commands fail fast while Redis is down
 * (no offline queue, one retry) and the caller falls back. BullMQ needs different options
 * (maxRetriesPerRequest: null) and gets its own connection in its task; Pub/Sub is task 26.
 */
export const LIMITER_REDIS_OPTIONS = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: CONNECT_TIMEOUT_MS,
  commandTimeout: COMMAND_TIMEOUT_MS,
  // ioredis 6 defaults to RESP3. RESP2 is pinned so script replies keep the long-documented Lua → RESP2 conversion
  // (the integration test checks the reply shape).
  protocol: 2,
  // Reconnect forever with a capped backoff: 200 ms, 400 ms, … up to 5 s.
  retryStrategy: (attempt: number) => Math.min(attempt * RECONNECT_STEP_MS, RECONNECT_MAX_MS),
} as const satisfies RedisOptions;

export interface RedisConnection {
  readonly client: Redis;
  /** Starts connecting. Never throws: while Redis is down, the limiter uses its fallback. */
  connect(): Promise<void>;
  /** QUIT on shutdown (lets pending replies arrive), or a hard disconnect; resolves once the client has ended. */
  close(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** What closing needs from an ioredis client: a seam so the unit tests can drive the event order. */
export type ClosableRedis = Pick<
  Redis,
  'status' | 'quit' | 'disconnect' | 'once' | 'removeListener'
>;

// Resolves true on 'end', false after the timeout: shutdown must never hang on Redis.
function waitForEnd(client: ClosableRedis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'end') return Promise.resolve(true);
  return new Promise((resolve) => {
    const onEnd = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      client.removeListener('end', onEnd);
      resolve(false);
    }, timeoutMs);
    timer.unref();
    client.once('end', onEnd);
  });
}

// QUIT resolves on the server's OK, before the socket is gone: only 'end' counts as closed. A failed QUIT ends the
// wait early.
function quitAndWait(client: ClosableRedis, timeoutMs: number): Promise<boolean> {
  const ended = waitForEnd(client, timeoutMs);
  const quit = client.quit().then(
    () => ended,
    () => false,
  );
  return Promise.race([ended, quit]);
}

/**
 * Closes the client and resolves only once it has ended (or the bounded waits ran out), after logging
 * redis.connection.closed exactly once: QUIT when the connection is up, else, or if QUIT does not end it in time,
 * a hard disconnect.
 */
export async function closeRedisClient(
  client: ClosableRedis,
  log: Logger,
  timeoutMs = CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (client.status === 'end') return;
  if (client.status === 'ready' && (await quitAndWait(client, timeoutMs))) {
    log.info({ mode: 'quit' }, 'redis.connection.closed');
    return;
  }
  // While reconnecting there is no socket: disconnect() cancels the retry timer and ioredis 6 emits no 'end'.
  const ended = waitForEnd(client, timeoutMs);
  client.disconnect();
  await ended;
  log.info({ mode: 'disconnect' }, 'redis.connection.closed');
}

export function createRedisConnection(url: string, logger: Logger): RedisConnection {
  const log = logger.child({ module: 'cache' });
  const client = new Redis(url, LIMITER_REDIS_OPTIONS);
  // ioredis emits 'error' on every reconnect attempt: log the transition once, never the URL (it holds the password).
  let isUp: boolean | undefined;
  let isClosing = false;
  let closing: Promise<void> | undefined;
  const markDown = (code?: string) => {
    if (isClosing || isUp === false) return;
    isUp = false;
    log.warn({ err: { code } }, 'redis.connection.down');
  };
  client.on('ready', () => {
    if (isUp === true) return;
    isUp = true;
    log.info('redis.connection.ready');
  });
  client.on('error', (error: unknown) => markDown(errorCode(error)));
  client.on('close', () => markDown());

  return {
    client,
    connect: async () => {
      try {
        await client.connect();
      } catch {
        // Already logged by the 'error' handler; reconnection continues in the background.
      }
    },
    // Memoized: a second call waits for the same close instead of logging it again.
    close: () => {
      isClosing = true;
      closing ??= closeRedisClient(client, log);
      return closing;
    },
  };
}
