import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { compare } from 'bcryptjs';
import { CATEGORIES, sharedMessages } from '@secure360/shared';
import { PrismaClient } from '../../src/generated/prisma/client';
import { createPrismaClient, type DbClient } from '../../src/platform/db/prisma-client';
import { runCategorySeed, seedCategories } from '../../prisma/seed/categories';
import { runDevSeed } from '../../prisma/seed/dev-data';
import { dbError, RLS_VIOLATION } from './helpers/db';
import { deriveUrl, readConnectionUrl } from './setup/env';

// Task 5: the real seeds, run as s360_owner through RLS and the guard triggers, against secure360_seed_test
// (migrated by the global setup, not seeded). The superuser client only inspects and prepares the database.
let owner: DbClient;
let superuser: PrismaClient;
let ownerUrl: string;

beforeAll(() => {
  ownerUrl = readConnectionUrl('seedOwner');
  owner = createPrismaClient(ownerUrl);
  // No global omit: the tests read password_hash to check the bcrypt cost.
  superuser = new PrismaClient({
    adapter: new PrismaPg({ connectionString: readConnectionUrl('seedSuperuser') }),
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await superuser.$disconnect();
});

const allCategories = () => superuser.incidentCategory.findMany({ orderBy: { code: 'asc' } });

describe('db:seed — categories', () => {
  it('is refused by RLS for s360_owner without the ADMIN context', async () => {
    const error = await dbError(
      owner.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.role', 'MANAGER', true)`;
        await tx.incidentCategory.create({
          data: {
            code: 'ZZZ-01',
            groupCode: 'OTHER',
            labelFr: 'x',
            labelEn: 'x',
            defaultSeverity: 'LOW',
            sortOrder: 0,
          },
        });
      }),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it('seeds the 34 shared categories, active, with the shared fr/en labels', async () => {
    const lines: string[] = [];
    expect(await runCategorySeed({ MIGRATION_DATABASE_URL: ownerUrl }, (l) => lines.push(l))).toBe(
      0,
    );
    expect(lines).toEqual([
      'db:seed: categories: 34 inserted, 0 updated, 0 deactivated, 0 unchanged',
    ]);

    const rows = await allCategories();
    expect(rows).toHaveLength(34);
    expect(rows.every((row) => row.isActive)).toBe(true);
    for (const [index, category] of CATEGORIES.entries()) {
      expect(rows.find((row) => row.code === category.code)).toEqual({
        code: category.code,
        groupCode: category.group,
        labelFr: sharedMessages.fr.categories[category.code],
        labelEn: sharedMessages.en.categories[category.code],
        defaultSeverity: category.defaultSeverity,
        isActive: true,
        sortOrder: index + 1,
      });
    }
  });

  it('keeps typographic apostrophes and seeds MOB-02 (SIM swap) as CRITICAL', async () => {
    const rows = await allCategories();
    const msg01 = rows.find((row) => row.code === 'MSG-01');
    expect(msg01?.labelFr).toContain('’');
    expect(msg01?.labelFr).not.toContain("'");
    expect(rows.find((row) => row.code === 'MOB-02')?.defaultSeverity).toBe('CRITICAL');
  });

  it('changes nothing on a second run', async () => {
    const before = await allCategories();
    expect(await seedCategories(owner)).toEqual({
      inserted: 0,
      updated: 0,
      deactivated: 0,
      unchanged: 34,
    });
    expect(await allCategories()).toEqual(before);
  });

  it('restores labels but never overwrites a tuned default_severity', async () => {
    await superuser.incidentCategory.update({
      where: { code: 'MSG-01' },
      data: { defaultSeverity: 'LOW', labelFr: 'Libellé modifié', sortOrder: 99 },
    });
    expect((await seedCategories(owner)).updated).toBe(1);
    const row = await superuser.incidentCategory.findUniqueOrThrow({ where: { code: 'MSG-01' } });
    expect(row.defaultSeverity).toBe('LOW');
    expect(row.labelFr).toBe(sharedMessages.fr.categories['MSG-01']);
    expect(row.sortOrder).toBe(1);
    await superuser.incidentCategory.update({
      where: { code: 'MSG-01' },
      data: { defaultSeverity: 'MEDIUM' },
    });
  });

  it('deactivates a code that is no longer in shared, without deleting it', async () => {
    await superuser.incidentCategory.create({
      data: {
        code: 'ZZZ-99',
        groupCode: 'OTHER',
        labelFr: 'Ancienne catégorie',
        labelEn: 'Former category',
        defaultSeverity: 'LOW',
        sortOrder: 99,
      },
    });
    expect((await seedCategories(owner)).deactivated).toBe(1);
    const removed = await superuser.incidentCategory.findUnique({ where: { code: 'ZZZ-99' } });
    expect(removed?.isActive).toBe(false);
    expect(await superuser.incidentCategory.count({ where: { isActive: true } })).toBe(34);
    // A third run leaves it deactivated and changes nothing.
    expect(await seedCategories(owner)).toEqual({
      inserted: 0,
      updated: 0,
      deactivated: 0,
      unchanged: 34,
    });
  });
});

// Generated per run, never stored: no password in the repository (AGENTS rule 6).
const devPassword = `Dev-${randomBytes(12).toString('base64url')}-Aa1`;

const devEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  MIGRATION_DATABASE_URL: ownerUrl,
  DEV_SEED_PASSWORD: devPassword,
  ...overrides,
});

async function runCaptured(env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const chunks: string[] = [];
  const capture = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(capture);
  const err = jest.spyOn(process.stderr, 'write').mockImplementation(capture);
  try {
    const code = await runDevSeed(env, (line) => lines.push(line));
    return { code, output: [...lines, ...chunks].join('\n') };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe('db:seed:dev — refusals', () => {
  // Overrides are functions: the owner URL is only known once the global setup has run.
  it.each([
    ['NODE_ENV is production', () => ({ NODE_ENV: 'production' }), /NODE_ENV is production/],
    [
      'a database that is not secure360 or *_test',
      () => ({
        MIGRATION_DATABASE_URL: deriveUrl(new URL(ownerUrl), { database: 'secure360_prod' }),
      }),
      /database "secure360_prod" is neither secure360 nor a \*_test database/,
    ],
    [
      'DEV_SEED_PASSWORD is missing',
      () => ({ DEV_SEED_PASSWORD: undefined }),
      /DEV_SEED_PASSWORD is not set/,
    ],
    [
      'DEV_SEED_PASSWORD is the placeholder',
      () => ({ DEV_SEED_PASSWORD: 'CHANGE_ME' }),
      /fails the password policy/,
    ],
  ])('refuses when %s, and says why', async (_label, overrides, reason) => {
    const { code, output } = await runCaptured(devEnv(overrides()));
    expect(code).toBe(1);
    expect(output).toMatch(/^db:seed:dev refused: /);
    expect(output).toMatch(reason);
    expect(await superuser.user.count()).toBe(0);
    expect(await superuser.organization.count()).toBe(0);
  });
});

const snapshot = async () => ({
  organizations: await superuser.organization.findMany({ orderBy: { id: 'asc' } }),
  users: await superuser.user.findMany({ orderBy: { id: 'asc' } }),
  incidents: await superuser.incident.findMany({ orderBy: { id: 'asc' } }),
  history: await superuser.incidentStatusHistory.findMany({ orderBy: { id: 'asc' } }),
  messages: await superuser.incidentMessage.findMany({ orderBy: { id: 'asc' } }),
  counters: await superuser.incidentReferenceCounter.findMany(),
  categories: await allCategories(),
});

describe('db:seed:dev — fictitious data', () => {
  let firstOutput = '';

  beforeAll(async () => {
    const { code, output } = await runCaptured(devEnv());
    firstOutput = output;
    expect(code).toBe(0);
  }, 120_000);

  it('creates SFC (the only PROVIDER) and four client organisations', async () => {
    const orgs = await superuser.organization.findMany();
    expect(orgs).toHaveLength(5);
    expect(orgs.filter((org) => org.type === 'PROVIDER').map((org) => org.name)).toEqual([
      'Security First Cameroon',
    ]);
    expect(orgs.find((org) => org.name === 'Kamdem Distribution SARL')).toMatchObject({
      type: 'COMPANY',
      city: 'Douala',
    });
  });

  it('creates the personas with fictitious contacts and bcrypt cost-12 hashes', async () => {
    const users = await superuser.user.findMany({ include: { organization: true } });
    const byName = Object.fromEntries(users.map((u) => [`${u.firstName} ${u.lastName}`, u]));
    expect(byName['Aimé Kamga']).toMatchObject({ role: 'USER' });
    expect(byName['Aimé Kamga']?.organization.name).toBe('Kamdem Distribution SARL');
    expect(byName['Paul Ndoumou']?.organization.name).toBe('Kamdem Distribution SARL');
    expect(byName['Paul Ndoumou']?.role).toBe('MANAGER');
    expect(byName['Christelle Biya']).toMatchObject({ role: 'MANAGER' });
    expect(byName['Christelle Biya']?.organization.type).toBe('ADMINISTRATION');
    expect(byName['Jean-Paul Nguemo']?.role).toBe('TECHNICIAN');
    expect(byName['Rodrigue Essomba']?.role).toBe('ADMIN');
    expect(users).toHaveLength(7);
    for (const user of users) {
      expect(user.email).toMatch(/@example\.com$/);
      expect(user.phone).toMatch(/^\+237000000\d{3}$/);
      expect(user.passwordHash).toMatch(/^\$2b\$12\$/);
      expect(user.mustChangePassword).toBe(true);
    }
    expect(await compare(devPassword, byName['Aimé Kamga']?.passwordHash ?? '')).toBe(true);
  });

  it('creates incidents across categories and every status, with their timelines', async () => {
    const incidents = await superuser.incident.findMany({ include: { statusHistory: true } });
    expect(incidents).toHaveLength(6);
    expect(new Set(incidents.map((i) => i.status))).toEqual(
      new Set(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
    );
    expect(new Set(incidents.map((i) => i.categoryCode.slice(0, 3))).size).toBe(6);
    for (const incident of incidents) {
      expect(incident.reference).toMatch(/^SFC-\d{4}-\d{6}$/);
      // Creation entry plus one entry per transition.
      expect(incident.statusHistory).toHaveLength(incident.version);
    }
  });

  it('stores Aimé’s Mobile Money fraud as confidential', async () => {
    const aime = await superuser.user.findUniqueOrThrow({
      where: { email: 'aime.kamga@example.com' },
    });
    const fraud = await superuser.incident.findFirstOrThrow({
      where: { reporterId: aime.id, categoryCode: 'FRD-03' },
    });
    expect(fraud.isAnonymous).toBe(true);
    expect(fraud.severity).toBe('CRITICAL');
  });

  it('never prints the password or a hash', () => {
    expect(firstOutput).toContain('db:seed:dev: users: 7 created');
    expect(firstOutput).not.toContain(devPassword);
    expect(firstOutput).not.toMatch(/\$2[aby]\$/);
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot();
    const { code, output } = await runCaptured(devEnv());
    expect(code).toBe(0);
    expect(output).toContain('organisations: 0 created, 0 updated, 5 unchanged');
    expect(output).toContain('users: 0 created, 0 updated, 7 unchanged');
    expect(output).toContain('incidents: 0 created, 6 already present');
    expect(await snapshot()).toEqual(before);
  }, 60_000);
});
