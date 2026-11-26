import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { RequestIdHeaderSchema } from '@secure360/shared';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * First middleware (Figure F04). Keeps Nginx's $request_id or a client UUID so one id follows an action end to end
 * (L2 §11.1); anything else is replaced and never logged, so a forged header cannot inject text into log lines.
 */
export const assignRequestId: RequestHandler = (req, res, next) => {
  const parsed = RequestIdHeaderSchema.safeParse(req.get(REQUEST_ID_HEADER));
  const requestId = parsed.success ? parsed.data : randomUUID();
  req.context = { requestId };
  res.set(REQUEST_ID_HEADER, requestId);
  next();
};
