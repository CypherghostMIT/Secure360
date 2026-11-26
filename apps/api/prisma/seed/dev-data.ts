// db:seed:dev — fictitious organisations, personas and incidents for LOCAL development only.
// Everything is written through the RLS policies and guard triggers, under the context of the person who would
// do it in the application (WORKFLOW §3.4): an ADMIN creates tenants and users, a reporter creates their own
// incident, Jean-Paul (TECHNICIAN) triages it.
import { hash } from 'bcryptjs';
import { computeSeverity, INCIDENT_STATUSES, PasswordSchema } from '@secure360/shared';
import { createPrismaClient, type DbClient } from '../../src/platform/db/prisma-client';
import { formatCategoryResult, seedCategories } from './categories';
import { loadLocalEnv, runCli, type WriteLine, writeStderr } from './cli';
import { SEED_ADMIN, type SeedTx, setSeedContext, withSeedContext } from './context';
import {
  DEV_INCIDENTS,
  DEV_ORGANIZATIONS,
  DEV_USERS,
  type DevIncident,
  type DevOrgKey,
  type DevUserKey,
} from './dev-fixtures';

const BCRYPT_COST = 12;

export interface UpsertCounts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface DevSeedResult {
  organizations: UpsertCounts;
  users: UpsertCounts;
  incidents: { created: number; skipped: number };
}

type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The dev seed only ever targets the local database or a test database, never production. */
export function checkDevTarget(env: NodeJS.ProcessEnv): Check<string> {
  if (env['NODE_ENV'] === 'production') return { ok: false, reason: 'NODE_ENV is production.' };
  const url = env['MIGRATION_DATABASE_URL'];
  if (!url) return { ok: false, reason: 'MIGRATION_DATABASE_URL is not set.' };
  let database: string;
  try {
    database = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    return { ok: false, reason: 'MIGRATION_DATABASE_URL is not a valid URL.' };
  }
  if (database !== 'secure360' && !database.endsWith('_test')) {
    return {
      ok: false,
      reason: `database "${database}" is neither secure360 nor a *_test database.`,
    };
  }
  return { ok: true, value: url };
}

/** The password is validated by the same policy as every user password, then only ever hashed. */
export function readSeedPassword(env: NodeJS.ProcessEnv): Check<string> {
  const raw = env['DEV_SEED_PASSWORD'];
  if (!raw) return { ok: false, reason: 'DEV_SEED_PASSWORD is not set (see .env.example).' };
  const parsed = PasswordSchema.safeParse(raw);
  if (!parsed.success) {
    // Issue codes and fixed messages only: Zod's messages never quote the input.
    const rules = parsed.error.issues.map((issue) => issue.message).join('; ');
    return { ok: false, reason: `DEV_SEED_PASSWORD fails the password policy: ${rules}` };
  }
  return { ok: true, value: parsed.data };
}

function differs<T extends object>(stored: T, wanted: Partial<T>): boolean {
  return Object.entries(wanted).some(([key, value]) => stored[key as keyof T] !== value);
}

const emptyCounts = (): UpsertCounts => ({ created: 0, updated: 0, unchanged: 0 });

/** SFC is found by type, not id: PROVIDER is unique, and the platform may already have it. */
async function seedOrganizations(
  tx: SeedTx,
  counts: UpsertCounts,
): Promise<Record<DevOrgKey, string>> {
  const ids = {} as Record<DevOrgKey, string>;
  for (const { key, id, ...fields } of DEV_ORGANIZATIONS) {
    const existing =
      fields.type === 'PROVIDER'
        ? await tx.organization.findFirst({ where: { type: 'PROVIDER' } })
        : await tx.organization.findUnique({ where: { id } });
    ids[key] = existing?.id ?? id;
    if (!existing) {
      await tx.organization.create({ data: { id, ...fields } });
      counts.created += 1;
    } else if (differs(existing, fields)) {
      await tx.organization.update({ where: { id: existing.id }, data: fields });
      counts.updated += 1;
    } else {
      counts.unchanged += 1;
    }
  }
  return ids;
}

/**
 * Upsert by e-mail. The password is hashed only for a new user: rewriting password_hash would raise
 * session_version (users_guard_update) and a second run would no longer change nothing.
 */
async function seedUsers(
  tx: SeedTx,
  orgIds: Record<DevOrgKey, string>,
  password: string,
  counts: UpsertCounts,
): Promise<Record<DevUserKey, string>> {
  const ids = {} as Record<DevUserKey, string>;
  for (const { key, id, org, ...profile } of DEV_USERS) {
    const fields = { ...profile, organizationId: orgIds[org] };
    const existing = await tx.user.findUnique({ where: { email: profile.email } });
    ids[key] = existing?.id ?? id;
    if (!existing) {
      const passwordHash = await hash(password, BCRYPT_COST);
      await tx.user.create({ data: { id, ...fields, passwordHash } });
      counts.created += 1;
    } else if (differs(existing, fields)) {
      await tx.user.update({ where: { id: existing.id }, data: fields });
      counts.updated += 1;
    } else {
      counts.unchanged += 1;
    }
  }
  return ids;
}

interface IncidentActors {
  reporterId: string;
  organizationId: string;
  technicianId: string;
  sfcId: string;
}

async function createAsReporter(tx: SeedTx, incident: DevIncident, actors: IncidentActors) {
  const category = await tx.incidentCategory.findUniqueOrThrow({
    where: { code: incident.categoryCode },
  });
  // Same rule as the API (L1 D3): the stored default, which SFC may have tuned, plus the guided answers.
  const severity = computeSeverity(category.defaultSeverity, incident.answers);
  const created = await tx.incident.create({
    data: {
      id: incident.id,
      organizationId: actors.organizationId,
      reporterId: actors.reporterId,
      categoryCode: incident.categoryCode,
      title: incident.title,
      description: incident.description,
      severity,
      severityInitial: severity,
      severityAnswers: incident.answers,
      isAnonymous: incident.isAnonymous,
      location: incident.location ?? null,
      deviceAffected: incident.deviceAffected ?? null,
      clientRequestId: incident.clientRequestId,
    },
  });
  await tx.incidentStatusHistory.create({
    data: {
      incidentId: created.id,
      organizationId: actors.organizationId,
      toStatus: 'NEW',
      changedBy: actors.reporterId,
    },
  });
  return created;
}

async function triageAsStaff(
  tx: SeedTx,
  incident: DevIncident,
  createdAt: Date,
  actors: IncidentActors,
): Promise<void> {
  const steps = INCIDENT_STATUSES.slice(1, INCIDENT_STATUSES.indexOf(incident.status) + 1);
  if (steps.length === 0) return;
  await setSeedContext(tx, {
    orgId: actors.sfcId,
    userId: actors.technicianId,
    role: 'TECHNICIAN',
  });
  const reached = (status: (typeof steps)[number]) => steps.includes(status);
  // Every timestamp is the database's created_at: the client clock may be behind the database's, which would
  // break the ">= created_at" checks.
  await tx.incident.update({
    where: { id: incident.id },
    data: {
      status: incident.status,
      assignedTo: actors.technicianId,
      acknowledgedAt: createdAt,
      resolvedAt: reached('RESOLVED') ? createdAt : null,
      resolutionNotes: reached('RESOLVED') ? (incident.resolutionNotes ?? null) : null,
      closedAt: reached('CLOSED') ? createdAt : null,
      version: 1 + steps.length,
      updatedAt: createdAt,
    },
  });
  await recordTimeline(tx, incident, steps, actors);
}

async function recordTimeline(
  tx: SeedTx,
  incident: DevIncident,
  steps: readonly (typeof INCIDENT_STATUSES)[number][],
  actors: IncidentActors,
): Promise<void> {
  let fromStatus: (typeof INCIDENT_STATUSES)[number] = 'NEW';
  for (const toStatus of steps) {
    await tx.incidentStatusHistory.create({
      data: {
        incidentId: incident.id,
        organizationId: actors.organizationId,
        fromStatus,
        toStatus,
        changedBy: actors.technicianId,
      },
    });
    fromStatus = toStatus;
  }
  for (const message of incident.staffMessages ?? []) {
    await tx.incidentMessage.create({
      data: {
        incidentId: incident.id,
        organizationId: actors.organizationId,
        senderId: actors.technicianId,
        body: message.body,
        isInternal: message.isInternal,
      },
    });
  }
}

/**
 * One transaction per incident, so a failure never leaves half an incident. The stable key is
 * (reporter, client_request_id), the API's own idempotency barrier: an incident that exists is skipped whole, and
 * no reference number is drawn for it.
 */
async function seedIncident(
  db: DbClient,
  incident: DevIncident,
  actors: IncidentActors,
): Promise<boolean> {
  const reporterCtx = {
    orgId: actors.organizationId,
    userId: actors.reporterId,
    role: DEV_USERS.find((user) => user.key === incident.reporter)?.role ?? 'USER',
  };
  return withSeedContext(db, reporterCtx, async (tx) => {
    const existing = await tx.incident.findFirst({
      where: { reporterId: actors.reporterId, clientRequestId: incident.clientRequestId },
      select: { id: true },
    });
    if (existing) return false;
    const created = await createAsReporter(tx, incident, actors);
    await triageAsStaff(tx, incident, created.createdAt, actors);
    return true;
  });
}

const userOrg = (key: DevUserKey): DevOrgKey => {
  const user = DEV_USERS.find((candidate) => candidate.key === key);
  if (!user) throw new RangeError(`Unknown dev user: ${key}`);
  return user.org;
};

export async function seedDevData(db: DbClient, password: string): Promise<DevSeedResult> {
  const result: DevSeedResult = {
    organizations: emptyCounts(),
    users: emptyCounts(),
    incidents: { created: 0, skipped: 0 },
  };
  const { orgIds, userIds } = await withSeedContext(db, SEED_ADMIN, async (tx) => {
    const orgs = await seedOrganizations(tx, result.organizations);
    return { orgIds: orgs, userIds: await seedUsers(tx, orgs, password, result.users) };
  });
  for (const incident of DEV_INCIDENTS) {
    const actors: IncidentActors = {
      reporterId: userIds[incident.reporter],
      organizationId: orgIds[userOrg(incident.reporter)],
      technicianId: userIds.jeanPaul,
      sfcId: orgIds.sfc,
    };
    if (await seedIncident(db, incident, actors)) result.incidents.created += 1;
    else result.incidents.skipped += 1;
  }
  return result;
}

function formatCounts(name: string, counts: UpsertCounts): string {
  return `${name}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`;
}

/** Entry point of db:seed:dev. Returns the process exit code; never prints the password or a hash. */
export async function runDevSeed(
  env: NodeJS.ProcessEnv,
  write: WriteLine = writeStderr,
): Promise<number> {
  const target = checkDevTarget(env);
  if (!target.ok) {
    write(`db:seed:dev refused: ${target.reason}`);
    return 1;
  }
  const password = readSeedPassword(env);
  if (!password.ok) {
    write(`db:seed:dev refused: ${password.reason}`);
    return 1;
  }
  const db = createPrismaClient(target.value);
  try {
    // Incidents need the categories, and the category seed is idempotent.
    write(`db:seed:dev: ${formatCategoryResult(await seedCategories(db))}`);
    const result = await seedDevData(db, password.value);
    write(`db:seed:dev: ${formatCounts('organisations', result.organizations)}`);
    write(`db:seed:dev: ${formatCounts('users', result.users)}`);
    write(
      `db:seed:dev: incidents: ${result.incidents.created} created, ${result.incidents.skipped} already present`,
    );
    return 0;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  loadLocalEnv();
  runCli('db:seed:dev', () => runDevSeed(process.env));
}
