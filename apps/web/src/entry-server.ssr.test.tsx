import { type Manifest } from 'vite';
import { prerender, PRERENDERED_PAGES, renderPage } from './entry-server';

const TEMPLATE = [
  '<!doctype html><html lang="en"><head><title>PDP Media Pipeline</title>',
  '<script type="module" crossorigin src="/assets/index.js"></script>',
  '<link rel="stylesheet" crossorigin href="/assets/index.css">',
  '</head><body><div id="root"></div></body></html>',
].join('');

/** Every page chunk imports a shared one; the entry already links `index.*`. */
const MANIFEST: Manifest = {
  'index.html': { file: 'assets/index.js', css: ['assets/index.css'], isEntry: true },
  _shared: { file: 'assets/shared.js', css: ['assets/shared.css'], imports: ['index.html'] },
  ...Object.fromEntries(
    PRERENDERED_PAGES.map(({ module }) => [
      module,
      { file: `assets/${module}.js`, css: [`assets/${module}.css`], imports: ['_shared'] },
    ]),
  ),
};

const textOf = (html: string, tag: string) =>
  new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(html)?.[1];

describe('prerender', () => {
  it('runs where no browser global exists', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });

  it('renders the sign-in form into the HTML', async () => {
    const html = await renderPage('/login');
    expect(textOf(html, 'h1')).toBe('Sign in');
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autoComplete="email"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="current-password"/);
    expect(html).toContain('<button type="submit"');
    // The form itself, not a placeholder waiting for the session check.
    expect(html).not.toContain('aria-busy');
  });

  it('renders the sign-up form into the HTML', async () => {
    const html = await renderPage('/register');
    expect(textOf(html, 'h1')).toBe('Create an account');
    expect(html).toMatch(/<input[^>]*autoComplete="name"/);
    expect(html).toMatch(/<input[^>]*autoComplete="new-password"/);
  });

  it('renders what the service does on the landing page', async () => {
    const html = await renderPage('/');
    expect(textOf(html, 'h1')).toBe('Media pipeline');
    expect(html).toContain('API and webhooks');
    expect(html).toContain('href="/register"');
  });

  it('writes every page with its markup, title and chunks', async () => {
    const files = await prerender(TEMPLATE, MANIFEST);
    expect(files.map(({ file }) => file)).toEqual([
      'index.html',
      'login/index.html',
      'register/index.html',
    ]);

    for (const [i, { path, module }] of PRERENDERED_PAGES.entries()) {
      const html = files[i]?.html ?? '';
      expect(html).toContain(`<div id="root" data-prerendered="${path}"><`);
      expect(textOf(html, 'title')).toBe(`${textOf(html, 'h1')} — PDP Media Pipeline`);
      expect(html).toContain(`<link rel="stylesheet" crossorigin href="/assets/${module}.css">`);
      expect(html).toContain(`<link rel="stylesheet" crossorigin href="/assets/shared.css">`);
      expect(html).toContain(`<link rel="modulepreload" crossorigin href="/assets/${module}.js">`);
      // The template links the entry already.
      expect(html.match(/assets\/index\.(js|css)"/g)).toHaveLength(2);
    }
  });

  it('refuses a template it cannot fill and a page missing from the manifest', async () => {
    await expect(prerender('<html><head></head><body></body></html>', MANIFEST)).rejects.toThrow(
      /#root|<title>/,
    );
    await expect(prerender(TEMPLATE, {})).rejects.toThrow(/not in the client manifest/);
  });
});
