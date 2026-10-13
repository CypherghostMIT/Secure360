// Conventional Commits: type(scope): subject — e.g. "feat(api): add refresh token rotation".
// The scope says which part of the monorepo changed; it keeps history and release notes readable.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'mobile',
        'web',
        'shared',
        'infra',
        'db',
        'auth',
        'docs',
        'ci',
        'deps',
        'security',
        'release',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
  },
};
