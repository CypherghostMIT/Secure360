import express from 'express';
import type { Express, Router } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config';
import { createErrorHandler } from './http/error-handler';
import { handleNotFound } from './http/not-found';
import type { Logger } from './platform/observability/logger';
import { assignRequestId } from './platform/observability/request-id';
import { createRequestLogger } from './platform/observability/request-logger';

export type AppOptions = Pick<AppConfig, 'trustProxy'>;

export interface AppDeps {
  readonly logger: Logger;
  /** Feature routers, mounted after the body parser (Figure F04). */
  readonly routers?: readonly Router[];
}

// A JSON API never renders a document: no source may load anything and no page may frame a response.
// HSTS is Nginx's (L2 Table 4); sending it here too would duplicate the header.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  frameguard: { action: 'deny' },
  strictTransportSecurity: false,
});

/** Builds the Express application without listening, so tests can drive it with Supertest. */
export function createApp(config: AppOptions, deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  // Hop count, not `true`: trusting every proxy would let a client forge its IP with X-Forwarded-For.
  app.set('trust proxy', config.trustProxy);

  // Order follows Figure F04. Later tasks insert authenticate → rateLimit → validate → idempotency →
  // tenantContext between the body parser and the routers.
  app.use(assignRequestId);
  app.use(securityHeaders);
  app.use(createRequestLogger(deps.logger));
  app.use(express.json({ limit: '100kb' }));
  for (const router of deps.routers ?? []) app.use(router);

  // Must stay last: anything that reaches notFound matched no route; the error handler closes the chain.
  app.use(handleNotFound);
  app.use(createErrorHandler(deps.logger.child({ module: 'http' })));
  return app;
}
