import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  connectAs,
  dbError,
  FK_VIOLATION,
  inRolledBackTenant,
  PERMISSION_DENIED,
  RLS_VIOLATION,
  type Tx,
} from './helpers/db';
import { CONTEXT, INCIDENT, ORG, REPORT_JOB, USER } from './setup/fixtures';

// Regression tests for the task 4 security review (findings M1–M6): each one failed against the first version
// of the migrations and passes once the fix is in place.
let superuser: DbClient;
let app: DbClient;
let worker: DbClient;

beforeAll(() => {
  superuser = connectAs('superuser');
  app = connectAs('app');
  worker = connectAs('worker');
});

afterAll(async () => {
  await Promise.all([superuser, app, worker].map((client) => client.$disconnect()));
});

const IMMUTABLE = /cannot change/;
const NOT_STAFF = /assigned_to must be an active staff user/;

const notification = (userId: string, organizationId: string, incidentId: string) => ({
  userId,
  organizationId,
  incidentId,
  type: 'NEW_MESSAGE' as const,
  titleKey: 'notifications.newMessage.title',
  bodyKey: 'notifications.newMessage.body',
});

describe('M1 notifications: the recipient must be related to the incident', () => {
  it("rejects a notification written into another tenant's inbox", async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.notification.createMany({ data: [notification(USER.bManager, ORG.b, INCIDENT.a1)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it.each([
    ['a user of the incident organisation', USER.aManager, ORG.a],
    ['staff', USER.technician, ORG.sfc],
    ['the reporter', USER.aUser1, ORG.a],
  ])('accepts a notification for %s', async (_label, recipient, organizationId) => {
    const created = await inRolledBackTenant(app, CONTEXT.technician, (tx) =>
      tx.notification.createMany({ data: [notification(recipient, organizationId, INCIDENT.a1)] }),
    );
    expect(created.count).toBe(1);
  });

  it("rejects an organization_id other than the recipient's", async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.notification.createMany({ data: [notification(USER.aManager, ORG.b, INCIDENT.a1)] }),
      ),
    );
    expect(error).toMatch(FK_VIOLATION);
  });

  it('rejects a notification about an incident the caller cannot see', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser2, (tx) =>
        tx.notification.createMany({ data: [notification(USER.aManager, ORG.a, INCIDENT.a1)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe('M2 report_jobs: only the worker updates a job, never its organisation', () => {
  const where = { id: REPORT_JOB.aManager };

  it.each([
    ['organization_id', { organizationId: ORG.b }],
    ['status', { status: 'SUCCEEDED' as const, storageKey: 'reports/forged.bin' }],
  ])('denies s360_app an UPDATE of %s on its own job', async (_column, data) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) => tx.reportJob.updateMany({ where, data })),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });

  it('lets the worker record the outcome under the requester context', async () => {
    const result = await inRolledBackTenant(worker, CONTEXT.aManager, (tx) =>
      tx.reportJob.updateMany({
        where,
        data: { status: 'SUCCEEDED', storageKey: 'reports/a.bin', completedAt: new Date() },
      }),
    );
    expect(result.count).toBe(1);
  });

  it('denies the worker an UPDATE of organization_id', async () => {
    const error = await dbError(
      inRolledBackTenant(worker, CONTEXT.aManager, (tx) =>
        tx.reportJob.updateMany({ where, data: { organizationId: ORG.b } }),
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });
});

describe('M3 incident reference counter: only through next_incident_reference()', () => {
  it('denies s360_app direct writes to the counter', async () => {
    for (const operation of [
      (tx: Tx) =>
        tx.incidentReferenceCounter.createMany({ data: [{ year: 2026, lastValue: 999_999 }] }),
      (tx: Tx) => tx.incidentReferenceCounter.updateMany({ data: { lastValue: 999_999 } }),
    ]) {
      expect(await dbError(inRolledBackTenant(app, CONTEXT.aUser1, operation))).toMatch(
        PERMISSION_DENIED,
      );
    }
  });

  it('returns gap-free SFC-YYYY-NNNNNN references inside the creation transaction', async () => {
    const refs = await inRolledBackTenant(app, CONTEXT.aUser1, async (tx) => {
      const next = async () =>
        (
          await tx.$queryRaw<{ ref: string }[]>`SELECT public.next_incident_reference(2031) AS ref`
        )[0]?.ref;
      return [await next(), await next()];
    });
    expect(refs).toEqual(['SFC-2031-000001', 'SFC-2031-000002']);
  });

  it('refuses to run without a tenant context', async () => {
    const error = await dbError(app.$queryRaw`SELECT public.next_incident_reference(2031)`);
    expect(error).toMatch(/tenant context/);
  });
});

describe('M4 incidents_guard', () => {
  const immutable = [
    ['id', { id: '30000000-0000-4000-8000-0000000000ff' }],
    ['reference', { reference: 'SFC-2026-000777' }],
    ['organization_id', { organizationId: ORG.b }],
    ['reporter_id', { reporterId: USER.aUser2 }],
    ['is_anonymous', { isAnonymous: false }],
    ['severity_initial', { severityInitial: 'CRITICAL' as const }],
    ['severity_answers', { severityAnswers: { moneyLost: 'yes' } }],
    ['client_request_id', { clientRequestId: '70000000-0000-4000-8000-0000000000ff' }],
    ['created_at', { createdAt: new Date('2020-01-01T00:00:00Z') }],
  ] as const;

  it.each(immutable)('stops staff changing %s', async (_column, data) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.incident.updateMany({ where: { id: INCIDENT.a1 }, data }),
      ),
    );
    expect(error).toMatch(IMMUTABLE);
  });

  it('accepts a staff assignee and rejects anyone else', async () => {
    const assign = (assignedTo: string) =>
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.incident.updateMany({ where: { id: INCIDENT.a1 }, data: { assignedTo } }),
      );
    expect((await assign(USER.technician)).count).toBe(1);
    expect(await dbError(assign(USER.aManager))).toMatch(NOT_STAFF);
  });

  it('rejects a deactivated technician as assignee', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.admin, async (tx) => {
        await tx.user.updateMany({ where: { id: USER.technician }, data: { isActive: false } });
        return tx.incident.updateMany({
          where: { id: INCIDENT.a1 },
          data: { assignedTo: USER.technician },
        });
      }),
    );
    expect(error).toMatch(NOT_STAFF);
  });

  it('forces the initial lifecycle state when a reporter creates an incident', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const row = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.incident.create({
        data: {
          organizationId: ORG.a,
          reporterId: USER.aUser1,
          reference: 'SFC-2026-000950',
          categoryCode: 'MSG-01',
          title: 'Forged lifecycle',
          description: 'Details',
          severity: 'LOW',
          severityInitial: 'LOW',
          severityAnswers: {},
          clientRequestId: '70000000-0000-4000-8000-000000000050',
          status: 'CLOSED',
          assignedTo: USER.technician,
          acknowledgedAt: future,
          resolvedAt: future,
          closedAt: future,
          version: 7,
        },
        select: {
          status: true,
          assignedTo: true,
          acknowledgedAt: true,
          resolvedAt: true,
          closedAt: true,
          version: true,
        },
      }),
    );
    expect(row).toEqual({
      status: 'NEW',
      assignedTo: null,
      acknowledgedAt: null,
      resolvedAt: null,
      closedAt: null,
      version: 1,
    });
  });
});

describe('M5 incident_status_history: non-staff record only the creation entry', () => {
  const entry = (changedBy: string, fromStatus: 'NEW' | null, toStatus: 'NEW' | 'RESOLVED') => ({
    incidentId: INCIDENT.a1,
    organizationId: ORG.a,
    fromStatus,
    toStatus,
    changedBy,
  });

  it.each([
    ['a reporter forging a resolution', CONTEXT.aUser1, entry(USER.aUser1, 'NEW', 'RESOLVED')],
    ['a manager recording the creation', CONTEXT.aManager, entry(USER.aManager, null, 'NEW')],
    [
      'staff recording a change made by someone else',
      CONTEXT.technician,
      entry(USER.admin, 'NEW', 'RESOLVED'),
    ],
  ])('rejects %s', async (_label, ctx, data) => {
    const error = await dbError(
      inRolledBackTenant(app, ctx, (tx) => tx.incidentStatusHistory.createMany({ data: [data] })),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it.each([
    ['the reporter recording the creation', CONTEXT.aUser1, entry(USER.aUser1, null, 'NEW')],
    ['staff recording a transition', CONTEXT.technician, entry(USER.technician, 'NEW', 'RESOLVED')],
  ])('accepts %s', async (_label, ctx, data) => {
    const created = await inRolledBackTenant(app, ctx, (tx) =>
      tx.incidentStatusHistory.createMany({ data: [data] }),
    );
    expect(created.count).toBe(1);
  });
});

describe('M6 users: credential columns are not updatable by s360_app', () => {
  it.each([
    ['password_hash', { passwordHash: `$2b$12$${'b'.repeat(53)}` }],
    ['totp_secret_enc', { totpSecretEnc: Buffer.from('x') }],
    ['totp_last_step', { totpLastStep: 0n }],
    ['is_2fa_enabled', { is2faEnabled: false }],
    ['locked_until', { lockedUntil: null }],
    ['must_change_password', { mustChangePassword: false }],
    ['last_login_at', { lastLoginAt: new Date() }],
    ['session_version', { sessionVersion: 9 }],
  ])('denies %s, even to an ADMIN', async (_column, data) => {
    for (const [ctx, id] of [
      [CONTEXT.aUser1, USER.aUser1],
      [CONTEXT.admin, USER.aUser1],
    ] as const) {
      const error = await dbError(
        inRolledBackTenant(app, ctx, (tx) => tx.user.updateMany({ where: { id }, data })),
      );
      expect(error).toMatch(PERMISSION_DENIED);
    }
  });

  it('lets a user change their profile columns', async () => {
    const result = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.user.updateMany({
        where: { id: USER.aUser1 },
        data: {
          firstName: 'Aimé',
          lastName: 'Ngono',
          phone: '+237690000000',
          preferredLanguage: 'en',
        },
      }),
    );
    expect(result.count).toBe(1);
  });

  const sessionVersionAfter = (
    db: DbClient,
    ctx: (typeof CONTEXT)[keyof typeof CONTEXT],
    id: string,
    data: Record<string, unknown>,
  ) =>
    inRolledBackTenant(db, ctx, async (tx) => {
      await tx.user.updateMany({ where: { id }, data });
      const row = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { sessionVersion: true },
      });
      return row.sessionVersion;
    });

  it.each([
    ['role', USER.aUser2, { role: 'MANAGER' }],
    ['is_active', USER.aUser2, { isActive: false }],
    ['organization_id', USER.aManager, { organizationId: ORG.b }],
  ])('raises session_version when an ADMIN changes %s', async (_column, id, data) => {
    expect(await sessionVersionAfter(app, CONTEXT.admin, id, data)).toBe(2);
  });

  it('raises session_version when the password changes (auth functions)', async () => {
    const data = { passwordHash: `$2b$12$${'c'.repeat(53)}` };
    expect(await sessionVersionAfter(superuser, CONTEXT.aUser1, USER.aUser1, data)).toBe(2);
  });

  it('never lets totp_last_step decrease or be cleared', async () => {
    for (const next of [41n, null]) {
      const error = await dbError(
        inRolledBackTenant(superuser, CONTEXT.aUser1, async (tx) => {
          await tx.user.updateMany({ where: { id: USER.aUser1 }, data: { totpLastStep: 42n } });
          return tx.user.updateMany({ where: { id: USER.aUser1 }, data: { totpLastStep: next } });
        }),
      );
      expect(error).toMatch(/totp_last_step cannot decrease/);
    }
  });

  it('never lets session_version decrease', async () => {
    const error = await dbError(
      inRolledBackTenant(superuser, CONTEXT.admin, async (tx) => {
        await tx.user.updateMany({ where: { id: USER.aUser1 }, data: { sessionVersion: 5 } });
        return tx.user.updateMany({ where: { id: USER.aUser1 }, data: { sessionVersion: 4 } });
      }),
    );
    expect(error).toMatch(/session_version cannot decrease/);
  });
});
