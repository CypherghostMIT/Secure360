import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '../../generated/prisma/client';

/**
 * Columns no runtime role may read: s360_app and s360_worker have column-level SELECT on users without them
 * (migration 20261019120100), so a default query that selected them would fail with "permission denied".
 * The login path reads them through auth_find_user_by_email().
 */
export const GLOBAL_OMIT = {
  user: { passwordHash: true, totpSecretEnc: true },
} as const satisfies Prisma.GlobalOmitConfig;

/** Prisma client for one least-privilege database role (L2 Table 13). */
export function createPrismaClient(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), omit: GLOBAL_OMIT });
}

export type DbClient = ReturnType<typeof createPrismaClient>;
