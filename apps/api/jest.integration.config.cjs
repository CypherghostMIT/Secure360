// Integration tests against a real PostgreSQL (L2 §7.4): RLS, grants, constraints and the auth lookup.
// npm run test:integration. Needs TEST_DATABASE_ADMIN_URL (bootstrap superuser, database secure360_test).
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/tests/integration/setup/global-setup.ts',
  testTimeout: 30_000,
};
