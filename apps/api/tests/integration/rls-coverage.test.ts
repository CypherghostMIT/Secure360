import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  connectAs,
  dbError,
  inRolledBackTenant,
  PERMISSION_DENIED,
  RLS_VIOLATION,
  type Tx,
  withTenant,
} from './helpers/db';
import { readConnectionUrl } from './setup/env';
import { CONTEXT, INCIDENT, ORG, REPORT_JOB, type TenantContext, USER } from './setup/fixtures';

// Policies and privileges that the other suites do not exercise, one behaviour each, with its failure path.
let app: DbClient;
let worker: DbClient;

beforeAll(() => {
  app = connectAs('app');
  worker = connectAs('worker');
});

afterAll(async () => {
  await Promise.all([app, worker].map((client) => client.$disconnect()));
});

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const inAnHour = () => new Date(Date.now() + 3_600_000);

describe('s360_worker under RLS (job-supplied context)', () => {
  const counts = (tx: Tx) =>
    Promise.all([tx.user.count(), tx.incident.count(), tx.deviceToken.count()]);

  it('sees nothing without a context', async () => {
    expect(await inRolledBackTenant(worker, null, counts)).toEqual([0, 0, 0]);
  });

  it("sees exactly the context user's scope", async () => {
    expect(await withTenant(worker, CONTEXT.aUser1, counts)).toEqual([1, 2, 1]);
  });

  it("deletes only the context user's device tokens", async () => {
    const deleted = await inRolledBackTenant(worker, CONTEXT.aUser1, (tx) =>
      tx.deviceToken.deleteMany({}),
    );
    expect(deleted.count).toBe(1);
  });

  it('cannot draw incident references', async () => {
    const error = await dbError(
      inRolledBackTenant(
        worker,
        CONTEXT.aUser1,
        (tx) => tx.$queryRaw`SELECT public.next_incident_reference(2031)`,
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });

  it('can only mark outbox events published, never rewrite them', async () => {
    const error = await dbError(
      inRolledBackTenant(worker, null, (tx) =>
        tx.outboxEvent.updateMany({ data: { payload: { forged: true } } }),
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });
});

describe('attachments_insert', () => {
  const attachment = (uploadedBy: string, n: number) => ({
    incidentId: INCIDENT.a1,
    organizationId: ORG.a,
    uploadedBy,
    storageKey: `${ORG.a}/2026/6100000${n}-0000-4000-8000-000000000000.bin`,
    mime: 'image/png',
    sizeBytes: 10,
    sha256: 'b'.repeat(64),
    width: 1,
    height: 1,
  });

  it('lets the reporter attach evidence to their incident', async () => {
    const created = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.attachment.createMany({ data: [attachment(USER.aUser1, 1)] }),
    );
    expect(created.count).toBe(1);
  });

  it.each([
    ['on an incident the caller cannot see', CONTEXT.aUser2, USER.aUser2],
    ['posing as another uploader', CONTEXT.aManager, USER.aUser1],
  ])('rejects an attachment %s', async (_label, ctx, uploadedBy) => {
    const error = await dbError(
      inRolledBackTenant(app, ctx, (tx) =>
        tx.attachment.createMany({ data: [attachment(uploadedBy, 2)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe('report_jobs', () => {
  const job = (ctx: TenantContext, organizationId: string | null) => ({
    requestedBy: ctx.userId,
    organizationId,
    params: {},
  });

  it.each([
    ['a manager, for their organisation', CONTEXT.aManager, ORG.a],
    ['staff, across organisations', CONTEXT.technician, null],
  ])('accepts a job requested by %s', async (_label, ctx, organizationId) => {
    const created = await inRolledBackTenant(app, ctx, (tx) =>
      tx.reportJob.createMany({ data: [job(ctx, organizationId)] }),
    );
    expect(created.count).toBe(1);
  });

  it.each([
    ['for another organisation', ORG.b],
    ['across organisations', null],
  ])('rejects a non-staff job %s', async (_label, organizationId) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.reportJob.createMany({ data: [job(CONTEXT.aManager, organizationId)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('shows a job to its requester and to staff only', async () => {
    const visible = async (ctx: TenantContext) =>
      withTenant(app, ctx, (tx) => tx.reportJob.count({ where: { id: REPORT_JOB.aManager } }));
    const seen = await Promise.all(
      [CONTEXT.aManager, CONTEXT.technician, CONTEXT.aUser1, CONTEXT.bManager].map(visible),
    );
    expect(seen).toEqual([1, 1, 0, 0]);
  });
});

describe('token and idempotency tables: only their owner', () => {
  it.each([
    ['password reset tokens', (tx: Tx) => tx.passwordResetToken.count()],
    ['idempotency keys', (tx: Tx) => tx.idempotencyKey.count()],
  ])('shows %s to their owner only', async (_label, count) => {
    expect(await withTenant(app, CONTEXT.bUser, count)).toBe(1);
    expect(await withTenant(app, CONTEXT.aUser1, count)).toBe(0);
    expect(await withTenant(app, CONTEXT.admin, count)).toBe(0);
  });

  const resetToken = (userId: string, organizationId: string) => (tx: Tx) =>
    tx.passwordResetToken.createMany({
      data: [
        { userId, organizationId, tokenHash: sha256(`reset-${userId}`), expiresAt: inAnHour() },
      ],
    });
  const idempotencyKey = (userId: string, organizationId: string) => (tx: Tx) =>
    tx.idempotencyKey.createMany({
      data: [
        {
          userId,
          organizationId,
          key: '71000000-0000-4000-8000-000000000001',
          method: 'POST',
          path: '/api/v1/incidents',
          requestHash: sha256(userId),
          statusCode: 201,
          response: {},
          expiresAt: inAnHour(),
        },
      ],
    });

  it.each([
    ['a password reset token', resetToken],
    ['an idempotency key', idempotencyKey],
  ])('accepts %s for oneself and rejects one for another user', async (_label, insert) => {
    const own = await inRolledBackTenant(app, CONTEXT.aUser1, insert(USER.aUser1, ORG.a));
    expect(own.count).toBe(1);
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, insert(USER.aUser2, ORG.a)),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  // Rotation, revocation and consumption go through SECURITY DEFINER functions (tasks 13–14).
  it.each([
    ['refresh_tokens', (tx: Tx) => tx.refreshToken.updateMany({ data: { revokedAt: null } })],
    [
      'password_reset_tokens',
      (tx: Tx) => tx.passwordResetToken.updateMany({ data: { usedAt: null } }),
    ],
  ])('denies s360_app any UPDATE on %s', async (_table, operation) => {
    expect(await dbError(inRolledBackTenant(app, CONTEXT.aUser1, operation))).toMatch(
      PERMISSION_DENIED,
    );
  });
});

describe('organizations_insert', () => {
  const org = {
    name: 'Organisation C',
    type: 'COMPANY' as const,
    sector: 'Test',
    city: 'Douala',
    contactEmail: 'contact@c.test',
    subscriptionPlan: 'BASIC' as const,
  };

  it('lets only an ADMIN create an organisation', async () => {
    for (const ctx of [CONTEXT.aManager, CONTEXT.technician]) {
      const error = await dbError(
        inRolledBackTenant(app, ctx, (tx) => tx.organization.createMany({ data: [org] })),
      );
      expect(error).toMatch(RLS_VIOLATION);
    }
    const created = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.organization.createMany({ data: [org] }),
    );
    expect(created.count).toBe(1);
  });
});

describe('incident_categories', () => {
  it('are readable with any authenticated context, and only then', async () => {
    expect(await app.incidentCategory.count()).toBe(0);
    expect(await withTenant(app, CONTEXT.aUser1, (tx) => tx.incidentCategory.count())).toBe(2);
  });

  it('are tuned by an ADMIN only', async () => {
    const tune = (ctx: TenantContext) =>
      inRolledBackTenant(app, ctx, (tx) =>
        tx.incidentCategory.updateMany({ where: { code: 'MSG-01' }, data: { sortOrder: 5 } }),
      );
    const counts = await Promise.all(
      [CONTEXT.aManager, CONTEXT.technician, CONTEXT.admin].map(tune),
    );
    expect(counts.map((result) => result.count)).toEqual([0, 0, 1]);
  });
});

describe('users: column-level SELECT and the global omit', () => {
  it('returns full rows without the credential columns through the API client', async () => {
    const rows = await withTenant(app, CONTEXT.aManager, (tx) => tx.user.findMany());
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).not.toHaveProperty('passwordHash');
      expect(row).not.toHaveProperty('totpSecretEnc');
      expect(row).toHaveProperty('email');
    }
  });

  it('denies a client that does not omit them', async () => {
    const unconfigured = new PrismaClient({
      adapter: new PrismaPg({ connectionString: readConnectionUrl('app') }),
    });
    try {
      // Column privileges are checked when the query is planned, before RLS: no context is needed to see it.
      expect(await dbError(unconfigured.user.findMany())).toMatch(PERMISSION_DENIED);
    } finally {
      await unconfigured.$disconnect();
    }
  });
});
