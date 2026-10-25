import { existsSync } from 'node:fs';
import path from 'node:path';

// The integration suite drops and recreates this database on every run, so it must never be a real one.
export const TEST_DATABASE = 'secure360_test';

export const REPO_ROOT = path.resolve(__dirname, '../../../../..');

// Connection URLs computed by the global setup and read by the tests (same process with --runInBand).
export const URL_ENV = {
  superuser: 'S360_IT_SUPERUSER_URL',
  owner: 'S360_IT_OWNER_URL',
  app: 'S360_IT_APP_URL',
  worker: 'S360_IT_WORKER_URL',
  metrics: 'S360_IT_METRICS_URL',
} as const;

export type Connection = keyof typeof URL_ENV;

/** Bootstrap superuser URL. Local runs read it from the repository .env (npm run dev:secrets prints it). */
export function readAdminUrl(): URL {
  const envFile = path.join(REPO_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const raw = process.env['TEST_DATABASE_ADMIN_URL'];
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set (see .env.example and npm run dev:secrets).',
    );
  }
  const url = new URL(raw);
  if (url.pathname !== `/${TEST_DATABASE}`) {
    throw new Error(
      `TEST_DATABASE_ADMIN_URL must name the database ${TEST_DATABASE}: it is dropped and recreated.`,
    );
  }
  return url;
}

/** Same server, another database and optionally another login. */
export function deriveUrl(
  base: URL,
  options: { database?: string; user?: string; password?: string },
): string {
  const url = new URL(base.href);
  if (options.database !== undefined) url.pathname = `/${options.database}`;
  if (options.user !== undefined) url.username = options.user;
  // The URL setters percent-encode reserved characters themselves.
  if (options.password !== undefined) url.password = options.password;
  return url.href;
}

export function readConnectionUrl(connection: Connection): string {
  const value = process.env[URL_ENV[connection]];
  if (!value)
    throw new Error(`${URL_ENV[connection]} is not set: run through npm run test:integration.`);
  return value;
}
