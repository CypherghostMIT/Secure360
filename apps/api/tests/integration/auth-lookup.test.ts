import type { DbClient } from '../../src/platform/db/prisma-client';
import { connectAs, dbError, PERMISSION_DENIED } from './helpers/db';
import { EMAIL, ORG, USER } from './setup/fixtures';

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

// Exactly the login fields of L2 Table 14: no names, phone, e-mail or other columns.
const LOGIN_FIELDS = [
  'id',
  'organization_id',
  'role',
  'password_hash',
  'totp_secret_enc',
  'totp_last_step',
  'is_2fa_enabled',
  'must_change_password',
  'locked_until',
  'is_active',
  'session_version',
  'organization_is_active',
];

const lookup = (db: DbClient, email: string) =>
  db.$queryRaw<Record<string, unknown>[]>`SELECT * FROM auth_find_user_by_email(${email})`;

describe('auth_find_user_by_email (SECURITY DEFINER)', () => {
  it('finds a user before authentication, case-insensitively, with only the login fields', async () => {
    const rows = await lookup(app, EMAIL.aUser1.toUpperCase());
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([...LOGIN_FIELDS].sort());
    expect(rows[0]).toMatchObject({
      id: USER.aUser1,
      organization_id: ORG.a,
      role: 'USER',
      is_active: true,
    });
  });

  it('returns nothing for an unknown e-mail', async () => {
    expect(await lookup(app, 'nobody@org-a.test')).toEqual([]);
  });

  it('does not open the users table itself to a context-free caller', async () => {
    expect(await app.user.count()).toBe(0);
  });

  it('cannot be executed by the worker or metrics roles', async () => {
    expect(await dbError(lookup(worker, EMAIL.aUser1))).toMatch(PERMISSION_DENIED);
    expect(await dbError(lookup(metrics, EMAIL.aUser1))).toMatch(PERMISSION_DENIED);
  });

  it('is SECURITY DEFINER with a fixed search_path and no PUBLIC execute', async () => {
    const [fn] = await superuser.$queryRaw<
      { prosecdef: boolean; proconfig: string[]; public_exec: boolean }[]
    >`
      SELECT p.prosecdef, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p WHERE p.proname = 'auth_find_user_by_email'`;
    expect(fn).toEqual({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, public, pg_temp'],
      public_exec: false,
    });
  });
});
