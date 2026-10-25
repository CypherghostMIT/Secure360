import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { REPO_ROOT } from './env';

// Same four roles and attributes as infra/postgres/init/01-roles.sh (L2 Table 13).
export const DB_ROLES = {
  s360_owner: 'db_owner_password',
  s360_app: 'db_app_password',
  s360_worker: 'db_worker_password',
  s360_metrics: 'db_metrics_password',
} as const;

export type DbRole = keyof typeof DB_ROLES;

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
}

function secretsDir(): string {
  return process.env['TEST_DB_SECRETS_DIR'] ?? path.join(REPO_ROOT, 'infra', 'secrets');
}

/** A role that already exists (local Docker cluster) keeps its password: read it from the secret file. */
function readExistingPassword(role: DbRole): string {
  // The file name is one of the four constants in DB_ROLES; only the directory is configurable (test harness).
  const file = path.join(secretsDir(), DB_ROLES[role]);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed secret file names, see above
  if (!existsSync(file)) {
    throw new Error(`Role ${role} exists but ${file} is missing: cannot log in as ${role}.`);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed secret file names, see above
  return readFileSync(file, 'utf8').replace(/[\r\n]+/g, '');
}

/**
 * CREATE ROLE takes no bind parameters, so the name and password travel as transaction-local settings and are
 * quoted by format(%I, %L) inside PostgreSQL: nothing is spliced into SQL text on the client side.
 */
async function createRole(admin: PrismaClient, role: DbRole, password: string): Promise<void> {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('s360.role_name', ${role}, true),
                                set_config('s360.role_password', ${password}, true)`;
    await tx.$executeRaw`DO $$ BEGIN
      EXECUTE format(
        'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
        current_setting('s360.role_name'), current_setting('s360.role_password'));
    END $$`;
  });
}

/** Idempotent, so it also brings a local cluster created by an older 01-roles.sh up to date. */
async function applyRoleSettings(admin: PrismaClient, role: DbRole): Promise<void> {
  if (role === 's360_metrics') await admin.$executeRaw`GRANT pg_monitor TO s360_metrics`;
  if (role === 's360_app') {
    await admin.$executeRaw`ALTER ROLE s360_app SET statement_timeout = '5s'`;
    await admin.$executeRaw`ALTER ROLE s360_app SET idle_in_transaction_session_timeout = '10s'`;
    await admin.$executeRaw`ALTER ROLE s360_app SET TimeZone = 'UTC'`;
  }
  if (role === 's360_worker') {
    await admin.$executeRaw`ALTER ROLE s360_worker SET statement_timeout = '5s'`;
    await admin.$executeRaw`ALTER ROLE s360_worker SET idle_in_transaction_session_timeout = '10s'`;
    await admin.$executeRaw`ALTER ROLE s360_worker SET TimeZone = 'UTC'`;
  }
  // Prisma's driver adapter sends Date values without a zone: see infra/postgres/init/01-roles.sh.
  if (role === 's360_owner') await admin.$executeRaw`ALTER ROLE s360_owner SET TimeZone = 'UTC'`;
}

/** Creates missing roles with random passwords (CI) and returns every role's password. */
export async function ensureRoles(admin: PrismaClient): Promise<Record<DbRole, string>> {
  const names = Object.keys(DB_ROLES);
  const existing = await admin.$queryRaw<RoleRow[]>`
    SELECT rolname, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = ANY(${names})`;
  for (const row of existing) {
    // A test run against a privileged role would prove nothing about RLS.
    if (row.rolsuper || row.rolbypassrls || row.rolcreaterole) {
      throw new Error(
        `Role ${row.rolname} is privileged (superuser, BYPASSRLS or CREATEROLE): refusing to test.`,
      );
    }
  }
  const existingNames = new Set(existing.map((row) => row.rolname));
  const passwords = {} as Record<DbRole, string>;
  for (const role of names as DbRole[]) {
    if (existingNames.has(role)) {
      passwords[role] = readExistingPassword(role);
    } else {
      passwords[role] = randomBytes(32).toString('base64url');
      await createRole(admin, role, passwords[role]);
    }
    await applyRoleSettings(admin, role);
  }
  return passwords;
}
