import type { Express, Router } from 'express';
import { ErrorResponseSchema } from '@secure360/shared';
import { createApp } from '../../src/app';
import { captureLogger, type CapturedLogger } from './log-capture';

export interface TestApp extends CapturedLogger {
  readonly app: Express;
}

/** The real application pipeline with an in-memory logger and optional test routers. */
export function buildTestApp(routers: readonly Router[] = []): TestApp {
  const captured = captureLogger();
  return { ...captured, app: createApp({ trustProxy: 0 }, { logger: captured.logger, routers }) };
}

/** The `error` object of a response, validated against the shared envelope (supertest types the body as any). */
export function errorOf(res: { body: unknown }) {
  return ErrorResponseSchema.parse(res.body).error;
}
