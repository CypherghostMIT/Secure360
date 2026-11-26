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
  /** QUIT on shutdown (lets pending replies arrive), or a hard disconnect if the connection is not up. */
  close(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

// Bounded: shutdown must never hang on Redis.
function waitForEnd(client: Redis, timeoutMs = CLOSE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
    client.once('end', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createRedisConnection(url: string, logger: Logger): RedisConnection {
  const log = logger.child({ module: 'cache' });
  const client = new Redis(url, LIMITER_REDIS_OPTIONS);
  // ioredis emits 'error' on every reconnect attempt: log the transition once, never the URL (it holds the password).
  let isUp: boolean | undefined;
  let isClosing = false;
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
    close: async () => {
      isClosing = true;
      if (client.status === 'end') return;
      if (client.status === 'ready') {
        try {
          // QUIT resolves on the server's OK, before the socket is gone: wait for 'end' too.
          const ended = waitForEnd(client);
          await client.quit();
          await ended;
          log.info({ mode: 'quit' }, 'redis.connection.closed');
          return;
        } catch {
          // Fall through to a hard disconnect.
        }
      }
      // While reconnecting there is no socket: disconnect() cancels the retry timer and ioredis 6 emits no 'end'.
      const ended = waitForEnd(client);
      client.disconnect();
      await ended;
      log.info({ mode: 'disconnect' }, 'redis.connection.closed');
    },
  };
}
