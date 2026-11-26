import type { Request, RequestHandler } from 'express';
import { isHealthPath } from './health-path';
import type { Logger } from './logger';

// Long enough for any real route; an unmatched scanner path cannot bloat a log line.
const MAX_ROUTE_LENGTH = 200;

const segments = (path: string): string[] => path.split('/').filter((part) => part !== '');

// The matched pattern (/v1/incidents/:id) keeps ids out of the route field; unmatched requests fall back to the
// path. Never the query string, which may carry an e-mail or a token.
export function routeOf(req: Request): string {
  // originalUrl is the full path whatever router the request is in; req.path is relative to the mount point.
  const fullPath = req.originalUrl.split('?')[0] ?? '';
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof pattern !== 'string') return fullPath.slice(0, MAX_ROUTE_LENGTH);
  // When an error leaves a nested router, Express restores req.baseUrl before the response finishes, so the
  // mount prefix is missing: take it back from the actual path (it has one segment per pattern segment).
  const matched = segments(`${req.baseUrl}${pattern}`);
  const actual = segments(fullPath);
  const missing =
    actual.length > matched.length ? actual.slice(0, actual.length - matched.length) : [];
  return `/${[...missing, ...matched].join('/')}`.slice(0, MAX_ROUTE_LENGTH);
}

function levelFor(status: number, route: string): 'debug' | 'info' | 'error' {
  if (status >= 500) return 'error';
  return isHealthPath(route) ? 'debug' : 'info';
}

/**
 * One line per completed request (L2 §11.1): request_id, user_id (id only, when authenticated), method, route,
 * status, duration_ms. No user agent and no IP: client addresses belong to the audit log. Also binds req.log to the
 * request id for every later middleware and handler.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  const httpLogger = logger.child({ module: 'http' });
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const log = httpLogger.child({ request_id: req.context?.requestId });
    req.log = log;
    res.once('finish', () => {
      const route = routeOf(req);
      const userId = req.context?.userId;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log[levelFor(res.statusCode, route)](
        {
          ...(userId !== undefined && { user_id: userId }),
          method: req.method,
          route,
          status: res.statusCode,
          duration_ms: Math.round(durationMs * 10) / 10,
        },
        'http.request.completed',
      );
    });
    next();
  };
}
