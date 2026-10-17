import { setupListeners } from '@reduxjs/toolkit/query';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, matchRoutes } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { DEFAULT_LANGUAGE, initI18n, storedLanguage } from './i18n';
import { Providers } from './Providers';
import { routes } from './router';
import { type AppStore, createStore } from './store';

/**
 * Lazy pages are resolved before hydration, the way the build resolved them: a router still
 * loading its first chunk renders `HydrateFallback`, which does not match the prerendered HTML.
 */
async function resolveLazyRoutes(): Promise<void> {
  const matches = matchRoutes(routes, window.location) ?? [];
  await Promise.all(
    matches.map(async ({ route }) => {
      if (typeof route.lazy !== 'function') return;
      Object.assign(route, { ...(await route.lazy()), lazy: undefined });
    }),
  );
}

const withoutTrailingSlash = (path: string) => path.replace(/(.)\/+$/, '$1');

/**
 * A page prerendered for this path is hydrated in the language it was built in. Anything else
 * is rendered from scratch in the visitor's language: the empty SPA shell, or another page's
 * HTML from a server that falls back to `index.html` (`vite preview`, a CDN), which would not
 * hydrate.
 */
export async function startApp(root: HTMLElement): Promise<{ reactRoot: Root; store: AppStore }> {
  const builtFor = root.dataset.prerendered;
  const isPrerendered =
    builtFor !== undefined &&
    withoutTrailingSlash(builtFor) === withoutTrailingSlash(window.location.pathname);
  if (!isPrerendered) root.replaceChildren();
  const store = createStore();
  // Focus and reconnect events drive `refetchOnFocus` and `skipPollingIfUnfocused`.
  setupListeners(store.dispatch);
  const i18n = initI18n(isPrerendered ? DEFAULT_LANGUAGE : (storedLanguage() ?? DEFAULT_LANGUAGE));
  document.documentElement.lang = i18n.language;

  if (isPrerendered) await resolveLazyRoutes();
  const app = (
    <Providers store={store} i18n={i18n}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </Providers>
  );
  if (isPrerendered) return { reactRoot: hydrateRoot(root, app), store };
  const reactRoot = createRoot(root);
  reactRoot.render(app);
  return { reactRoot, store };
}
