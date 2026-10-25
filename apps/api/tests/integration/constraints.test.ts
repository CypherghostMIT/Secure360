import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  CHECK_VIOLATION,
  dbError,
  FK_VIOLATION,
  inRolledBackTenant,
  type Tx,
  connectAs,
} from './helpers/db';
import { CONTEXT, FAKE_BCRYPT_HASH, INCIDENT, ORG, USER } from './setup/fixtures';

// CHECK constraints and foreign keys apply to every role, so they are exercised as the superuser (no RLS),
// each in a transaction that is rolled back.
let superuser: DbClient;

beforeAll(() => {
  superuser = connectAs('superuser');
});

afterAll(async () => {
  await superuser.$disconnect();
});

const rejected = (operation: (tx: Tx) => Promise<unknown>) =>
  dbError(inRolledBackTenant(superuser, null, operation));

const incident = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ORG.a,
  reporterId: USER.aUser1,
  categoryCode: 'MSG-01',
  title: 'Title',
  description: 'Description',
  severity: 'LOW' as const,
  severityInitial: 'LOW' as const,
  severityAnswers: {},
  clientRequestId: '80000000-0000-4000-8000-000000000001',
  ...overrides,
});

const category = (code: string, defaultSeverity: string) => ({
  code,
  groupCode: 'OTHER',
  labelFr: 'Libellé',
  labelEn: 'Label',
  defaultSeverity,
  sortOrder: 99,
});

describe('incident_categories.default_severity', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('accepts %s', async (severity) => {
    const result = await inRolledBackTenant(
      superuser,
      null,
      (tx) =>
        tx.$executeRaw`INSERT INTO incident_categories (code, group_code, label_fr, label_en, default_severity, sort_order)
                     VALUES ('OTH-09', 'OTHER', 'Autre', 'Other', ${severity}::severity, 9)`,
    );
    expect(result).toBe(1);
  });

  it.each(['MODERATE', 'low', ''])('rejects %p (native enum)', async (severity) => {
    const error = await rejected(
      (tx) =>
        tx.$executeRaw`INSERT INTO incident_categories (code, group_code, label_fr, label_en, default_severity, sort_order)
                     VALUES ('OTH-09', 'OTHER', 'Autre', 'Other', ${severity}::severity, 9)`,
    );
    expect(error).toMatch(/invalid input value for enum severity/);
  });

  it('rejects a malformed category code', async () => {
    const error = await rejected((tx) =>
      tx.incidentCategory.createMany({ data: [category('mob-2', 'LOW') as never] }),
    );
    expect(error).toMatch(CHECK_VIOLATION);
  });
});

describe('incidents', () => {
  it.each([
    ['version below 1', { version: 0 }],
    [
      'resolved before creation',
      { createdAt: new Date('2026-05-02'), resolvedAt: new Date('2026-05-01') },
    ],
    [
      'closed before creation',
      { createdAt: new Date('2026-05-02'), closedAt: new Date('2026-05-01') },
    ],
    ['title over 150 characters', { title: 'x'.repeat(151) }],
    ['blank title', { title: '   ' }],
    ['description over 5000 characters', { description: 'x'.repeat(5001) }],
    ['location over 200 characters', { location: 'x'.repeat(201) }],
    ['answers that are not an object', { severityAnswers: ['yes'] }],
  ])('rejects %s', async (_label, overrides) => {
    // Staff context: for anyone else incidents_guard resets the lifecycle fields before the CHECKs run.
    const error = await dbError(
      inRolledBackTenant(superuser, CONTEXT.admin, (tx) =>
        tx.incident.createMany({ data: [incident(overrides)] }),
      ),
    );
    expect(error).toMatch(CHECK_VIOLATION);
  });

  it('accepts the maximum lengths of the shared schemas', async () => {
    const result = await inRolledBackTenant(superuser, null, (tx) =>
      tx.incident.createMany({
        data: [
          incident({
            title: 'x'.repeat(150),
            description: 'x'.repeat(5000),
            location: 'x'.repeat(200),
          }),
        ],
      }),
    );
    expect(result.count).toBe(1);
  });

  it('enforces UNIQUE (reporter_id, client_request_id)', async () => {
    const error = await rejected(async (tx) => {
      await tx.incident.createMany({ data: [incident()] });
      return tx.incident.createMany({ data: [incident()] });
    });
    expect(error).toMatch(/Unique constraint|duplicate key/i);
  });

  it('requires a reporter (L1 D1: reporter_id NOT NULL)', async () => {
    const error = await rejected(
      (tx) =>
        tx.$executeRaw`INSERT INTO incidents (id, reference, organization_id, reporter_id, category_code, title,
                       description, severity, severity_initial, severity_answers, client_request_id, updated_at)
                       VALUES (gen_random_uuid(), 'SFC-2026-000997', ${ORG.a}::uuid, NULL, 'MSG-01', 't', 'd',
                       'LOW', 'LOW', '{}', gen_random_uuid(), now())`,
    );
    expect(error).toMatch(/null value in column "reporter_id"/);
  });

  it('rejects a reporter from another organisation (composite FK)', async () => {
    const error = await rejected((tx) =>
      tx.incident.createMany({ data: [incident({ organizationId: ORG.b })] }),
    );
    expect(error).toMatch(FK_VIOLATION);
  });
});

describe('other CHECK constraints', () => {
  it.each([
    [
      'a message body over 2000 characters',
      (tx: Tx) =>
        tx.incidentMessage.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              senderId: USER.aUser1,
              body: 'x'.repeat(2001),
            },
          ],
        }),
    ],
    [
      'a plaintext password',
      (tx: Tx) =>
        tx.user.createMany({
          data: [
            {
              organizationId: ORG.a,
              firstName: 'A',
              lastName: 'B',
              email: 'c@d.test',
              passwordHash: 'Secret123',
              role: 'USER',
            },
          ],
        }),
    ],
    [
      'a malformed phone number',
      (tx: Tx) =>
        tx.user.createMany({
          data: [
            {
              organizationId: ORG.a,
              firstName: 'A',
              lastName: 'B',
              email: 'c@d.test',
              passwordHash: FAKE_BCRYPT_HASH,
              role: 'USER',
              phone: '699 00 00 00',
            },
          ],
        }),
    ],
    [
      'an attachment path from the client',
      (tx: Tx) =>
        tx.attachment.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              uploadedBy: USER.aUser1,
              storageKey: '../../etc/passwd',
              mime: 'image/jpeg',
              sizeBytes: 1,
              sha256: 'a'.repeat(64),
              width: 1,
              height: 1,
            },
          ],
        }),
    ],
    [
      "an attachment key in another organisation's folder",
      (tx: Tx) =>
        tx.attachment.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              uploadedBy: USER.aUser1,
              storageKey: `${ORG.b}/2026/${INCIDENT.b1}.bin`,
              mime: 'image/jpeg',
              sizeBytes: 1,
              sha256: 'a'.repeat(64),
              width: 1,
              height: 1,
            },
          ],
        }),
    ],
    [
      'an attachment that is not an image',
      (tx: Tx) =>
        tx.attachment.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              uploadedBy: USER.aUser1,
              storageKey: `${ORG.a}/2026/${INCIDENT.a1}.bin`,
              mime: 'application/pdf',
              sizeBytes: 1,
              sha256: 'a'.repeat(64),
              width: 1,
              height: 1,
            },
          ],
        }),
    ],
    [
      'a token hash that is not 32 bytes',
      (tx: Tx) =>
        tx.refreshToken.createMany({
          data: [
            {
              userId: USER.aUser1,
              organizationId: ORG.a,
              familyId: INCIDENT.a1,
              tokenHash: Buffer.from('raw-token'),
              expiresAt: new Date(Date.now() + 1000),
            },
          ],
        }),
    ],
    [
      'an audit action that is not noun.verb.outcome',
      (tx: Tx) => tx.auditLog.createMany({ data: [{ action: 'login' }] }),
    ],
    [
      'a reference counter beyond six digits',
      (tx: Tx) =>
        tx.incidentReferenceCounter.createMany({ data: [{ year: 2026, lastValue: 1_000_000 }] }),
    ],
  ])('rejects %s', async (_label, operation) => {
    expect(await rejected(operation)).toMatch(CHECK_VIOLATION);
  });
});

describe('foreign keys: ON DELETE RESTRICT', () => {
  it('refuses to delete an organisation that still has users and incidents', async () => {
    const error = await rejected((tx) => tx.organization.deleteMany({ where: { id: ORG.a } }));
    expect(error).toMatch(FK_VIOLATION);
  });

  it('refuses to delete an incident that has messages', async () => {
    const error = await rejected((tx) => tx.incident.deleteMany({ where: { id: INCIDENT.a1 } }));
    expect(error).toMatch(FK_VIOLATION);
  });

  it('refuses to move a user with incidents to another organisation (ON UPDATE RESTRICT)', async () => {
    const error = await rejected(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', 'ADMIN', true)`;
      return tx.user.updateMany({ where: { id: USER.aUser1 }, data: { organizationId: ORG.b } });
    });
    expect(error).toMatch(FK_VIOLATION);
  });
});

// Staff context: for anyone else incidents_guard stamps created_at with the database clock.
const asStaff = <T>(operation: (tx: Tx) => Promise<T>) =>
  inRolledBackTenant(superuser, CONTEXT.admin, operation);

describe('incidents.sla_due_at: after creation, at most 21 days (504 hours) later', () => {
  const createdAt = new Date('2026-05-01T08:00:00Z');
  const after = (hours: number) => new Date(createdAt.getTime() + hours * 3_600_000);
  const create =
    (slaDueAt: Date | null, at = createdAt) =>
    (tx: Tx) =>
      tx.incident.createMany({ data: [incident({ createdAt: at, slaDueAt })] });

  it.each([
    ['no deadline', null],
    ['a 4-hour deadline', after(4)],
    // LOW: 10 business days with public holidays inside, beyond the former 14-day bound.
    ['a 16-day deadline', after(16 * 24)],
    ['a deadline exactly 21 days later', after(21 * 24)],
  ])('accepts %s', async (_label, slaDueAt) => {
    expect((await asStaff(create(slaDueAt))).count).toBe(1);
  });

  it.each([
    ['a deadline at creation', after(0)],
    ['a deadline before creation', after(-1)],
    ['a deadline 21 days and 1 hour later', after(21 * 24 + 1)],
  ])('rejects %s', async (_label, slaDueAt) => {
    expect(await dbError(asStaff(create(slaDueAt)))).toMatch(CHECK_VIOLATION);
  });

  // N1: in a session whose TimeZone observes DST, '21 days' across the spring change is only 503 hours.
  // Raw SQL with explicit offsets: the driver adapter sends Date values without a zone, so the session TimeZone
  // would shift both timestamps alike and hide the difference.
  it('accepts exactly 504 hours whatever the session TimeZone (DST change inside)', async () => {
    const inserted = await asStaff(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Paris'`;
      return tx.$executeRaw`
        INSERT INTO incidents (id, reference, organization_id, reporter_id, category_code, title, description,
                               severity, severity_initial, severity_answers, client_request_id, created_at,
                               updated_at, sla_due_at)
        VALUES (gen_random_uuid(), 'drawn by the guard', ${ORG.a}::uuid, ${USER.aUser1}::uuid, 'MSG-01', 't', 'd',
                'LOW', 'LOW', '{}', gen_random_uuid(), timestamptz '2026-03-20 08:00:00+00',
                timestamptz '2026-03-20 08:00:00+00', timestamptz '2026-04-10 08:00:00+00')`;
    });
    expect(inserted).toBe(1);
  });
});

describe('report_jobs.storage_key: in the job organisation, or global/ across organisations', () => {
  const file = '2026/92000000-0000-4000-8000-000000000001.bin';
  const create = (organizationId: string | null, storageKey: string) => (tx: Tx) =>
    tx.reportJob.createMany({
      data: [{ requestedBy: USER.technician, organizationId, params: {}, storageKey }],
    });

  it.each([
    ['a key in the job organisation', ORG.a, `${ORG.a}/${file}`],
    ['a global key for a cross-organisation job', null, `global/${file}`],
  ])('accepts %s', async (_label, organizationId, storageKey) => {
    const result = await inRolledBackTenant(superuser, null, create(organizationId, storageKey));
    expect(result.count).toBe(1);
  });

  it.each([
    ["a key in another organisation's folder", ORG.a, `${ORG.b}/${file}`],
    ['a global key on an organisation job', ORG.a, `global/${file}`],
    ['an organisation key on a cross-organisation job', null, `${ORG.a}/${file}`],
    ['a path from elsewhere', ORG.a, '../../etc/passwd'],
    ['a file that is not .bin', ORG.a, `${ORG.a}/2026/92000000-0000-4000-8000-000000000001.pdf`],
  ])('rejects %s', async (_label, organizationId, storageKey) => {
    expect(await rejected(create(organizationId, storageKey))).toMatch(CHECK_VIOLATION);
  });
});

describe('report_jobs: outcome consistency', () => {
  const storageKey = `${ORG.a}/2026/92000000-0000-4000-8000-000000000002.bin`;
  const completedAt = new Date(Date.now() + 60_000);
  const create = (data: Record<string, unknown>) => (tx: Tx) =>
    tx.reportJob.createMany({
      data: [{ requestedBy: USER.aManager, organizationId: ORG.a, params: {}, ...data }],
    });

  it.each([
    ['a failure with its code', { status: 'FAILED', errorCode: 'REPORT_TIMEOUT', completedAt }],
    ['a success with its file', { status: 'SUCCEEDED', storageKey, completedAt }],
    ['a running job', { status: 'RUNNING' }],
  ])('accepts %s', async (_label, data) => {
    expect((await inRolledBackTenant(superuser, null, create(data))).count).toBe(1);
  });

  it.each([
    ['a failure without a code', { status: 'FAILED', completedAt }],
    [
      'a success with an error code',
      { status: 'SUCCEEDED', storageKey, errorCode: 'E42', completedAt },
    ],
    ['a success without a file', { status: 'SUCCEEDED', completedAt }],
    ['a failure without completed_at', { status: 'FAILED', errorCode: 'REPORT_TIMEOUT' }],
    ['a success without completed_at', { status: 'SUCCEEDED', storageKey }],
  ])('rejects %s', async (_label, data) => {
    expect(await rejected(create(data))).toMatch(CHECK_VIOLATION);
  });
});

describe('token lifetimes: refresh at most 7 days, password reset at most 1 hour', () => {
  const createdAt = new Date('2026-05-01T08:00:00Z');
  const after = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
  const owner = { userId: USER.aUser1, organizationId: ORG.a, createdAt };
  const refresh = (expiresAt: Date) => (tx: Tx) =>
    tx.refreshToken.createMany({
      data: [{ ...owner, familyId: INCIDENT.a1, tokenHash: Buffer.alloc(32, 7), expiresAt }],
    });
  const reset = (expiresAt: Date) => (tx: Tx) =>
    tx.passwordResetToken.createMany({
      data: [{ ...owner, tokenHash: Buffer.alloc(32, 8), expiresAt }],
    });

  it.each([
    ['a refresh token of exactly 7 days', refresh(after(7 * 24 * 60))],
    ['a password reset token of exactly 1 hour', reset(after(60))],
  ])('accepts %s', async (_label, operation) => {
    expect((await inRolledBackTenant(superuser, null, operation)).count).toBe(1);
  });

  it.each([
    ['a refresh token of 7 days and 1 minute', refresh(after(7 * 24 * 60 + 1))],
    ['a password reset token of 61 minutes', reset(after(61))],
  ])('rejects %s', async (_label, operation) => {
    expect(await rejected(operation)).toMatch(CHECK_VIOLATION);
  });
});

describe('report_jobs.error_code: a code, never a message', () => {
  const create = (errorCode: string | null) => (tx: Tx) =>
    tx.reportJob.createMany({
      data: [{ requestedBy: USER.aManager, organizationId: ORG.a, params: {}, errorCode }],
    });

  it.each([null, 'REPORT_TIMEOUT', 'PDF_RENDER_FAILED', 'E42'])('accepts %s', async (errorCode) => {
    expect((await inRolledBackTenant(superuser, null, create(errorCode))).count).toBe(1);
  });

  it.each([
    ['a message', 'Timeout while rendering report for user a.user1@org-a.test'],
    ['a stack trace', 'Error: boom\n    at render (report.ts:12:5)'],
    ['lower case', 'report_timeout'],
    ['a leading digit', '1_FAILED'],
    ['fewer than three characters', 'E1'],
    ['more than 64 characters', `E${'X'.repeat(64)}`],
  ])('rejects %s', async (_label, errorCode) => {
    expect(await rejected(create(errorCode))).toMatch(CHECK_VIOLATION);
  });
});
