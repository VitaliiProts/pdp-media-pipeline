/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-app-to-app',
      comment: 'Apps must not import each other; share code through libs/*.',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-lib-to-app',
      comment: 'Libs are leaf dependencies and must not import from apps.',
      severity: 'error',
      from: { path: '^libs/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-deep-lib-import',
      comment: 'Import libs through their package entry (@pdp/*), not by relative path.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^libs/[^/]+/src/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: true,
    preserveSymlinks: true,
  },
};
