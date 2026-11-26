import type { ErrorRequestHandler, Request } from 'express';
import { ERROR_HTTP_STATUS } from '@secure360/shared';
import type { Logger } from '../platform/observability/logger';
import { routeOf } from '../platform/observability/request-logger';
import { serializeError } from '../platform/observability/serialize-error';
import { classifyError, type ErrorClassification } from './classify-error';
import { toErrorEnvelope } from './error-envelope';

function logFailure(
  log: Logger,
  req: Request,
  classification: ErrorClassification,
  error: unknown,
): void {
  const fields = {
    // Without the route a warn-level failure (statement timeout, guard trigger) cannot be traced to its endpoint.
    route: routeOf(req),
    reason: classification.reason,
    error_code: classification.code,
    ...(classification.dbMessage !== undefined && { db_message: classification.dbMessage }),
    // Stack and codes only for failures someone must investigate; the serializer drops database text.
    ...(classification.level === 'error' && { err: serializeError(error) }),
  };
  log[classification.level](fields, 'http.request.failed');
}

/**
 * Last middleware. Every failure leaves as the shared JSON envelope with a generic localized message and the
 * request id — never a stack, SQL, Prisma text or file path, in any environment.
 */
export function createErrorHandler(fallbackLogger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    // Too late for an envelope: Express closes the connection.
    if (res.headersSent) {
      next(error);
      return;
    }
    const classification = classifyError(error);
    logFailure(req.log ?? fallbackLogger, req, classification, error);
    if (classification.retryAfterSeconds !== undefined) {
      res.set('Retry-After', String(classification.retryAfterSeconds));
    }
    res.status(ERROR_HTTP_STATUS[classification.code]).json(
      toErrorEnvelope(classification.code, req.get('accept-language'), {
        requestId: req.context?.requestId,
        details: classification.details,
      }),
    );
  };
}
