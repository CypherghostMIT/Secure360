import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import type { AppConfig } from './config';
import { createRedisConnection, type RedisConnection } from './platform/cache/redis';
import { createPrismaClient, type DbClient } from './platform/db/prisma-client';
import { createLogger, type Logger } from './platform/observability/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    // No configuration means no LOG_LEVEL yet: a plain JSON logger reports why the process stops.
    const bootstrap = createLogger({ logLevel: 'info', nodeEnv: 'production' });
    const message = error instanceof ConfigError ? error.message : 'Cannot load configuration';
    bootstrap.fatal({ reason: message }, 'config.load.failure');
    process.exit(1);
  }
}

interface Resources {
  readonly redis: RedisConnection;
  readonly db: DbClient;
}

// Both close after the last request, which may still have needed them. allSettled: one failing to close must not
// keep the other open.
async function closeResources({ redis, db }: Resources, log: Logger): Promise<boolean> {
  const [redisResult, dbResult] = await Promise.allSettled([redis.close(), db.$disconnect()]);
  if (dbResult.status === 'fulfilled') log.info('db.disconnect.success');
  else log.error('db.disconnect.failure');
  return redisResult.status === 'fulfilled' && dbResult.status === 'fulfilled';
}

function registerShutdown(server: Server, resources: Resources, log: Logger): void {
  let isShuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info({ signal }, 'server.shutdown.start');
    // Requests in flight get up to 10 s to finish; then remaining sockets are cut and the process exits.
    const timer = setTimeout(() => {
      log.error('server.shutdown.timeout');
      server.closeAllConnections();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close((error) => {
      void closeResources(resources, log).then((isClosed) => {
        const isClean = isClosed && !error;
        log[isClean ? 'info' : 'error'](
          isClean ? 'server.shutdown.success' : 'server.shutdown.failure',
        );
        process.exit(isClean ? 0 : 1);
      });
    });
    // Idle keep-alive sockets would otherwise hold close() open until the timeout.
    server.closeIdleConnections();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function main(): void {
  const config = loadConfigOrExit();
  const logger = createLogger(config);
  const log = logger.child({ module: 'server' });
  // The rate limiter's connection (task 9). Not awaited: while Redis is down the limiter falls back in-process.
  const redis = createRedisConnection(config.redisUrl, logger);
  void redis.connect();
  // Connects lazily on the first query; owned here so shutdown can close it. Repositories receive it in their tasks.
  const db = createPrismaClient(config.databaseUrl);
  const server = createServer(createApp(config, { logger }));
  server.once('error', (error: NodeJS.ErrnoException) => {
    log.fatal({ err: { code: error.code } }, 'server.start.failure');
    process.exit(1);
  });
  server.listen(config.port, () => {
    log.info({ port: config.port, env: config.nodeEnv }, 'server.start.success');
  });
  registerShutdown(server, { redis, db }, log);
}

main();
