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
import {
  CONTEXT,
  FAKE_BCRYPT_HASH,
  INCIDENT,
  ORG,
  REPORT_JOB,
  type TenantContext,
  USER,
} from './setup/fixtures';

// Regression tests for the task 4 security reviews (findings M1–M6, then m1–m5 and N2 of the re-review): each one
// fails when its fix is removed and passes once the fix is in place.
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
const UNIQUE_VIOLATION = /Unique constraint|duplicate key/i;

type NotificationType =
  'STATUS_UPDATE' | 'NEW_MESSAGE' | 'ASSIGNMENT' | 'NEW_INCIDENT' | 'SLA_BREACH';

const notification = (
  userId: string,
  organizationId: string,
  incidentId: string,
  type: NotificationType = 'NEW_MESSAGE',
) => ({
  userId,
  organizationId,
  incidentId,
  type,
  titleKey: 'notifications.newMessage.title',
  bodyKey: 'notifications.newMessage.body',
});

/** A new incident reported by the context user in their own organisation. */
const newIncident = (ctx: TenantContext, n: number, overrides: Record<string, unknown> = {}) => ({
  organizationId: ctx.orgId,
  reporterId: ctx.userId,
  categoryCode: 'MSG-01',
  title: 'New incident',
  description: 'Details',
  severity: 'LOW' as const,
  severityInitial: 'LOW' as const,
  severityAnswers: {},
  clientRequestId: `70000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  ...overrides,
});

/** True when the timestamp column of the row equals the transaction's now(), at the column's precision. */
const isStampedNow = async (tx: Tx, table: 'incidents' | 'incident_status_history', id: string) => {
  const rows =
    table === 'incidents'
      ? await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT created_at = now()::timestamptz(3) AND updated_at = created_at AS ok
            FROM incidents WHERE id = ${id}::uuid`
      : await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT changed_at = now()::timestamptz(3) AS ok FROM incident_status_history WHERE id = ${id}::uuid`;
  return rows[0]?.ok;
};

describe('M1 notifications: the recipient must be able to see the incident', () => {
  it("rejects a notification written into another tenant's inbox", async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.notification.createMany({ data: [notification(USER.bManager, ORG.b, INCIDENT.a1)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it.each([
    ['a MANAGER of the incident organisation', USER.aManager, ORG.a],
    ['staff', USER.technician, ORG.sfc],
    ['the reporter', USER.aUser1, ORG.a],
  ])('accepts a notification for %s', async (_label, recipient, organizationId) => {
    const created = await inRolledBackTenant(app, CONTEXT.technician, (tx) =>
      tx.notification.createMany({ data: [notification(recipient, organizationId, INCIDENT.a1)] }),
    );
    expect(created.count).toBe(1);
  });

  // m4: a USER of the same organisation who is not the reporter cannot see the incident.
  it('rejects a colleague of the reporter who cannot see the incident', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.notification.createMany({ data: [notification(USER.aUser2, ORG.a, INCIDENT.a1)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
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

describe('m4 notifications: types a non-staff caller may cause', () => {
  const insert = (db: DbClient, ctx: TenantContext, type: NotificationType) =>
    inRolledBackTenant(db, ctx, (tx) =>
      tx.notification.createMany({
        data: [notification(USER.technician, ORG.sfc, INCIDENT.a1, type)],
      }),
    );

  it.each(['NEW_INCIDENT', 'NEW_MESSAGE'] as const)(
    'accepts %s from the reporter',
    async (type) => {
      expect((await insert(app, CONTEXT.aUser1, type)).count).toBe(1);
    },
  );

  it.each(['ASSIGNMENT', 'STATUS_UPDATE', 'SLA_BREACH'] as const)(
    'rejects %s from the reporter',
    async (type) => {
      expect(await dbError(insert(app, CONTEXT.aUser1, type))).toMatch(RLS_VIOLATION);
    },
  );

  it('rejects STATUS_UPDATE from a manager', async () => {
    expect(await dbError(insert(app, CONTEXT.aManager, 'STATUS_UPDATE'))).toMatch(RLS_VIOLATION);
  });

  it('accepts STATUS_UPDATE from staff', async () => {
    const created = await inRolledBackTenant(app, CONTEXT.technician, (tx) =>
      tx.notification.createMany({
        data: [notification(USER.aUser1, ORG.a, INCIDENT.a1, 'STATUS_UPDATE')],
      }),
    );
    expect(created.count).toBe(1);
  });

  it('accepts SLA_BREACH from the worker, whatever the job context', async () => {
    expect((await insert(worker, CONTEXT.aUser1, 'SLA_BREACH')).count).toBe(1);
  });
});

describe('M2 report_jobs: only the worker updates a job, never its organisation', () => {
  const where = { id: REPORT_JOB.aManager };
  const reportKey = `${ORG.a}/2026/91000000-0000-4000-8000-000000000001.bin`;

  it.each([
    ['organization_id', { organizationId: ORG.b }],
    ['status', { status: 'SUCCEEDED' as const, storageKey: reportKey }],
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
        data: { status: 'SUCCEEDED', storageKey: reportKey, completedAt: new Date() },
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

describe('M3 incident reference counter: drawn by incidents_guard only', () => {
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

  it('gives s360_app no way to draw a reference without creating an incident', async () => {
    const error = await dbError(
      inRolledBackTenant(
        app,
        CONTEXT.aUser1,
        (tx) => tx.$queryRaw`SELECT public.next_incident_reference()`,
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });
});

describe('m2 incidents.reference: always drawn from the counter', () => {
  it('ignores a supplied reference and numbers creations without gaps in the current year', async () => {
    const { references, year } = await inRolledBackTenant(app, CONTEXT.aUser1, async (tx) => {
      const forged = { reference: 'SFC-2026-999999' };
      const created = [];
      for (const n of [61, 62]) {
        created.push(
          await tx.incident.create({
            data: newIncident(CONTEXT.aUser1, n, forged),
            select: { reference: true },
          }),
        );
      }
      const [row] = await tx.$queryRaw<{ year: number }[]>`
        SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Douala')::int AS year`;
      return { references: created.map((r) => r.reference), year: row?.year };
    });
    const numbers = references.map((reference) => {
      expect(reference).toMatch(/^SFC-\d{4}-\d{6}$/);
      expect(reference.slice(4, 8)).toBe(String(year));
      return Number(reference.slice(-6));
    });
    expect(numbers[1]).toBe((numbers[0] ?? 0) + 1);
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

  // m3: the rule applies at assignment, and an insert by staff is an assignment too.
  it('applies the assignee rule when staff create an incident already assigned', async () => {
    const create = (assignedTo: string, n: number) =>
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.incident.create({
          data: newIncident(CONTEXT.technician, n, { assignedTo }),
          select: { assignedTo: true },
        }),
      );
    expect(await create(USER.technician, 63)).toEqual({ assignedTo: USER.technician });
    expect(await dbError(create(USER.aManager, 64))).toMatch(NOT_STAFF);
  });

  // m1: created_at and resolution_notes too, so a reporter cannot back-date an incident or pre-fill its outcome.
  it('forces the initial lifecycle state when a reporter creates an incident', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const { row, isNow } = await inRolledBackTenant(app, CONTEXT.aUser1, async (tx) => {
      const created = await tx.incident.create({
        data: newIncident(CONTEXT.aUser1, 65, {
          title: 'Forged lifecycle',
          status: 'CLOSED',
          assignedTo: USER.technician,
          acknowledgedAt: future,
          resolvedAt: future,
          closedAt: future,
          resolutionNotes: 'Already solved',
          createdAt: new Date('2020-01-01T00:00:00Z'),
          version: 7,
        }),
        select: {
          id: true,
          status: true,
          assignedTo: true,
          acknowledgedAt: true,
          resolvedAt: true,
          closedAt: true,
          resolutionNotes: true,
          version: true,
        },
      });
      const { id, ...lifecycle } = created;
      return { row: lifecycle, isNow: await isStampedNow(tx, 'incidents', id) };
    });
    expect(row).toEqual({
      status: 'NEW',
      assignedTo: null,
      acknowledgedAt: null,
      resolvedAt: null,
      closedAt: null,
      resolutionNotes: null,
      version: 1,
    });
    expect(isNow).toBe(true);
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

  it('accepts staff recording a transition', async () => {
    const created = await inRolledBackTenant(app, CONTEXT.technician, (tx) =>
      tx.incidentStatusHistory.createMany({ data: [entry(USER.technician, 'NEW', 'RESOLVED')] }),
    );
    expect(created.count).toBe(1);
  });

  // N2: one creation entry per incident (the seed already holds INCIDENT.a1's).
  it('accepts the reporter recording the creation once, and only once', async () => {
    const record = (tx: Tx, incidentId: string) =>
      tx.incidentStatusHistory.createMany({
        data: [{ ...entry(USER.aUser1, null, 'NEW'), incidentId }],
      });
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, async (tx) => {
        const { id } = await tx.incident.create({
          data: newIncident(CONTEXT.aUser1, 66),
          select: { id: true },
        });
        expect((await record(tx, id)).count).toBe(1);
        return record(tx, id);
      }),
    );
    expect(error).toMatch(UNIQUE_VIOLATION);
  });

  it('stamps changed_at with the database clock, ignoring a supplied value', async () => {
    const isNow = await inRolledBackTenant(app, CONTEXT.technician, async (tx) => {
      const { id } = await tx.incidentStatusHistory.create({
        data: { ...entry(USER.technician, 'NEW', 'RESOLVED'), changedAt: new Date('2020-01-01') },
        select: { id: true },
      });
      return isStampedNow(tx, 'incident_status_history', id);
    });
    expect(isNow).toBe(true);
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

describe('m5 users: an ADMIN creates a user with a password and a profile only', () => {
  const user = (overrides: Record<string, unknown> = {}) => ({
    organizationId: ORG.a,
    firstName: 'New',
    lastName: 'User',
    email: 'new.user@org-a.test',
    passwordHash: FAKE_BCRYPT_HASH,
    role: 'USER' as const,
    ...overrides,
  });

  it.each([
    ['totp_secret_enc', { totpSecretEnc: Buffer.from('attacker-secret') }],
    ['totp_last_step', { totpLastStep: 0n }],
    ['locked_until', { lockedUntil: new Date() }],
    ['last_login_at', { lastLoginAt: new Date() }],
  ])('denies an ADMIN presetting %s', async (_column, overrides) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.admin, (tx) =>
        tx.user.createMany({ data: [user(overrides)] }),
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });

  // Prisma sends these three on every create, so users_guard_insert fixes them instead of the grant.
  it('forces 2FA off, session_version 1 and a password change, whatever the ADMIN supplies', async () => {
    const forged = { is2faEnabled: true, mustChangePassword: false, sessionVersion: 9 };
    const row = await inRolledBackTenant(app, CONTEXT.admin, async (tx) => {
      await tx.user.createMany({ data: [user(forged)] });
      return tx.user.findFirstOrThrow({
        where: { email: 'new.user@org-a.test' },
        select: {
          mustChangePassword: true,
          is2faEnabled: true,
          sessionVersion: true,
          lockedUntil: true,
        },
      });
    });
    expect(row).toEqual({
      mustChangePassword: true,
      is2faEnabled: false,
      sessionVersion: 1,
      lockedUntil: null,
    });
  });
});
