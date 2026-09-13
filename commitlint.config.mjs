/**
 * Conventional commits: `type(scope): subject`
 *
 *   feat(billing): add credit notes
 *   fix(auth): reject portal sessions on team functions
 *   chore: bump convex to 1.46.0
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'style', 'content', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
  },
};
