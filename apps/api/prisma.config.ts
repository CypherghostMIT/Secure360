// Prisma CLI configuration (Prisma 7). Only the CLI reads this file; the running API and worker connect through
// a driver adapter with their own least-privilege URL and never see the owner URL.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env. Local development only: CI and production set the variables themselves.
// loadEnvFile never overrides a variable that is already set, so an explicit MIGRATION_DATABASE_URL wins.
const localEnvFile = path.resolve(__dirname, '../../.env');
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations run as s360_owner (L2 Table 13). process.env rather than env(): env() throws when the
    // variable is unset, which would break `prisma generate` in jobs that have no database.
    url: process.env['MIGRATION_DATABASE_URL'] ?? '',
  },
});
