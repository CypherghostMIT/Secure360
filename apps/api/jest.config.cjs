/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Integration tests need PostgreSQL: they run with npm run test:integration (jest.integration.config.cjs).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/integration/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.api.ts', '!src/types/**', '!src/generated/**'],
};
