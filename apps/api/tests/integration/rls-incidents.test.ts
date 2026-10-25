import type { DbClient } from '../../src/platform/db/prisma-client';
import { connectAs, dbError, inRolledBackTenant, RLS_VIOLATION, withTenant } from './helpers/db';
import { CONTEXT, INCIDENT, ORG, type TenantContext, USER } from './setup/fixtures';

let app: DbClient;

beforeAll(() => {
  app = connectAs('app');
});

afterAll(async () => {
  await app.$disconnect();
});

const visibleIncidentIds = (ctx: TenantContext) =>
  withTenant(app, ctx, async (tx) =>
    (await tx.incident.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
      (row) => row.id,
    ),
  );

const newIncident = (organizationId: string, reporterId: string, n: number) => ({
  organizationId,
  reporterId,
  categoryCode: 'MSG-01',
  title: 'New incident',
  description: 'Details',
  severity: 'MEDIUM' as const,
  severityInitial: 'MEDIUM' as const,
  severityAnswers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'no' },
  clientRequestId: `70000000-0000-4000-8000-00000000000${n}`,
});

describe('incidents RLS (L2 Table 14)', () => {
  it('returns no rows without a tenant context (fail closed)', async () => {
    expect(await app.incident.count()).toBe(0);
    expect(await inRolledBackTenant(app, null, (tx) => tx.incident.count())).toBe(0);
  });

  it('shows a USER only their own reports', async () => {
    expect(await visibleIncidentIds(CONTEXT.aUser1)).toEqual([INCIDENT.a1, INCIDENT.a2]);
    expect(await visibleIncidentIds(CONTEXT.aUser2)).toEqual([INCIDENT.a3]);
  });

  it('shows a MANAGER their own organisation only', async () => {
    expect(await visibleIncidentIds(CONTEXT.aManager)).toEqual([
      INCIDENT.a1,
      INCIDENT.a2,
      INCIDENT.a3,
    ]);
    expect(await visibleIncidentIds(CONTEXT.bManager)).toEqual([INCIDENT.b1]);
  });

  it('shows TECHNICIAN and ADMIN every organisation', async () => {
    const all = [INCIDENT.a1, INCIDENT.a2, INCIDENT.a3, INCIDENT.b1];
    expect(await visibleIncidentIds(CONTEXT.technician)).toEqual(all);
    expect(await visibleIncidentIds(CONTEXT.admin)).toEqual(all);
  });

  it("returns nothing for another tenant's incident, even by id", async () => {
    const row = await withTenant(app, CONTEXT.bManager, (tx) =>
      tx.incident.findUnique({ where: { id: INCIDENT.a1 } }),
    );
    expect(row).toBeNull();
  });

  it('ignores a context whose organisation does not match the user', async () => {
    const forged = { ...CONTEXT.aUser1, orgId: ORG.b };
    expect(await visibleIncidentIds(forged)).toEqual([]);
  });

  it('lets a reporter create an incident in their own organisation', async () => {
    const created = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.incident.create({ data: newIncident(ORG.a, USER.aUser1, 1), select: { version: true } }),
    );
    expect(created.version).toBe(1);
  });

  it('rejects an insert with a foreign organization_id (WITH CHECK)', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.incident.createMany({ data: [newIncident(ORG.b, USER.aUser1, 2)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('rejects an insert on behalf of another reporter', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.incident.createMany({ data: [newIncident(ORG.a, USER.aUser1, 3)] }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('lets only staff update incidents', async () => {
    for (const ctx of [CONTEXT.aUser1, CONTEXT.aManager]) {
      const result = await inRolledBackTenant(app, ctx, (tx) =>
        tx.incident.updateMany({ where: { id: INCIDENT.a1 }, data: { severity: 'HIGH' } }),
      );
      expect(result.count).toBe(0);
    }
    const result = await inRolledBackTenant(app, CONTEXT.technician, (tx) =>
      tx.incident.updateMany({ where: { id: INCIDENT.a1 }, data: { severity: 'HIGH' } }),
    );
    expect(result.count).toBe(1);
  });

  it('supports optimistic concurrency on version (L2 §4.4)', async () => {
    const counts = await inRolledBackTenant(app, CONTEXT.technician, async (tx) => {
      const update = () =>
        tx.incident.updateMany({
          where: { id: INCIDENT.b1, version: 1 },
          data: { status: 'ASSIGNED', version: { increment: 1 } },
        });
      const first = await update();
      const stale = await update();
      const row = await tx.incident.findUniqueOrThrow({
        where: { id: INCIDENT.b1 },
        select: { version: true },
      });
      return { first: first.count, stale: stale.count, version: row.version };
    });
    expect(counts).toEqual({ first: 1, stale: 0, version: 2 });
  });
});
