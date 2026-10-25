import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  CATEGORIES,
  INCIDENT_STATUSES,
  LANGUAGES,
  ORGANIZATION_TYPES,
  SEVERITIES,
  SUBSCRIPTION_PLANS,
  USER_ROLES,
} from '@secure360/shared';
import type { DbClient } from '../../src/platform/db/prisma-client';
import { connectAs, inRolledBackTenant } from './helpers/db';
import { readConnectionUrl } from './setup/env';

let superuser: DbClient;

beforeAll(() => {
  superuser = connectAs('superuser');
});

afterAll(async () => {
  await superuser.$disconnect();
});

async function enumValues(typeName: string): Promise<string[]> {
  const rows = await superuser.$queryRaw<{ enumlabel: string }[]>`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = ${typeName} ORDER BY e.enumsortorder`;
  return rows.map((row) => row.enumlabel);
}

describe('database enums equal packages/shared (single source of truth)', () => {
  it.each([
    ['severity', SEVERITIES],
    ['incident_status', INCIDENT_STATUSES],
    ['user_role', USER_ROLES],
    ['organization_type', ORGANIZATION_TYPES],
    ['subscription_plan', SUBSCRIPTION_PLANS],
    ['language', LANGUAGES],
  ])('%s', async (typeName, expected) => {
    expect(await enumValues(typeName)).toEqual([...expected]);
  });

  it('accepts every shared category code and default severity', async () => {
    const inserted = await inRolledBackTenant(superuser, null, (tx) =>
      tx.incidentCategory.createMany({
        data: CATEGORIES.filter((c) => !['MSG-01', 'MOB-02'].includes(c.code)).map((c, i) => ({
          code: c.code,
          groupCode: c.group,
          labelFr: c.code,
          labelEn: c.code,
          defaultSeverity: c.defaultSeverity,
          sortOrder: i,
        })),
      }),
    );
    expect(inserted.count).toBe(CATEGORIES.length - 2);
  });
});

describe('migrations and schema.prisma', () => {
  it('have no drift: the migrated database matches the Prisma schema', async () => {
    const cli = require.resolve('prisma/build/index.js');
    const args = [
      cli,
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ];
    // --exit-code: 0 when empty, 2 when the schema and the database differ.
    const { stdout } = await promisify(execFile)(process.execPath, args, {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: readConnectionUrl('owner'),
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
    });
    expect(stdout).toMatch(/No difference detected/);
  });
});
