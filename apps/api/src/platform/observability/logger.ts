import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import type { AppConfig } from '../../config';

export type { Logger };

// L2 §11.1. Bare `code` is deliberately absent: it would also hide error codes (err.code, ECONNREFUSED,
// VALIDATION_ERROR). One-time codes use the specific names below.
const SENSITIVE_KEYS = [
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
  // Message bodies (CreateMessageInputSchema.body).
  'body',
] as const;

const SENSITIVE_HEADERS = ['authorization', 'cookie', '["set-cookie"]'] as const;

// Pino's redaction has no recursive wildcard: keys are covered at depth 0 to 2. Request bodies and raw errors are
// never handed to the logger in the first place (see serializeError), so deeper nesting is not expected.
function buildRedactPaths(): string[] {
  const keyPaths = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);
  const headerPaths = SENSITIVE_HEADERS.flatMap((header) => {
    const access = header.startsWith('[') ? header : `.${header}`;
    return [`headers${access}`, `*.headers${access}`];
  });
  return [...keyPaths, ...headerPaths];
}

export const REDACT_PATHS: readonly string[] = buildRedactPaths();

export type LoggerOptions = Pick<AppConfig, 'logLevel' | 'nodeEnv'>;

/**
 * Root logger: JSON on stdout, one line per event (L2 §11.1). Modules use logger.child({ module }).
 * `destination` is for tests; without it, development output goes through pino-pretty, a devDependency that is
 * only resolved in development and so never required by the production image.
 *
 * stdout is written synchronously. Pino's default stdout stream is asynchronous: on process.exit its flush writes
 * the buffered lines while an earlier write may still be in flight, so the last lines (shutdown, fatal errors)
 * could land out of order or be lost.
 */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  const usePretty = options.nodeEnv === 'development' && destination === undefined;
  const stream = destination ?? (usePretty ? undefined : pino.destination({ dest: 1, sync: true }));
  return pino(
    {
      level: options.logLevel,
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      ...(usePretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
    stream,
  );
}
