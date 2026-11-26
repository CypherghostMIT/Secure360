import type { ErrorCode, ValidationIssue } from '@secure360/shared';
import { ERROR_HTTP_STATUS } from '@secure360/shared';

export interface AppErrorOptions {
  readonly details?: readonly ValidationIssue[];
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
}

/**
 * The one error type the API throws on purpose. It carries a shared code only: the HTTP status always comes from
 * ERROR_HTTP_STATUS, never from the call site. No Express import, so services may throw it.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly details?: readonly ValidationIssue[];
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: ErrorCode,
    options: AppErrorOptions = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    if (options.details !== undefined) this.details = options.details;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export const notFound = (): AppError => new AppError('NOT_FOUND');
export const forbidden = (): AppError => new AppError('FORBIDDEN');
export const conflict = (): AppError => new AppError('CONFLICT');
export const unauthenticated = (): AppError => new AppError('UNAUTHENTICATED');

export const validationError = (details: readonly ValidationIssue[]): AppError =>
  new AppError('VALIDATION_ERROR', { details });

/** Retry-After is whole seconds (RFC 9110), rounded up and never 0, so a client never retries immediately. */
export const rateLimited = (seconds: number): AppError =>
  new AppError('RATE_LIMITED', { retryAfterSeconds: Math.max(1, Math.ceil(seconds)) });
