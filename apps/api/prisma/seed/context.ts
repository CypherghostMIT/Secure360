import type { Prisma } from '../../src/generated/prisma/client';
import type { DbClient } from '../../src/platform/db/prisma-client';

export type SeedTx = Prisma.TransactionClient;

export interface SeedContext {
  orgId: string | null;
  userId: string | null;
  role: 'USER' | 'MANAGER' | 'TECHNICIAN' | 'ADMIN';
}

// Seeds run as s360_owner, which FORCE ROW LEVEL SECURITY and the guard triggers apply to like any role
// (WORKFLOW §3.4): every write goes through the policies under an explicit context, never around them.
// No org or user: categories, organisations and users only need the ADMIN role in their policies, and an
// empty setting reads as NULL in app_org_id() / app_user_id(), so no real person is impersonated.
export const SEED_ADMIN: SeedContext = { orgId: null, userId: null, role: 'ADMIN' };

/** Same contract as withTenant(): set_config(..., true), so the context ends with the transaction. */
export async function setSeedContext(tx: SeedTx, ctx: SeedContext): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.org_id', ${ctx.orgId ?? ''}, true),
                              set_config('app.user_id', ${ctx.userId ?? ''}, true),
                              set_config('app.role', ${ctx.role}, true)`;
}

export async function withSeedContext<T>(
  db: DbClient,
  ctx: SeedContext,
  fn: (tx: SeedTx) => Promise<T>,
): Promise<T> {
  // bcrypt at cost 12 runs inside the users transaction: Prisma's 5 s default would cut it short.
  return db.$transaction(
    async (tx) => {
      await setSeedContext(tx, ctx);
      return fn(tx);
    },
    { timeout: 60_000 },
  );
}
