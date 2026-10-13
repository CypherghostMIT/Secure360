// Root ESLint configuration (flat config) for the whole monorepo.
// apps/mobile and apps/web add their React rules in their own eslint.config.mjs,
// importing this file, so the security and quality baseline is identical everywhere.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      '**/prisma/migrations/**',
      'design/**',
      'docs/reference/**',
      '.taskmaster/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  security.configs.recommended,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      // Project coding standards (instructions §8)
      'no-console': 'error', // use Pino; structured logs only
      '@typescript-eslint/no-explicit-any': 'error', // justify with an eslint-disable comment + reason
      '@typescript-eslint/no-floating-promises': 'error', // unhandled rejections crash Node / lose audit events
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      // Math.random() is never acceptable for tokens, ids or codes (OWASP M10)
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use crypto.randomUUID()/randomBytes() (Node) or expo-crypto (mobile).',
        },
      ],
      // Noisy rule of eslint-plugin-security: TypeScript + Zod already constrain object keys
      'security/detect-object-injection': 'off',
    },
  },

  // ---- Layered architecture (L2 §5.2): enforced mechanically, not by memory ----
  {
    files: ['apps/api/src/**/*.controller.ts', 'apps/api/src/**/*.router.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.repository', '**/repositories/**'],
              message: 'Controllers/routers call services, never repositories.',
            },
            {
              group: ['@prisma/client', '**/platform/db/**'],
              message: 'No data access in the HTTP layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'express',
              message: 'Services must not depend on HTTP: receive plain data, return plain data.',
            },
          ],
          patterns: [{ group: ['**/*.controller'], message: 'Services never import controllers.' }],
        },
      ],
    },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@react-native-async-storage/async-storage',
              message:
                'Tokens go in expo-secure-store; offline data in encrypted MMKV (OWASP M1/M9).',
            },
          ],
        },
      ],
    },
  },

  // Plain JS config files are not part of a TS project: no type-aware rules there.
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },

  // Repository tooling scripts read local files and spawn npm by design
  {
    files: ['scripts/**'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-child-process': 'off',
    },
  },

  // Tests may use console and long functions
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/tests/**'],
    rules: { 'no-console': 'off', 'max-lines-per-function': 'off' },
  },

  prettier,
);
