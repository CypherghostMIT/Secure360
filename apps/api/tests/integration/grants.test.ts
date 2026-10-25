import type { DbClient } from '../../src/platform/db/prisma-client';
import {
  connectAs,
  dbError,
  inRolledBackTenant,
  PERMISSION_DENIED,
  RLS_VIOLATION,
} from './helpers/db';
import { CONTEXT, ORG, USER } from './setup/fixtures';

let superuser: DbClient;
let app: DbClient;
let worker: DbClient;
let metrics: DbClient;

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

// The complete, intended table-level privilege set (L2 Table 13). Any grant added or removed must update this
// table. Column-level grants do not appear in role_table_grants: EXPECTED_COLUMN_GRANTS pins them.
const EXPECTED_GRANTS: Record<string, Record<string, string>> = {
  s360_app: {
    attachments: 'INSERT,SELECT',
    device_tokens: 'DELETE,INSERT,SELECT,UPDATE',
    idempotency_keys: 'DELETE,INSERT,SELECT',
    incident_categories: 'SELECT,UPDATE',
    incident_messages: 'INSERT,SELECT',
    incident_status_history: 'INSERT,SELECT',
    incidents: 'INSERT,SELECT,UPDATE',
    notifications: 'INSERT,SELECT',
    organizations: 'INSERT,SELECT,UPDATE',
    outbox_events: 'INSERT',
    password_reset_tokens: 'INSERT,SELECT',
    refresh_tokens: 'DELETE,INSERT,SELECT',
    report_jobs: 'INSERT,SELECT',
  },
  s360_worker: {
    audit_logs: 'INSERT',
    device_tokens: 'DELETE,SELECT',
    incident_categories: 'SELECT',
    incidents: 'SELECT',
    notifications: 'INSERT',
    outbox_events: 'SELECT',
    report_jobs: 'SELECT',
  },
};

// Readable users columns: all but password_hash and totp_secret_enc (GLOBAL_OMIT in the Prisma client).
const USERS_READABLE =
  'created_at,email,first_name,id,is_2fa_enabled,is_active,last_login_at,last_name,locked_until,' +
  'must_change_password,organization_id,phone,preferred_language,role,session_version,totp_last_step,updated_at';

// grantee -> table -> privilege -> sorted columns. Only grants made on columns (pg_attribute.attacl).
const EXPECTED_COLUMN_GRANTS: Record<string, Record<string, Record<string, string>>> = {
  s360_app: {
    notifications: { UPDATE: 'is_read' },
    users: {
      // Not the TOTP secret and step, lockout or last login (users_guard_insert fixes the other credential state).
      INSERT:
        'created_at,email,first_name,id,is_2fa_enabled,is_active,last_name,must_change_password,organization_id,' +
        'password_hash,phone,preferred_language,role,session_version,updated_at',
      SELECT: USERS_READABLE,
      UPDATE:
        'email,first_name,is_active,last_name,organization_id,phone,preferred_language,role,updated_at',
    },
  },
  s360_worker: {
    outbox_events: { UPDATE: 'published_at' },
    report_jobs: { UPDATE: 'completed_at,error_code,status,storage_key' },
    users: { SELECT: USERS_READABLE },
  },
};

// grantee -> functions of public it may EXECUTE (extension functions excluded); s360_owner owns them all.
const POLICY_HELPERS = [
  'app_can_notify(p_recipient uuid, p_incident uuid)',
  'app_can_see_incident(p_organization_id uuid, p_reporter_id uuid)',
  'app_is_staff()',
  'app_org_id()',
  'app_role()',
  'app_user_id()',
];
const EXPECTED_ROUTINE_GRANTS: Record<string, string[]> = {
  s360_app: [...POLICY_HELPERS, 'auth_find_user_by_email(p_email text)'],
  s360_worker: POLICY_HELPERS,
};

const RUNTIME_ROLES = ['s360_app', 's360_worker', 's360_metrics'];
const MANAGED_ROLES = ['s360_owner', ...RUNTIME_ROLES];
const GRANTEES = ['PUBLIC', ...RUNTIME_ROLES];

async function tableGrants(): Promise<Record<string, Record<string, string>>> {
  const rows = await superuser.$queryRaw<GrantRow[]>`
    SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee = ANY(${GRANTEES})
     GROUP BY grantee, table_name`;
  const result: Record<string, Record<string, string>> = {};
  for (const row of rows) (result[row.grantee] ??= {})[row.table_name] = row.privileges;
  return result;
}

async function columnGrants(): Promise<Record<string, Record<string, Record<string, string>>>> {
  const rows = await superuser.$queryRaw<(GrantRow & { columns: string })[]>`
    SELECT COALESCE(r.rolname, 'PUBLIC')::text AS grantee, c.relname::text AS table_name,
           acl.privilege_type AS privileges, string_agg(a.attname, ',' ORDER BY a.attname) AS columns
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(a.attacl) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
     WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
       AND COALESCE(r.rolname, 'PUBLIC') = ANY(${GRANTEES})
     GROUP BY 1, 2, 3`;
  const result: Record<string, Record<string, Record<string, string>>> = {};
  for (const row of rows) {
    ((result[row.grantee] ??= {})[row.table_name] ??= {})[row.privileges] = row.columns;
  }
  return result;
}

async function routineGrants(): Promise<Record<string, string[]>> {
  const rows = await superuser.$queryRaw<{ grantee: string; routines: string[] }[]>`
    SELECT COALESCE(r.rolname, 'PUBLIC')::text AS grantee,
           array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' ORDER BY p.proname)
             AS routines
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      LEFT JOIN pg_roles r ON r.oid = acl.grantee
     WHERE n.nspname = 'public' AND acl.privilege_type = 'EXECUTE'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND COALESCE(r.rolname, 'PUBLIC') = ANY(${GRANTEES})
     GROUP BY 1`;
  return Object.fromEntries(rows.map((row) => [row.grantee, row.routines]));
}

describe('table privileges (L2 Table 13)', () => {
  it('match the intended grant table exactly; PUBLIC and s360_metrics have none', async () => {
    expect(await tableGrants()).toEqual(EXPECTED_GRANTS);
  });

  it('match the intended column grants exactly', async () => {
    expect(await columnGrants()).toEqual(EXPECTED_COLUMN_GRANTS);
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

describe('function privileges', () => {
  it('match the intended EXECUTE grants exactly', async () => {
    expect(await routineGrants()).toEqual(EXPECTED_ROUTINE_GRANTS);
  });

  // citext's own functions keep PUBLIC EXECUTE: its operators, used for e-mail comparisons, need them.
  it('give PUBLIC no EXECUTE on any function of the schema, extension functions aside', async () => {
    const rows = await superuser.$queryRaw<{ proname: string }[]>`
      SELECT p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND has_function_privilege('public', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;
    expect(rows).toEqual([]);
  });

  it('pin search_path on every SECURITY DEFINER function', async () => {
    const rows = await superuser.$queryRaw<{ proname: string }[]>`
      SELECT p.proname::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND NOT ('search_path=pg_catalog, public, pg_temp' = ANY (COALESCE(p.proconfig, '{}')))`;
    expect(rows).toEqual([]);
  });
});

describe('database roles', () => {
  it('give no runtime role TEMP on the database', async () => {
    const rows = await superuser.$queryRaw<{ rolname: string }[]>`
      SELECT rolname::text FROM pg_roles
       WHERE rolname = ANY(${RUNTIME_ROLES})
         AND has_database_privilege(rolname, current_database(), 'TEMP')`;
    expect(rows).toEqual([]);
  });

  // Prisma's driver adapter sends Date values without a zone: any other session TimeZone would shift them.
  // The role setting is checked too: the server default may already be UTC, which would hide a missing pin.
  it.each([
    ['app', 's360_app'],
    ['worker', 's360_worker'],
    ['owner', 's360_owner'],
  ] as const)(
    'give the %s connection a UTC session TimeZone, pinned on %s',
    async (connection, role) => {
      const db = connectAs(connection);
      try {
        const rows = await db.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
        expect(rows).toEqual([{ tz: 'UTC' }]);
      } finally {
        await db.$disconnect();
      }
      const pinned = await superuser.$queryRaw<{ pinned: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
         WHERE r.rolname = ${role} AND s.setdatabase = 0 AND 'TimeZone=UTC' = ANY (s.setconfig)
      ) AS pinned`;
      expect(pinned).toEqual([{ pinned: true }]);
    },
  );

  it('make no role a member of another, except s360_metrics in pg_monitor', async () => {
    const rows = await superuser.$queryRaw<{ member: string; role: string }[]>`
      SELECT m.rolname::text AS member, r.rolname::text AS role
        FROM pg_auth_members am
        JOIN pg_roles m ON m.oid = am.member
        JOIN pg_roles r ON r.oid = am.roleid
       WHERE m.rolname = ANY(${MANAGED_ROLES}) OR r.rolname = ANY(${MANAGED_ROLES})
       ORDER BY 1, 2`;
    expect(rows).toEqual([{ member: 's360_metrics', role: 'pg_monitor' }]);
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
