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
  reference: 'SFC-2026-000999',
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
    ['malformed reference', { reference: 'SFC-26-1' }],
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
      return tx.incident.createMany({ data: [incident({ reference: 'SFC-2026-000998' })] });
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

describe('incidents.sla_due_at: after creation, at most 21 days later', () => {
  const createdAt = new Date('2026-05-01T08:00:00Z');
  const after = (hours: number) => new Date(createdAt.getTime() + hours * 3_600_000);
  const create = (slaDueAt: Date | null) => (tx: Tx) =>
    tx.incident.createMany({ data: [incident({ createdAt, slaDueAt })] });

  it.each([
    ['no deadline', null],
    ['a 4-hour deadline', after(4)],
    // LOW: 10 business days with public holidays inside, beyond the former 14-day bound.
    ['a 16-day deadline', after(16 * 24)],
    ['a deadline exactly 21 days later', after(21 * 24)],
  ])('accepts %s', async (_label, slaDueAt) => {
    expect((await inRolledBackTenant(superuser, null, create(slaDueAt))).count).toBe(1);
  });

  it.each([
    ['a deadline at creation', after(0)],
    ['a deadline before creation', after(-1)],
    ['a deadline 21 days and 1 hour later', after(21 * 24 + 1)],
  ])('rejects %s', async (_label, slaDueAt) => {
    expect(await rejected(create(slaDueAt))).toMatch(CHECK_VIOLATION);
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
