import type { Prisma } from '../../../src/generated/prisma/client';
import { createPrismaClient, type DbClient } from '../../../src/platform/db/prisma-client';
import { type Connection, readConnectionUrl } from '../setup/env';
import type { TenantContext } from '../setup/fixtures';

export type Tx = Prisma.TransactionClient;

/** The API's own client factory, so every test also proves that its global omit fits the column grants. */
export function connectAs(connection: Connection): DbClient {
  return createPrismaClient(readConnectionUrl(connection));
}

/**
 * Same contract as the API's withTenant(): one transaction, context set with set_config(..., true) so it
 * disappears at COMMIT and never leaks to the next user of the pooled connection (L2 §7.4).
 */
export async function withTenant<T>(
  db: DbClient,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true),
                                set_config('app.user_id', ${ctx.userId}, true),
                                set_config('app.role', ${ctx.role}, true)`;
    return fn(tx);
  });
}

class Rollback extends Error {}

/** Runs fn in a tenant transaction and always rolls it back, so a test never changes the shared seed. */
export async function inRolledBackTenant<T>(
  db: DbClient,
  ctx: TenantContext | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await db.$transaction(async (tx) => {
      if (ctx) {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId}, true),
                                    set_config('app.user_id', ${ctx.userId}, true),
                                    set_config('app.role', ${ctx.role}, true)`;
      }
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}

/** Awaits a promise that must fail and returns the database error text (SQLSTATE and message). */
export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return describeError(error);
  }
  throw new Error('Expected the database to reject the operation, but it succeeded.');
}

function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  // Prisma wraps the driver error: collect the message and any SQLSTATE along the cause chain.
  for (let depth = 0; current && depth < 5; depth += 1) {
    const { message, code, cause, meta } = current as {
      message?: string;
      code?: string;
      cause?: unknown;
      meta?: unknown;
    };
    if (message) parts.push(message);
    if (code) parts.push(`code=${code}`);
    if (meta) parts.push(JSON.stringify(meta));
    current = cause;
  }
  return parts.join(' | ');
}

// PostgreSQL messages for the failures the suite asserts.
export const RLS_VIOLATION = /new row violates row-level security policy/;
export const PERMISSION_DENIED = /permission denied/;
export const CHECK_VIOLATION = /violates check constraint/;
export const FK_VIOLATION = /violates foreign key constraint|Foreign key constraint/i;
export const GUARD_VIOLATION = /only an ADMIN may change|session_version/;
