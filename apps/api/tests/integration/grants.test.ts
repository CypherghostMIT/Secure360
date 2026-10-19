import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  connectAs,
  dbError,
  inRolledBackTenant,
  PERMISSION_DENIED,
  RLS_VIOLATION,
} from './helpers/db';
import { CONTEXT, ORG, USER } from './setup/fixtures';

let superuser: PrismaClient;
let app: PrismaClient;
let worker: PrismaClient;
let metrics: PrismaClient;

beforeAll(() => {
  superuser = connectAs('superuser');
  app = connectAs('app');
  worker = connectAs('worker');
  metrics = connectAs('metrics');
});

afterAll(async () => {
  await Promise.all([superuser, app, worker, metrics].map((client) => client.$disconnect()));
});

interface GrantRow {
  grantee: string;
  table_name: string;
  privileges: string;
}

// The complete, intended privilege set (L2 Table 13). Any grant added or removed must update this table.
const EXPECTED_GRANTS: Record<string, Record<string, string>> = {
  s360_app: {
    attachments: 'INSERT,SELECT',
    device_tokens: 'DELETE,INSERT,SELECT,UPDATE',
    idempotency_keys: 'DELETE,INSERT,SELECT',
    incident_categories: 'SELECT,UPDATE',
    incident_messages: 'INSERT,SELECT',
    incident_reference_counters: 'INSERT,SELECT,UPDATE',
    incident_status_history: 'INSERT,SELECT',
    incidents: 'INSERT,SELECT,UPDATE',
    notifications: 'INSERT,SELECT',
    organizations: 'INSERT,SELECT,UPDATE',
    outbox_events: 'INSERT',
    password_reset_tokens: 'INSERT,SELECT,UPDATE',
    refresh_tokens: 'DELETE,INSERT,SELECT,UPDATE',
    report_jobs: 'INSERT,SELECT,UPDATE',
    users: 'INSERT,SELECT,UPDATE',
  },
  s360_worker: {
    audit_logs: 'INSERT',
    device_tokens: 'DELETE,SELECT',
    incident_categories: 'SELECT',
    incidents: 'SELECT',
    notifications: 'INSERT',
    outbox_events: 'SELECT,UPDATE',
    report_jobs: 'SELECT,UPDATE',
    users: 'SELECT',
  },
};

async function tableGrants(): Promise<Record<string, Record<string, string>>> {
  const rows = await superuser.$queryRaw<GrantRow[]>`
    SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 's360_app', 's360_worker', 's360_metrics')
     GROUP BY grantee, table_name`;
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) (result[row.grantee] ??= {})[row.table_name] = row.privileges;
  return result;
}

describe('table privileges (L2 Table 13)', () => {
  it('match the intended grant table exactly; PUBLIC and s360_metrics have none', async () => {
    expect(await tableGrants()).toEqual(EXPECTED_GRANTS);
  });

  it('limit the s360_app UPDATE on notifications to is_read', async () => {
    const rows = await superuser.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
       WHERE grantee = 's360_app' AND table_name = 'notifications' AND privilege_type = 'UPDATE'`;
    expect(rows).toEqual([{ column_name: 'is_read' }]);
  });

  it('enable and force RLS on every application table', async () => {
    const rows = await superuser.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`;
    expect(rows).toEqual([]);
  });

  it('give no runtime role access to the migrations table', async () => {
    const error = await dbError(app.$queryRaw`SELECT count(*) FROM _prisma_migrations`);
    expect(error).toMatch(PERMISSION_DENIED);
  });
});

describe('s360_app', () => {
  it('cannot read or write audit_logs', async () => {
    expect(
      await dbError(inRolledBackTenant(app, CONTEXT.admin, (tx) => tx.auditLog.count())),
    ).toMatch(PERMISSION_DENIED);
    const insert = inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.auditLog.createMany({ data: [{ action: 'user.login.success' }] }),
    );
    expect(await dbError(insert)).toMatch(PERMISSION_DENIED);
  });

  it('can append to outbox_events but not read or update it', async () => {
    const appended = await inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.outboxEvent.createMany({
        data: [{ eventType: 'incident.created', organizationId: ORG.a, payload: {} }],
      }),
    );
    expect(appended.count).toBe(1);
    const read = inRolledBackTenant(app, CONTEXT.admin, (tx) => tx.outboxEvent.count());
    expect(await dbError(read)).toMatch(PERMISSION_DENIED);
    const update = inRolledBackTenant(app, CONTEXT.admin, (tx) =>
      tx.outboxEvent.updateMany({ data: { publishedAt: new Date() } }),
    );
    expect(await dbError(update)).toMatch(PERMISSION_DENIED);
  });

  it('cannot append an event for another tenant or without a context', async () => {
    const foreign = inRolledBackTenant(app, CONTEXT.aUser1, (tx) =>
      tx.outboxEvent.createMany({
        data: [{ eventType: 'incident.created', organizationId: ORG.b, payload: {} }],
      }),
    );
    expect(await dbError(foreign)).toMatch(RLS_VIOLATION);
    const noContext = app.outboxEvent.createMany({
      data: [{ eventType: 'incident.created', organizationId: ORG.a, payload: {} }],
    });
    expect(await dbError(noContext)).toMatch(RLS_VIOLATION);
  });
});

describe('s360_worker', () => {
  it('reads every pending outbox event and marks them published', async () => {
    const result = await inRolledBackTenant(worker, null, async (tx) => {
      const pending = await tx.outboxEvent.count({ where: { publishedAt: null } });
      const marked = await tx.outboxEvent.updateMany({
        where: { publishedAt: null },
        data: { publishedAt: new Date() },
      });
      return { pending, marked: marked.count };
    });
    expect(result).toEqual({ pending: 1, marked: 1 });
  });

  it('inserts audit events but can never read, update or delete them', async () => {
    const inserted = await inRolledBackTenant(worker, null, (tx) =>
      tx.auditLog.createMany({
        data: [{ userId: USER.aUser1, organizationId: ORG.a, action: 'incident.create.success' }],
      }),
    );
    expect(inserted.count).toBe(1);
    for (const operation of [
      worker.auditLog.count(),
      worker.auditLog.updateMany({ data: { action: 'user.login.failure' } }),
      worker.auditLog.deleteMany({}),
    ]) {
      expect(await dbError(operation)).toMatch(PERMISSION_DENIED);
    }
  });

  it('cannot delete outbox events (purge belongs to the maintenance task)', async () => {
    expect(await dbError(worker.outboxEvent.deleteMany({}))).toMatch(PERMISSION_DENIED);
  });
});

describe('s360_metrics', () => {
  it('has no access to any application table', async () => {
    for (const operation of [
      metrics.incident.count(),
      metrics.user.count(),
      metrics.auditLog.count(),
    ]) {
      expect(await dbError(operation)).toMatch(PERMISSION_DENIED);
    }
  });
});
