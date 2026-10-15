import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import { type Manifest } from 'vite';
import { DEFAULT_LANGUAGE, initI18n } from './app/i18n';
import { Providers } from './app/Providers';
import { routes } from './app/router';
import { createStore } from './app/store';
import { pageTitle } from './shared/ui/page-heading/PageHeading';

/**
 * Public pages built into static HTML (ADR-015). `module` is the page's lazy chunk in the client
 * manifest; `titleKey` is its `h1` in the `shell` namespace, so the tab is named before any
 * script runs. The rest of the app needs a session and renders in the browser.
 */
export const PRERENDERED_PAGES = [
  {
    path: '/',
    file: 'index.html',
    module: 'src/pages/landing/LandingPage.tsx',
    titleKey: 'landing.title',
  },
  {
    path: '/login',
    file: 'login/index.html',
    module: 'src/pages/login/LoginPage.tsx',
    titleKey: 'login.title',
  },
  {
    path: '/register',
    file: 'register/index.html',
    module: 'src/pages/register/RegisterPage.tsx',
    titleKey: 'registerPage.title',
  },
] as const;

export type PrerenderedPath = (typeof PRERENDERED_PAGES)[number]['path'];

/** Any origin will do: nothing on these pages reads it, the router only needs a full URL. */
const BUILD_ORIGIN = 'http://prerender.invalid';

/** The page at `path` as the browser's first render will see it: signed out, default language. */
export async function renderPage(path: PrerenderedPath): Promise<string> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(new URL(path, BUILD_ORIGIN)));
  if (context instanceof Response) throw new Error(`${path} answered ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(
    <Providers store={createStore()} i18n={initI18n(DEFAULT_LANGUAGE)}>
      {/* No loaders, so no hydration data: the client resolves the same lazy chunks itself. */}
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </Providers>,
  );
}

/**
 * `<link>`s for the page chunk and every chunk it imports: its CSS, so the page is styled before
 * any script runs, and its JS, so hydration does not wait on a chain of imports. Files the
 * template already links (the entry's) are left out.
 */
function pageAssets(manifest: Manifest, module: string, template: string): string {
  const scripts = new Set<string>();
  const styles = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk || scripts.has(chunk.file)) return;
    scripts.add(chunk.file);
    chunk.css?.forEach((file) => styles.add(file));
    chunk.imports?.forEach(visit);
  };
  visit(module);
  if (scripts.size === 0) throw new Error(`${module} is not in the client manifest`);

  const isNew = (file: string) => !template.includes(`/${file}"`);
  return [
    ...[...styles]
      .filter(isNew)
      .map((file) => `<link rel="stylesheet" crossorigin href="/${file}">`),
    ...[...scripts]
      .filter(isNew)
      .map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`),
  ].join('');
}

const ROOT = '<div id="root"></div>';
const TITLE = /<title>[^<]*<\/title>/;
const HEAD_END = '</head>';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export type PrerenderedFile = { file: string; html: string };

/**
 * `template` is the built `index.html`. Each page gets its markup in `#root`, marked with the
 * path it was built for, its title and its chunks.
 */
export async function prerender(template: string, manifest: Manifest): Promise<PrerenderedFile[]> {
  if (!template.includes(ROOT) || !TITLE.test(template) || !template.includes(HEAD_END)) {
    throw new Error(`index.html needs ${ROOT}, a <title> and ${HEAD_END}`);
  }
  const { t } = initI18n(DEFAULT_LANGUAGE);
  return Promise.all(
    PRERENDERED_PAGES.map(async ({ path, file, module, titleKey }) => {
      const markup = await renderPage(path);
      const title = escapeHtml(pageTitle(t(titleKey, { ns: 'shell' })));
      // Replacer functions: a `$` in the markup is text, not a replacement pattern.
      const html = template
        .replace(TITLE, () => `<title>${title}</title>`)
        .replace(HEAD_END, () => `${pageAssets(manifest, module, template)}${HEAD_END}`)
        .replace(ROOT, () => `<div id="root" data-prerendered="${path}">${markup}</div>`);
      return { file, html };
    }),
  );
}
