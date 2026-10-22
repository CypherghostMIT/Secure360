import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { deriveUrl, readAdminUrl, TEST_DATABASE, URL_ENV } from './env';
import { ensureRoles } from './roles';
import { seed } from './seed';

const execFileAsync = promisify(execFile);
const API_ROOT = path.resolve(__dirname, '../../..');

const connect = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Fresh database owned by s360_owner, with the same schema hardening as infra/postgres/init/01-roles.sh. */
async function recreateDatabase(adminUrl: URL): Promise<void> {
  const maintenance = connect(deriveUrl(adminUrl, { database: 'postgres' }));
  try {
    // Fixed identifier (readAdminUrl checked it): CREATE/DROP DATABASE take no parameters.
    await maintenance.$executeRaw`DROP DATABASE IF EXISTS secure360_test WITH (FORCE)`;
    await maintenance.$executeRaw`CREATE DATABASE secure360_test OWNER s360_owner`;
  } finally {
    await maintenance.$disconnect();
  }
  const testDb = connect(adminUrl.href);
  try {
    await testDb.$executeRaw`ALTER SCHEMA public OWNER TO s360_owner`;
    await testDb.$executeRaw`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
    await testDb.$executeRaw`REVOKE TEMPORARY ON DATABASE secure360_test FROM PUBLIC`;
  } finally {
    await testDb.$disconnect();
  }
}

/** prisma migrate deploy as s360_owner, exactly as the migrate job does. No shell: works on Windows too. */
async function migrate(ownerUrl: string): Promise<void> {
  const cli = require.resolve('prisma/build/index.js');
  try {
    await execFileAsync(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: API_ROOT,
      env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    throw new Error(`prisma migrate deploy failed:\n${stdout}\n${stderr}`);
  }
}

export default async function globalSetup(): Promise<void> {
  const adminUrl = readAdminUrl();
  const bootstrap = connect(deriveUrl(adminUrl, { database: 'postgres' }));
  let passwords;
  try {
    passwords = await ensureRoles(bootstrap);
  } finally {
    await bootstrap.$disconnect();
  }
  await recreateDatabase(adminUrl);

  const urlFor = (user: keyof typeof passwords) =>
    deriveUrl(adminUrl, { database: TEST_DATABASE, user, password: passwords[user] });
  process.env[URL_ENV.superuser] = adminUrl.href;
  process.env[URL_ENV.owner] = urlFor('s360_owner');
  process.env[URL_ENV.app] = urlFor('s360_app');
  process.env[URL_ENV.worker] = urlFor('s360_worker');
  process.env[URL_ENV.metrics] = urlFor('s360_metrics');

  await migrate(urlFor('s360_owner'));

  const superuser = connect(adminUrl.href);
  try {
    await seed(superuser);
  } finally {
    await superuser.$disconnect();
  }
}
