// Real Prisma 7 + @prisma/adapter-pg errors from our PostgreSQL, run through the API's error classifier.
// If a Prisma upgrade changes the error shape, or the server's message language changes (lc_messages), these
// tests turn red instead of the API silently answering 500.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { classifyError } from '../../src/http/classify-error';
import { readDbError } from '../../src/platform/db/db-error';
import type { DbClient } from '../../src/platform/db/prisma-client';
import { connectAs, inRolledBackTenant } from './helpers/db';
import { readConnectionUrl } from './setup/env';
import { CONTEXT, EMAIL, INCIDENT, ORG, USER } from './setup/fixtures';

let app: DbClient;
let superuser: DbClient;

beforeAll(() => {
  app = connectAs('app');
  superuser = connectAs('superuser');
});

afterAll(async () => {
  await app.$disconnect();
  await superuser.$disconnect();
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail.');
}

const otherTenantIncident = {
  organizationId: ORG.b,
  reporterId: USER.bUser,
  categoryCode: 'MSG-01',
  title: 'Other tenant',
  description: 'Details',
  severity: 'MEDIUM' as const,
  severityInitial: 'MEDIUM' as const,
  severityAnswers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'no' },
  clientRequestId: '70000000-0000-4000-8000-0000000000e1',
};

describe('database errors as the API receives them', () => {
  it('RLS violation: 42501 with the exact server message → NOT_FOUND (warn)', async () => {
    const error = await caught(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.incident.create({ data: otherTenantIncident }),
      ),
    );

    expect(readDbError(error)).toMatchObject({
      prismaCode: 'P2039',
      sqlstate: '42501',
      pgMessage: 'new row violates row-level security policy for table "incidents"',
    });
    expect(classifyError(error)).toMatchObject({ code: 'NOT_FOUND', level: 'warn' });
  });

  it('missing GRANT: 42501 "permission denied for …" → INTERNAL_ERROR (error)', async () => {
    const error = await caught(app.$queryRaw`SELECT count(*) FROM _prisma_migrations`);

    expect(readDbError(error)).toMatchObject({
      prismaCode: 'P2010',
      sqlstate: '42501',
      pgMessage: 'permission denied for table _prisma_migrations',
    });
    expect(classifyError(error)).toMatchObject({
      code: 'INTERNAL_ERROR',
      level: 'error',
      reason: 'db.permission_denied',
    });
  });

  it('users guard trigger → FORBIDDEN with the trigger message', async () => {
    const error = await caught(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.user.updateMany({ where: { id: USER.aUser1 }, data: { role: 'MANAGER' } }),
      ),
    );

    expect(classifyError(error)).toMatchObject({
      code: 'FORBIDDEN',
      level: 'warn',
      dbMessage: 'only an ADMIN may change role, organization_id, is_active or email',
    });
  });

  it('incidents guard trigger → FORBIDDEN, without its DETAIL', async () => {
    const error = await caught(
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.incident.update({
          where: { id: INCIDENT.a1 },
          data: { clientRequestId: '70000000-0000-4000-8000-0000000000e2' },
        }),
      ),
    );

    expect(classifyError(error)).toMatchObject({
      code: 'FORBIDDEN',
      dbMessage: 'incidents identity, provenance and confidentiality columns cannot change',
    });
  });

  it('record not found (P2025) → NOT_FOUND, also for a row hidden by RLS', async () => {
    const error = await caught(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.user.update({ where: { id: USER.bUser }, data: { firstName: 'X' } }),
      ),
    );

    expect(readDbError(error)).toMatchObject({ prismaCode: 'P2025' });
    expect(classifyError(error)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('unique violation (P2002) → CONFLICT', async () => {
    const error = await caught(
      inRolledBackTenant(app, CONTEXT.admin, (tx) =>
        tx.user.update({ where: { id: USER.aUser2 }, data: { email: EMAIL.aUser1 } }),
      ),
    );

    expect(readDbError(error)).toMatchObject({ prismaCode: 'P2002', sqlstate: '23505' });
    expect(classifyError(error)).toMatchObject({ code: 'CONFLICT' });
  });
});

describe('database unreachable → SERVICE_UNAVAILABLE', () => {
  it('connection refused: adapter kind DatabaseNotReachable, no SQLSTATE', async () => {
    const refused = new PrismaClient({
      adapter: new PrismaPg({ connectionString: 'postgresql://nobody@127.0.0.1:1/none' }),
    });
    try {
      const error = await caught(refused.$queryRaw`SELECT 1`);

      expect(readDbError(error)).toMatchObject({
        prismaCode: 'P2010',
        adapterKind: 'DatabaseNotReachable',
      });
      expect(readDbError(error)?.sqlstate).toBeUndefined();
      expect(classifyError(error)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      await refused.$disconnect();
    }
  });

  it('backend terminated (57P01)', async () => {
    const victim = connectAs('app');
    try {
      // Prisma queries are lazy: .then() starts this one before the backend is terminated.
      const running = victim.$queryRaw`SELECT pg_sleep(3)::text`.then(
        () => undefined,
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      await superuser.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE usename = 's360_app' AND state = 'active' AND query LIKE '%pg_sleep%'`;
      const error = await running;

      expect(readDbError(error)).toMatchObject({ sqlstate: '57P01' });
      expect(classifyError(error)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      await victim.$disconnect();
    }
  });

  it('statement timeout (57014) → SERVICE_UNAVAILABLE at warn', async () => {
    const error = await caught(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = 50`;
        await tx.$queryRaw`SELECT pg_sleep(1)::text`;
      }),
    );

    expect(readDbError(error)).toMatchObject({
      sqlstate: '57014',
      pgMessage: 'canceling statement due to statement timeout',
    });
    expect(classifyError(error)).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      level: 'warn',
      reason: 'db.statement_timeout',
    });
  });

  it('pool timeout: plain Error from pg-pool tagged with clientVersion', async () => {
    const tiny = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: readConnectionUrl('app'),
        max: 1,
        connectionTimeoutMillis: 300,
      }),
    });
    let release: () => void = () => undefined;
    const held = tiny.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      await new Promise<void>((resolve) => (release = resolve));
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const error = await caught(tiny.$queryRaw`SELECT 1`);

      expect(readDbError(error)).toEqual({ message: 'timeout exceeded when trying to connect' });
      expect(classifyError(error)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    } finally {
      release();
      await held;
      await tiny.$disconnect();
    }
  });
});
