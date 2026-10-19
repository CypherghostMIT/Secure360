import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import type { AppConfig } from './config';

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Pino arrives with task 7; until then the entry point writes these few lines to the standard streams.
function writeLine(
  stream: NodeJS.WriteStream,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  stream.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : 'Cannot load configuration';
    writeLine(process.stderr, 'config.load.failure', { message });
    process.exit(1);
  }
}

function registerShutdown(server: Server): void {
  let isShuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    writeLine(process.stdout, 'server.shutdown.start', { signal });
    // Requests in flight get up to 10 s to finish; then remaining sockets are cut and the process exits.
    const timer = setTimeout(() => {
      writeLine(process.stderr, 'server.shutdown.timeout');
      server.closeAllConnections();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close((error) => {
      writeLine(process.stdout, 'server.shutdown.success');
      process.exit(error ? 1 : 0);
    });
    // Idle keep-alive sockets would otherwise hold close() open until the timeout.
    server.closeIdleConnections();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function main(): void {
  const config = loadConfigOrExit();
  const server = createServer(createApp(config));
  server.once('error', (error: NodeJS.ErrnoException) => {
    writeLine(process.stderr, 'server.start.failure', { code: error.code });
    process.exit(1);
  });
  server.listen(config.port, () => {
    writeLine(process.stdout, 'server.start.success', { port: config.port, env: config.nodeEnv });
  });
  registerShutdown(server);
}

main();
