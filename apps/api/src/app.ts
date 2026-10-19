import express from 'express';
import type { Express } from 'express';
import type { AppConfig } from './config';
import { handleNotFound } from './http/not-found';

export type AppOptions = Pick<AppConfig, 'trustProxy'>;

/** Builds the Express application without listening, so tests can drive it with Supertest. */
export function createApp(config: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  // Hop count, not `true`: trusting every proxy would let a client forge its IP with X-Forwarded-For.
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '100kb' }));

  // Must stay last: anything that reaches it matched no route.
  app.use(handleNotFound);
  return app;
}
