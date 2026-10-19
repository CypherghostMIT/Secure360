import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  connectAs,
  dbError,
  GUARD_VIOLATION,
  inRolledBackTenant,
  RLS_VIOLATION,
  withTenant,
} from './helpers/db';
import { CONTEXT, FAKE_BCRYPT_HASH, ORG, type TenantContext, USER } from './setup/fixtures';

let app: PrismaClient;

beforeAll(() => {
  app = connectAs('app');
});

afterAll(async () => {
  await app.$disconnect();
});

const visibleUserCount = (ctx: TenantContext) => withTenant(app, ctx, (tx) => tx.user.count());
const visibleOrgIds = (ctx: TenantContext) =>
  withTenant(app, ctx, async (tx) =>
    (await tx.organization.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
      (row) => row.id,
    ),
  );

describe('users RLS', () => {
  it('returns no users without a context', async () => {
    expect(await app.user.count()).toBe(0);
  });

  it('shows a USER only themselves', async () => {
    const rows = await withTenant(app, CONTEXT.aUser1, (tx) =>
      tx.user.findMany({ select: { id: true } }),
    );
    expect(rows).toEqual([{ id: USER.aUser1 }]);
  });

  it('shows a MANAGER their organisation, staff everyone', async () => {
    expect(await visibleUserCount(CONTEXT.aManager)).toBe(3);
    expect(await visibleUserCount(CONTEXT.bManager)).toBe(2);
    expect(await visibleUserCount(CONTEXT.technician)).toBe(7);
  });

  it('lets only an ADMIN create users', async () => {
    const user = {
      organizationId: ORG.a,
      firstName: 'New',
      lastName: 'User',
      email: 'new.user@org-a.test',
      passwordHash: FAKE_BCRYPT_HASH,
      role: 'USER' as const,
    };
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) => tx.user.createMany({ data: [user] })),
    );
    expect(error).toMatch(RLS_VIOLATION);
    const created = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.user.createMany({ data: [user] }),
    );
    expect(created.count).toBe(1);
  });

  it("does not let a MANAGER update another user's row", async () => {
    const result = await inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
      tx.user.updateMany({ where: { id: USER.aUser1 }, data: { firstName: 'Changed' } }),
    );
    expect(result.count).toBe(0);
  });
});

describe('users_guard_update trigger', () => {
  const privilegedChanges = [
    ['role', { role: 'ADMIN' as const }],
    ['organization', { organizationId: ORG.b }],
    ['active flag', { isActive: false }],
    ['e-mail', { email: 'other@org-a.test' }],
  ] as const;

  it.each(privilegedChanges)('stops a USER changing their own %s', async (_label, data) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.user.updateMany({ where: { id: USER.aUser1 }, data }),
      ),
    );
    expect(error).toMatch(GUARD_VIOLATION);
  });

  it.each(privilegedChanges)('stops a MANAGER changing their own %s', async (_label, data) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.user.updateMany({ where: { id: USER.aManager }, data }),
      ),
    );
    expect(error).toMatch(GUARD_VIOLATION);
  });

  it('lets an ADMIN change role, active flag and e-mail', async () => {
    const result = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.user.updateMany({
        where: { id: USER.aUser2 },
        data: { role: 'MANAGER', isActive: false, email: 'renamed@org-a.test' },
      }),
    );
    expect(result.count).toBe(1);
  });

  it('lets an ADMIN move a user who owns no tenant data to another organisation', async () => {
    const result = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.user.updateMany({ where: { id: USER.aManager }, data: { organizationId: ORG.b } }),
    );
    expect(result.count).toBe(1);
  });

  it('lets a user change their own non-privileged columns', async () => {
    const result = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.user.updateMany({
        where: { id: USER.aUser1 },
        data: { preferredLanguage: 'en', firstName: 'Aimé' },
      }),
    );
    expect(result.count).toBe(1);
  });

  it('lets the user and an ADMIN raise session_version', async () => {
    const own = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.user.updateMany({
        where: { id: USER.aUser1 },
        data: { sessionVersion: { increment: 1 } },
      }),
    );
    const byAdmin = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.user.updateMany({
        where: { id: USER.aUser1 },
        data: { sessionVersion: { increment: 1 } },
      }),
    );
    expect([own.count, byAdmin.count]).toEqual([1, 1]);
  });

  it('never lets session_version decrease, even for an ADMIN', async () => {
    for (const ctx of [CONTEXT.aUser1, CONTEXT.admin]) {
      const error = await dbError(
        inRolledBackTenant(app, ctx, async (tx) => {
          await tx.user.updateMany({ where: { id: USER.aUser1 }, data: { sessionVersion: 5 } });
          return tx.user.updateMany({ where: { id: USER.aUser1 }, data: { sessionVersion: 4 } });
        }),
      );
      expect(error).toMatch(/session_version cannot decrease/);
    }
  });
});

describe('organizations RLS', () => {
  it('shows other roles only their own organisation', async () => {
    expect(await visibleOrgIds(CONTEXT.aUser1)).toEqual([ORG.a]);
    expect(await visibleOrgIds(CONTEXT.bManager)).toEqual([ORG.b]);
  });

  it('shows staff every organisation', async () => {
    expect(await visibleOrgIds(CONTEXT.technician)).toEqual([ORG.sfc, ORG.a, ORG.b]);
  });

  it('lets only an ADMIN update an organisation', async () => {
    const byManager = await inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
      tx.organization.updateMany({ where: { id: ORG.a }, data: { city: 'Yaoundé' } }),
    );
    const byAdmin = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.organization.updateMany({ where: { id: ORG.a }, data: { city: 'Yaoundé' } }),
    );
    expect([byManager.count, byAdmin.count]).toEqual([0, 1]);
  });
});
