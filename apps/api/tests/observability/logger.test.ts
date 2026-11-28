import pino from 'pino';
import { createLogger } from '../../src/platform/observability/logger';
import { serializeError } from '../../src/platform/observability/serialize-error';
import { captureLogger } from '../helpers/log-capture';

const SENSITIVE = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'totp',
  'totpCode',
  'otp',
  'verificationCode',
  'resetCode',
  'secret',
  'body',
  // AppConfig fields holding a secret or a URL with a password.
  'jwtSecret',
  'databaseUrl',
  'migrationDatabaseUrl',
  'redisUrl',
  'testDatabaseAdminUrl',
] as const;

// Recognisable markers, not secrets: the test asserts they never reach the output.
const marker = (key: string) => `MARKER-${key}-VALUE`;

describe('createLogger', () => {
  it('writes one JSON line with a level label and an ISO time', () => {
    const { logger, lines } = captureLogger();
    logger.info({ event: 'x' }, 'server.start.success');

    const [line] = lines();
    expect(line).toMatchObject({ level: 'info', msg: 'server.start.success', event: 'x' });
    expect(new Date(String(line?.['time'])).toISOString()).toBe(line?.['time']);
  });

  it('adds the module to child logger lines', () => {
    const { logger, lines } = captureLogger();
    logger.child({ module: 'cache' }).warn('redis.connection.lost');

    expect(lines()[0]).toMatchObject({ module: 'cache', level: 'warn' });
  });

  it('respects the configured level', () => {
    const { logger, lines } = captureLogger('info');
    logger.debug('hidden');
    logger.info('shown');

    expect(lines().map((line) => line.msg)).toEqual(['shown']);
  });

  it.each(SENSITIVE)('redacts %s at depth 0, 1 and 2', (key) => {
    const { logger, raw } = captureLogger();
    logger.info({ [key]: marker(key) });
    logger.info({ input: { [key]: marker(key) } });
    logger.info({ request: { input: { [key]: marker(key) } } });

    expect(raw()).not.toContain(marker(key));
    expect(raw().match(/\[REDACTED\]/g)).toHaveLength(3);
  });

  it('redacts authorization, cookie and set-cookie headers', () => {
    const { logger, raw } = captureLogger();
    const headers = {
      authorization: marker('authorization'),
      cookie: marker('cookie'),
      'set-cookie': marker('set-cookie'),
    };
    logger.info({ headers });
    logger.info({ res: { headers } });

    expect(raw()).not.toMatch(/MARKER-/);
  });

  it('keeps error codes visible (err.code, error.code, code)', () => {
    const { logger, lines } = captureLogger();
    logger.warn({
      err: { code: 'ECONNREFUSED' },
      error: { code: 'VALIDATION_ERROR' },
      code: 'P2002',
    });

    expect(lines()[0]).toMatchObject({
      err: { code: 'ECONNREFUSED' },
      error: { code: 'VALIDATION_ERROR' },
      code: 'P2002',
    });
  });
});

describe('createLogger stdout stream', () => {
  // An asynchronous stdout loses or reorders the last lines on process.exit (CI: redis.connection.closed after
  // server.shutdown.success).
  it.each(['production', 'test'] as const)('writes synchronously in %s', (nodeEnv) => {
    const logger = createLogger({ logLevel: 'info', nodeEnv });
    const stream = (logger as unknown as Record<symbol, { sync?: boolean }>)[
      pino.symbols.streamSym
    ];

    expect(stream?.sync).toBe(true);
  });
});

describe('serializeError', () => {
  it('keeps type, message, code and stack of an ordinary error', () => {
    const error = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });

    expect(serializeError(error)).toMatchObject({
      type: 'Error',
      message: 'connect failed',
      code: 'ECONNREFUSED',
      stack: expect.stringContaining('connect failed') as unknown,
    });
  });

  it('drops the message of a database error, which can quote row values', () => {
    const value = 'MARKER-row-value';
    const error = Object.assign(new Error(`Invalid invocation: ${value}`), {
      code: 'P2010',
      clientVersion: '7.10.1',
      meta: {
        driverAdapterError: {
          cause: { originalCode: '22P02', originalMessage: `invalid input syntax: "${value}"` },
        },
      },
    });

    const serialized = serializeError(error);

    expect(serialized).toMatchObject({ type: 'Error', code: 'P2010', sqlstate: '22P02' });
    expect(JSON.stringify(serialized)).not.toContain(value);
    expect(serialized.stack).toMatch(/^\s+at /);
  });

  it('describes a non-Error value by its type only', () => {
    expect(serializeError('a string with data')).toEqual({ type: 'string' });
  });
});
