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
      name: 'web-one-way-layers',
      comment: 'apps/web layers import downwards only: app -> pages -> features -> shared.',
      severity: 'error',
      from: { path: '^apps/web/src/(shared|features)/' },
      to: { path: '^apps/web/src/(app|pages)/' },
    },
    {
      name: 'web-pages-below-app',
      severity: 'error',
      from: { path: '^apps/web/src/pages/' },
      to: { path: '^apps/web/src/app/' },
    },
    {
      name: 'web-shared-is-leaf',
      severity: 'error',
      from: { path: '^apps/web/src/shared/' },
      to: { path: '^apps/web/src/features/' },
    },
    {
      name: 'web-no-cross-feature',
      comment: 'Features talk through shared or are composed by a page.',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/([^/]+)/', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'web-feature-public-api',
      comment: 'Import a feature through its index.ts.',
      severity: 'error',
      from: { path: '^apps/web/src/(app|pages)/' },
      to: { path: '^apps/web/src/features/[^/]+/.+/' },
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
    exclude: { path: '(^|/)(dist|dist-ssr|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: true,
    preserveSymlinks: true,
  },
};
