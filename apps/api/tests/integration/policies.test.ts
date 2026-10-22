import type { DbClient } from '../../src/platform/db/prisma-client';
import { connectAs } from './helpers/db';

// Every Row-Level Security policy, exactly (like EXPECTED_GRANTS in grants.test.ts). A denial test cannot catch a
// dropped policy (no policy also denies), and a visibility test does not exist for every table, so any policy
// that is added, removed, re-scoped or rewritten must update this list, which makes the change reviewable.
// Expressions are PostgreSQL's own deparsed form (pg_policies), with whitespace collapsed.
let superuser: DbClient;

beforeAll(() => {
  superuser = connectAs('superuser');
});

afterAll(async () => {
  await superuser.$disconnect();
});

type PolicyRow = [
  table: string,
  policy: string,
  command: string,
  roles: string,
  using: string | null,
  check: string | null,
];

const EXPECTED_POLICIES: PolicyRow[] = [
  [
    'attachments',
    'attachments_insert',
    'INSERT',
    'public',
    null,
    `((uploaded_by = app_user_id()) AND (EXISTS (SELECT 1 FROM incidents i WHERE (i.id = attachments.incident_id))))`,
  ],
  [
    'attachments',
    'attachments_select',
    'SELECT',
    'public',
    `((app_is_staff() OR (organization_id = app_org_id())) AND (EXISTS (SELECT 1 FROM incidents i WHERE (i.id = attachments.incident_id))))`,
    null,
  ],
  ['audit_logs', 'audit_logs_worker_insert', 'INSERT', 's360_worker', null, `true`],
  [
    'device_tokens',
    'device_tokens_own',
    'ALL',
    'public',
    `(user_id = app_user_id())`,
    `(user_id = app_user_id())`,
  ],
  [
    'idempotency_keys',
    'idempotency_keys_own',
    'ALL',
    'public',
    `(user_id = app_user_id())`,
    `(user_id = app_user_id())`,
  ],
  [
    'incident_categories',
    'incident_categories_select',
    'SELECT',
    'public',
    `(app_user_id() IS NOT NULL)`,
    null,
  ],
  [
    'incident_categories',
    'incident_categories_update',
    'UPDATE',
    'public',
    `(app_role() = 'ADMIN'::text)`,
    `(app_role() = 'ADMIN'::text)`,
  ],
  [
    'incident_messages',
    'incident_messages_insert',
    'INSERT',
    'public',
    null,
    `((sender_id = app_user_id()) AND ((NOT is_internal) OR app_is_staff()) AND (EXISTS (SELECT 1 FROM incidents i WHERE (i.id = incident_messages.incident_id))))`,
  ],
  [
    'incident_messages',
    'incident_messages_select',
    'SELECT',
    'public',
    `(((NOT is_internal) OR app_is_staff()) AND (app_is_staff() OR (organization_id = app_org_id())) AND (EXISTS (SELECT 1 FROM incidents i WHERE (i.id = incident_messages.incident_id))))`,
    null,
  ],
  [
    'incident_reference_counters',
    'incident_reference_counters_owner',
    'ALL',
    's360_owner',
    `true`,
    `true`,
  ],
  [
    'incident_status_history',
    'incident_status_history_insert',
    'INSERT',
    'public',
    null,
    `((changed_by = app_user_id()) AND (EXISTS (SELECT 1 FROM incidents i WHERE ((i.id = incident_status_history.incident_id) AND (app_is_staff() OR ((incident_status_history.from_status IS NULL) AND (incident_status_history.to_status = 'NEW'::incident_status) AND (i.reporter_id = app_user_id())))))))`,
  ],
  [
    'incident_status_history',
    'incident_status_history_select',
    'SELECT',
    'public',
    `((app_is_staff() OR (organization_id = app_org_id())) AND (EXISTS (SELECT 1 FROM incidents i WHERE (i.id = incident_status_history.incident_id))))`,
    null,
  ],
  [
    'incidents',
    'incidents_insert',
    'INSERT',
    'public',
    null,
    `((organization_id = app_org_id()) AND (reporter_id = app_user_id()))`,
  ],
  ['incidents', 'incidents_owner_lookup', 'SELECT', 's360_owner', `true`, null],
  [
    'incidents',
    'incidents_select',
    'SELECT',
    'public',
    `app_can_see_incident(organization_id, reporter_id)`,
    null,
  ],
  ['incidents', 'incidents_update', 'UPDATE', 'public', `app_is_staff()`, `app_is_staff()`],
  [
    'notifications',
    'notifications_insert',
    'INSERT',
    'public',
    null,
    `((app_user_id() IS NOT NULL) AND (incident_id IS NOT NULL) AND app_can_notify(user_id, incident_id))`,
  ],
  ['notifications', 'notifications_select', 'SELECT', 'public', `(user_id = app_user_id())`, null],
  [
    'notifications',
    'notifications_update',
    'UPDATE',
    'public',
    `(user_id = app_user_id())`,
    `(user_id = app_user_id())`,
  ],
  ['organizations', 'organizations_auth_lookup', 'SELECT', 's360_owner', `true`, null],
  [
    'organizations',
    'organizations_insert',
    'INSERT',
    'public',
    null,
    `(app_role() = 'ADMIN'::text)`,
  ],
  [
    'organizations',
    'organizations_select',
    'SELECT',
    'public',
    `(app_is_staff() OR (id = app_org_id()))`,
    null,
  ],
  [
    'organizations',
    'organizations_update',
    'UPDATE',
    'public',
    `(app_role() = 'ADMIN'::text)`,
    `(app_role() = 'ADMIN'::text)`,
  ],
  [
    'outbox_events',
    'outbox_events_app_insert',
    'INSERT',
    's360_app',
    null,
    `((app_user_id() IS NOT NULL) AND (app_is_staff() OR (organization_id = app_org_id())))`,
  ],
  ['outbox_events', 'outbox_events_worker_select', 'SELECT', 's360_worker', `true`, null],
  ['outbox_events', 'outbox_events_worker_update', 'UPDATE', 's360_worker', `true`, `true`],
  [
    'password_reset_tokens',
    'password_reset_tokens_own',
    'ALL',
    'public',
    `(user_id = app_user_id())`,
    `(user_id = app_user_id())`,
  ],
  [
    'refresh_tokens',
    'refresh_tokens_own',
    'ALL',
    'public',
    `(user_id = app_user_id())`,
    `(user_id = app_user_id())`,
  ],
  [
    'report_jobs',
    'report_jobs_insert',
    'INSERT',
    'public',
    null,
    `((requested_by = app_user_id()) AND (app_is_staff() OR (organization_id = app_org_id())))`,
  ],
  [
    'report_jobs',
    'report_jobs_select',
    'SELECT',
    'public',
    `((requested_by = app_user_id()) OR app_is_staff())`,
    null,
  ],
  [
    'report_jobs',
    'report_jobs_worker_update',
    'UPDATE',
    's360_worker',
    `((requested_by = app_user_id()) OR app_is_staff())`,
    `(((requested_by = app_user_id()) OR app_is_staff()) AND (app_is_staff() OR (organization_id = app_org_id())))`,
  ],
  ['users', 'users_auth_lookup', 'SELECT', 's360_owner', `true`, null],
  ['users', 'users_insert', 'INSERT', 'public', null, `(app_role() = 'ADMIN'::text)`],
  [
    'users',
    'users_select',
    'SELECT',
    'public',
    `((id = app_user_id()) OR ((app_role() = 'MANAGER'::text) AND (organization_id = app_org_id())) OR app_is_staff())`,
    null,
  ],
  [
    'users',
    'users_update',
    'UPDATE',
    'public',
    `((id = app_user_id()) OR (app_role() = 'ADMIN'::text))`,
    `((id = app_user_id()) OR (app_role() = 'ADMIN'::text))`,
  ],
];

interface PgPolicy {
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

const collapse = (expression: string | null) =>
  expression === null
    ? null
    : expression.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

describe('Row-Level Security policies (L2 Table 14)', () => {
  it('match the intended policy set exactly', async () => {
    const rows = await superuser.$queryRaw<PgPolicy[]>`
      SELECT tablename::text, policyname::text, cmd, roles::text[] AS roles, qual, with_check
        FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`;
    const actual = rows.map((row): PolicyRow => [
      row.tablename,
      row.policyname,
      row.cmd,
      row.roles.join(','),
      collapse(row.qual),
      collapse(row.with_check),
    ]);
    expect(actual).toEqual(EXPECTED_POLICIES);
  });
});
