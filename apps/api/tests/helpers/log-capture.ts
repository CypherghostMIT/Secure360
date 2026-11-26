import { Writable } from 'node:stream';
import type { LogLevel } from '../../src/config';
import { createLogger, type Logger } from '../../src/platform/observability/logger';

export type LogLine = Record<string, unknown> & { level: string; msg?: string };

export interface CapturedLogger {
  readonly logger: Logger;
  /** Parsed JSON lines written so far. */
  readonly lines: () => LogLine[];
  /** Raw output, to assert that a value appears nowhere. */
  readonly raw: () => string;
}

/** The real logger (same redaction and format) writing to memory instead of stdout. */
export function captureLogger(logLevel: LogLevel = 'trace'): CapturedLogger {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = createLogger({ logLevel, nodeEnv: 'test' }, stream);
  const raw = () => chunks.join('');
  return {
    logger,
    raw,
    lines: () =>
      raw()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as LogLine),
  };
}
