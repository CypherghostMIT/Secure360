import type { ErrorCode, ValidationIssue } from '@secure360/shared';
import { ZodError } from 'zod';
import { DecryptionError } from '../platform/crypto/aes-gcm';
import { readDbError } from '../platform/db/db-error';
import { AppError } from './app-error';
import { classifyDbError, type LogLevel } from './classify-db-error';

export interface ErrorClassification {
  readonly code: ErrorCode;
  readonly level: LogLevel;
  readonly reason: string;
  readonly details?: readonly ValidationIssue[];
  readonly retryAfterSeconds?: number;
  readonly dbMessage?: string;
}

// body-parser error `type` values (body-parser 2, used by express.json).
const BODY_PARSER_CODES: Readonly<Record<string, ErrorCode>> = {
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'entity.parse.failed': 'VALIDATION_ERROR',
  'request.size.invalid': 'VALIDATION_ERROR',
  'request.aborted': 'VALIDATION_ERROR',
  'charset.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
  'encoding.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
};

function bodyParserType(error: unknown): string | undefined {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && Object.hasOwn(BODY_PARSER_CODES, type) ? type : undefined;
}

// Location and kind only: never the received value (L2 Table 7).
function toValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
  }));
}

function classifyAppError(error: AppError): ErrorClassification {
  return {
    code: error.code,
    level: error.status >= 500 ? 'error' : 'info',
    reason: 'app_error',
    ...(error.details !== undefined && { details: error.details }),
    ...(error.retryAfterSeconds !== undefined && { retryAfterSeconds: error.retryAfterSeconds }),
  };
}

/** Decides the shared code, log level and log reason for anything that reaches the error handler. */
export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof AppError) return classifyAppError(error);
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      level: 'info',
      reason: 'validation',
      details: toValidationIssues(error),
    };
  }
  const parserType = bodyParserType(error);
  if (parserType !== undefined) {
    // An aborted upload has no one left to answer: debug only.
    const level = parserType === 'request.aborted' ? 'debug' : 'info';
    return { code: BODY_PARSER_CODES[parserType] ?? 'INTERNAL_ERROR', level, reason: parserType };
  }
  // The failure reason goes to the log only; the client gets the generic INTERNAL_ERROR like any other bug.
  if (error instanceof DecryptionError) {
    return { code: 'INTERNAL_ERROR', level: 'error', reason: `decryption.${error.reason}` };
  }
  const db = readDbError(error);
  if (db) return classifyDbError(db);
  return { code: 'INTERNAL_ERROR', level: 'error', reason: 'unexpected' };
}
