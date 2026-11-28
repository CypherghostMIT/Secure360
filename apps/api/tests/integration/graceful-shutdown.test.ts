// The real entry point (src/main.api.ts) in a child process: SIGTERM must close the HTTP server, Redis and Prisma,
// then exit 0 well before the 10 s shutdown timeout. Skipped on Windows, where SIGTERM cannot be delivered to a
// Node process as a signal (child.kill() terminates it outright); CI runs it on Linux.
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { readConnectionUrl } from './setup/env';

const API_ROOT = path.resolve(__dirname, '../..');
const START_TIMEOUT_MS = 15_000;
// Comfortably below SHUTDOWN_TIMEOUT_MS (10 s): exiting through the timeout would exit 1 anyway.
const EXIT_TIMEOUT_MS = 5_000;

type LogLine = Record<string, unknown> & { msg?: string };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('No port assigned.'));
      });
    });
  });
}

// Generated per run: no secret value lives in the test source.
function childEnv(port: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'],
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    API_PORT: String(port),
    DATABASE_URL: readConnectionUrl('app'),
    // The CI service or the local compose Redis; an unreachable one still has to close (hard disconnect).
    REDIS_URL: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:1/0',
    JWT_SIGNING_KEYS: `1:${randomBytes(32).toString('base64')}`,
    JWT_ACTIVE_KEY_ID: '1',
    DATA_ENCRYPTION_KEYS: `1:${randomBytes(32).toString('base64')}`,
    DATA_ENCRYPTION_ACTIVE_KEY_ID: '1',
    RATE_LIMIT_HMAC_KEY: randomBytes(32).toString('base64'),
  };
}

/** Collects the child's JSON log lines and resolves `waitFor` once a line with that msg arrives. */
function watchLogs(child: ChildProcess) {
  const lines: LogLine[] = [];
  const waiters = new Map<string, () => void>();
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts.filter((text) => text.trim() !== '')) {
      const line = JSON.parse(part) as LogLine;
      lines.push(line);
      if (line.msg !== undefined) waiters.get(line.msg)?.();
    }
  });
  const waitFor = (msg: string, timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      if (lines.some((line) => line.msg === msg)) return resolve();
      const timer = setTimeout(() => reject(new Error(`No "${msg}" log line.`)), timeoutMs);
      waiters.set(msg, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  return { lines, waitFor };
}

function exitOf(child: ChildProcess, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The API did not exit in time.')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

const describeOnPosix = process.platform === 'win32' ? describe.skip : describe;

describeOnPosix('graceful shutdown (SIGTERM)', () => {
  let child: ChildProcess | undefined;
  let stderr = '';

  afterEach(() => {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  it('closes the server, Redis and Prisma, then exits 0', async () => {
    const port = await freePort();
    child = spawn(process.execPath, ['--import', 'tsx', 'src/main.api.ts'], {
      cwd: API_ROOT,
      env: childEnv(port),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const { lines, waitFor } = watchLogs(child);
    const exited = exitOf(child, START_TIMEOUT_MS + EXIT_TIMEOUT_MS);

    await waitFor('server.start.success', START_TIMEOUT_MS);
    // A served request leaves an idle keep-alive socket, which must not hold the shutdown open.
    const res = await fetch(`http://127.0.0.1:${port}/v1/unknown`);
    expect(res.status).toBe(404);

    const signalledAt = Date.now();
    child.kill('SIGTERM');
    const { code, signal } = await exited;

    // stderr is part of the compared value only so a failure shows why the process died.
    expect({ code, signal, ...(code !== 0 && { stderr }) }).toEqual({ code: 0, signal: null });
    expect(Date.now() - signalledAt).toBeLessThan(EXIT_TIMEOUT_MS);
    const messages = lines.map((line) => line.msg);
    expect(messages).toEqual(
      expect.arrayContaining([
        'server.shutdown.start',
        'redis.connection.closed',
        'db.disconnect.success',
        'server.shutdown.success',
      ]),
    );
    // Resources close only after the server stopped accepting, and success is the last word.
    expect(messages.indexOf('server.shutdown.start')).toBeLessThan(
      messages.indexOf('redis.connection.closed'),
    );
    expect(messages.at(-1)).toBe('server.shutdown.success');
    expect(messages).not.toContain('server.shutdown.timeout');
  });
});
