// db:seed — the 34 incident categories of L1 Table 12, for every environment. Codes, groups, default severities
// and order come from CATEGORIES in @secure360/shared, labels from its fr/en messages: nothing is retyped here.
import { CATEGORIES, sharedMessages, type Severity } from '@secure360/shared';
import { createPrismaClient, type DbClient } from '../../src/platform/db/prisma-client';
import { loadLocalEnv, runCli, type WriteLine, writeStderr } from './cli';
import { SEED_ADMIN, type SeedTx, withSeedContext } from './context';

export interface CategorySeedRow {
  code: string;
  groupCode: string;
  labelFr: string;
  labelEn: string;
  defaultSeverity: Severity;
  sortOrder: number;
}

export interface CategorySeedResult {
  inserted: number;
  updated: number;
  deactivated: number;
  unchanged: number;
}

export function categoriesFromShared(): CategorySeedRow[] {
  return CATEGORIES.map((category, index) => ({
    code: category.code,
    groupCode: category.group,
    labelFr: sharedMessages.fr.categories[category.code],
    labelEn: sharedMessages.en.categories[category.code],
    defaultSeverity: category.defaultSeverity,
    sortOrder: index + 1,
  }));
}

type StoredCategory = Awaited<ReturnType<SeedTx['incidentCategory']['findMany']>>[number];

function needsUpdate(stored: StoredCategory, row: CategorySeedRow): boolean {
  return (
    stored.labelFr !== row.labelFr ||
    stored.labelEn !== row.labelEn ||
    stored.groupCode !== row.groupCode ||
    stored.sortOrder !== row.sortOrder ||
    !stored.isActive
  );
}

/**
 * Idempotent: rows are written only when they differ, so a second run changes nothing. default_severity is set on
 * insert only, because SFC may tune it (L1 §7). Rows are never deleted: incidents reference them, so a code that
 * left packages/shared is deactivated instead.
 */
export async function seedCategories(
  db: DbClient,
  rows: CategorySeedRow[] = categoriesFromShared(),
): Promise<CategorySeedResult> {
  return withSeedContext(db, SEED_ADMIN, async (tx) => {
    const stored = new Map((await tx.incidentCategory.findMany()).map((row) => [row.code, row]));
    const result: CategorySeedResult = { inserted: 0, updated: 0, deactivated: 0, unchanged: 0 };
    for (const row of rows) {
      const current = stored.get(row.code);
      if (!current) {
        await tx.incidentCategory.create({ data: { ...row, isActive: true } });
        result.inserted += 1;
      } else if (needsUpdate(current, row)) {
        const { code, defaultSeverity: _keepTuned, ...fields } = row;
        await tx.incidentCategory.update({ where: { code }, data: { ...fields, isActive: true } });
        result.updated += 1;
      } else {
        result.unchanged += 1;
      }
    }
    const codes = new Set(rows.map((row) => row.code));
    const removed = [...stored.values()].filter((row) => row.isActive && !codes.has(row.code));
    for (const row of removed) {
      await tx.incidentCategory.update({ where: { code: row.code }, data: { isActive: false } });
      result.deactivated += 1;
    }
    return result;
  });
}

export function formatCategoryResult(result: CategorySeedResult): string {
  return (
    `categories: ${result.inserted} inserted, ${result.updated} updated, ` +
    `${result.deactivated} deactivated, ${result.unchanged} unchanged`
  );
}

/** Entry point of db:seed. Returns the process exit code. */
export async function runCategorySeed(
  env: NodeJS.ProcessEnv,
  write: WriteLine = writeStderr,
): Promise<number> {
  const url = env['MIGRATION_DATABASE_URL'];
  if (!url) {
    write('db:seed refused: MIGRATION_DATABASE_URL is not set (the seed runs as s360_owner).');
    return 1;
  }
  const db = createPrismaClient(url);
  try {
    write(`db:seed: ${formatCategoryResult(await seedCategories(db))}`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  loadLocalEnv();
  runCli('db:seed', () => runCategorySeed(process.env));
}
