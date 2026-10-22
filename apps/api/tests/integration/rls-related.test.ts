import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  connectAs,
  dbError,
  FK_VIOLATION,
  inRolledBackTenant,
  PERMISSION_DENIED,
  RLS_VIOLATION,
  type Tx,
  withTenant,
} from './helpers/db';
import { CONTEXT, INCIDENT, MESSAGE, ORG, type TenantContext, USER } from './setup/fixtures';

let app: DbClient;

beforeAll(() => {
  app = connectAs('app');
});

afterAll(async () => {
  await app.$disconnect();
});

const messagesOfA1 = (ctx: TenantContext) =>
  withTenant(app, ctx, async (tx) =>
    (
      await tx.incidentMessage.findMany({
        where: { incidentId: INCIDENT.a1 },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map((row) => row.id),
  );

describe('incident_messages RLS', () => {
  it('hides internal notes from the reporter and the manager', async () => {
    const publicOnly = [MESSAGE.a1Reporter, MESSAGE.a1StaffReply];
    expect(await messagesOfA1(CONTEXT.aUser1)).toEqual(publicOnly);
    expect(await messagesOfA1(CONTEXT.aManager)).toEqual(publicOnly);
  });

  it('shows internal notes to staff', async () => {
    const all = [MESSAGE.a1Reporter, MESSAGE.a1Internal, MESSAGE.a1StaffReply];
    expect(await messagesOfA1(CONTEXT.technician)).toEqual(all);
    expect(await messagesOfA1(CONTEXT.admin)).toEqual(all);
  });

  it('shows nothing of an incident the caller cannot see', async () => {
    expect(await messagesOfA1(CONTEXT.aUser2)).toEqual([]);
    expect(await messagesOfA1(CONTEXT.bUser)).toEqual([]);
    expect(await messagesOfA1(CONTEXT.bManager)).toEqual([]);
  });

  it('lets a reporter post a public message on their own incident', async () => {
    const count = await inRolledBackTenant(app, CONTEXT.aUser1, async (tx) => {
      await tx.incidentMessage.createMany({
        data: [
          {
            incidentId: INCIDENT.a1,
            organizationId: ORG.a,
            senderId: USER.aUser1,
            body: 'More details',
          },
        ],
      });
      return tx.incidentMessage.count({ where: { incidentId: INCIDENT.a1 } });
    });
    expect(count).toBe(3);
  });

  it('rejects an internal note written by a non-staff user', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.incidentMessage.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              senderId: USER.aUser1,
              body: 'x',
              isInternal: true,
            },
          ],
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('rejects a message on an incident the sender cannot see', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser2, (tx) =>
        tx.incidentMessage.createMany({
          data: [
            { incidentId: INCIDENT.a1, organizationId: ORG.a, senderId: USER.aUser2, body: 'x' },
          ],
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('rejects a message posing as another sender', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.incidentMessage.createMany({
          data: [
            { incidentId: INCIDENT.a1, organizationId: ORG.a, senderId: USER.aUser1, body: 'x' },
          ],
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("rejects a child row whose organization_id differs from its incident's (composite FK)", async () => {
    // Staff pass the RLS check on any incident, so this isolates the foreign key.
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.technician, (tx) =>
        tx.incidentMessage.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.b,
              senderId: USER.technician,
              body: 'x',
            },
          ],
        }),
      ),
    );
    expect(error).toMatch(FK_VIOLATION);
  });
});

describe('attachments and status history: same visibility as the parent incident', () => {
  const visible = (ctx: TenantContext) =>
    withTenant(app, ctx, async (tx) => ({
      attachments: (
        await tx.attachment.findMany({
          select: { incidentId: true },
          orderBy: { incidentId: 'asc' },
        })
      ).map((row) => row.incidentId),
      history: (
        await tx.incidentStatusHistory.findMany({
          select: { incidentId: true },
          orderBy: { incidentId: 'asc' },
        })
      ).map((row) => row.incidentId),
    }));

  it('follows the incident visibility for each role', async () => {
    expect(await visible(CONTEXT.aUser1)).toEqual({
      attachments: [INCIDENT.a1],
      history: [INCIDENT.a1, INCIDENT.a2],
    });
    expect(await visible(CONTEXT.aUser2)).toEqual({ attachments: [], history: [INCIDENT.a3] });
    expect(await visible(CONTEXT.aManager)).toEqual({
      attachments: [INCIDENT.a1],
      history: [INCIDENT.a1, INCIDENT.a2, INCIDENT.a3],
    });
    expect(await visible(CONTEXT.bManager)).toEqual({
      attachments: [INCIDENT.b1],
      history: [INCIDENT.b1],
    });
    expect(await visible(CONTEXT.technician)).toEqual({
      attachments: [INCIDENT.a1, INCIDENT.b1],
      history: [INCIDENT.a1, INCIDENT.a2, INCIDENT.a3, INCIDENT.b1],
    });
  });

  it('rejects a status change recorded for another tenant', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.bManager, (tx) =>
        tx.incidentStatusHistory.createMany({
          data: [
            {
              incidentId: INCIDENT.a1,
              organizationId: ORG.a,
              fromStatus: 'NEW',
              toStatus: 'CLOSED',
              changedBy: USER.bManager,
            },
          ],
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe('append-only tables: s360_app has no UPDATE or DELETE', () => {
  it.each([
    [
      'incident_status_history',
      (tx: Tx) => tx.incidentStatusHistory.updateMany({ data: { note: 'rewritten' } }),
    ],
    ['attachments', (tx: Tx) => tx.attachment.updateMany({ data: { width: 1 } })],
    [
      'incident_messages',
      (tx: Tx) => tx.incidentMessage.updateMany({ data: { body: 'rewritten' } }),
    ],
    ['incident_messages (delete)', (tx: Tx) => tx.incidentMessage.deleteMany({})],
    ['incidents (delete)', (tx: Tx) => tx.incident.deleteMany({})],
  ])('%s is denied, even to staff', async (_table, operation) => {
    const error = await dbError(inRolledBackTenant(app, CONTEXT.admin, operation));
    expect(error).toMatch(PERMISSION_DENIED);
  });
});

describe('per-user tables', () => {
  it('shows notifications only to their recipient', async () => {
    const own = await withTenant(app, CONTEXT.aUser1, (tx) => tx.notification.count());
    const manager = await withTenant(app, CONTEXT.aManager, (tx) => tx.notification.count());
    const staff = await withTenant(app, CONTEXT.admin, (tx) => tx.notification.count());
    expect({ own, manager, staff }).toEqual({ own: 1, manager: 0, staff: 0 });
  });

  it('lets the recipient mark a notification read, and only that column', async () => {
    const marked = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.notification.updateMany({ data: { isRead: true } }),
    );
    expect(marked.count).toBe(1);
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
        tx.notification.updateMany({ data: { titleKey: 'notifications.other.title' } }),
      ),
    );
    expect(error).toMatch(PERMISSION_DENIED);
  });

  it('shows device tokens and refresh tokens only to their owner', async () => {
    const counts = await withTenant(app, CONTEXT.aUser1, async (tx) => ({
      devices: await tx.deviceToken.count(),
      refresh: await tx.refreshToken.count(),
    }));
    expect(counts).toEqual({ devices: 1, refresh: 1 });
    const adminCounts = await withTenant(app, CONTEXT.admin, async (tx) => ({
      devices: await tx.deviceToken.count(),
      refresh: await tx.refreshToken.count(),
    }));
    expect(adminCounts).toEqual({ devices: 0, refresh: 0 });
  });

  it('rejects registering a device token for another user', async () => {
    const error = await dbError(
      inRolledBackTenant(app, CONTEXT.aManager, (tx) =>
        tx.deviceToken.createMany({
          data: [
            {
              userId: USER.aUser1,
              organizationId: ORG.a,
              fcmToken: 'fcm-forged',
              platform: 'ANDROID',
            },
          ],
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});
