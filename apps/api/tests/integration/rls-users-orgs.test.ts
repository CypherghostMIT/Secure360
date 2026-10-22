import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  connectAs,
  dbError,
  GUARD_VIOLATION,
  inRolledBackTenant,
  RLS_VIOLATION,
  withTenant,
} from './helpers/db';
import { CONTEXT, FAKE_BCRYPT_HASH, ORG, type TenantContext, USER } from './setup/fixtures';

let app: DbClient;
let superuser: DbClient;

beforeAll(() => {
  app = connectAs('app');
  superuser = connectAs('superuser');
});

afterAll(async () => {
  await Promise.all([app, superuser].map((client) => client.$disconnect()));
});

const STAFF_ORG_VIOLATION = /must belong to the PROVIDER organization/;

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
  // A non-staff role, so the change reaches users_guard_update (users_guard_staff_org already rejects a staff
  // role outside the PROVIDER organisation, tested below).
  const privilegedChanges = [
    ['role', { role: 'MANAGER' as const }],
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

  it.each(privilegedChanges)('stops a MANAGER changing their own %s', async (label, data) => {
    const change = label === 'role' ? { role: 'USER' as const } : data;
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.user.updateMany({ where: { id: USER.aManager }, data: change }),
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

  // session_version is not updatable by s360_app (column grant): the auth functions of tasks 12–15 raise it.
  // The trigger rules are exercised as the superuser, which bypasses grants but not triggers.
  it('lets only the user or an ADMIN raise session_version', async () => {
    const raise = (ctx: TenantContext) =>
      inRolledBackTenant(superuser, ctx, (tx) =>
        tx.user.updateMany({
          where: { id: USER.aUser1 },
          data: { sessionVersion: { increment: 1 } },
        }),
      );
    expect([(await raise(CONTEXT.aUser1)).count, (await raise(CONTEXT.admin)).count]).toEqual([
      1, 1,
    ]);
    expect(await dbError(raise(CONTEXT.aManager))).toMatch(
      /may only be raised by the user or an ADMIN/,
    );
  });
});

describe('users_guard_staff_org trigger: staff roles only in the PROVIDER organisation', () => {
  const staffUser = (organizationId: string, role: 'TECHNICIAN' | 'ADMIN') => ({
    organizationId,
    firstName: 'New',
    lastName: 'Staff',
    email: `new.staff.${role.toLowerCase()}@${organizationId.slice(-2)}.test`,
    passwordHash: FAKE_BCRYPT_HASH,
    role,
  });

  it.each(['TECHNICIAN', 'ADMIN'] as const)(
    'rejects creating a client-organisation %s',
    async (role) => {
      const error = await dbError(
        inRolledBackTenant(app, CONTEXT.admin, (tx) =>
          tx.user.createMany({ data: [staffUser(ORG.a, role)] }),
        ),
      );
      expect(error).toMatch(STAFF_ORG_VIOLATION);
    },
  );

  it('accepts staff in the PROVIDER organisation', async () => {
    const created = await inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.user.createMany({ data: [staffUser(ORG.sfc, 'TECHNICIAN')] }),
    );
    expect(created.count).toBe(1);
  });

  it.each([
    ['promoting a client user to TECHNICIAN', USER.aUser1, { role: 'TECHNICIAN' as const }],
    ['moving a TECHNICIAN to a client organisation', USER.technician, { organizationId: ORG.a }],
  ])('rejects %s', async (_label, id, data) => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.admin, (tx) => tx.user.updateMany({ where: { id }, data })),
    );
    expect(error).toMatch(STAFF_ORG_VIOLATION);
  });

  it('stops the PROVIDER organisation changing type while it has staff', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.admin, (tx) =>
        tx.organization.updateMany({ where: { id: ORG.sfc }, data: { type: 'COMPANY' } }),
      ),
    );
    expect(error).toMatch(STAFF_ORG_VIOLATION);
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
