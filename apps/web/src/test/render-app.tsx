import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { initI18n } from '../app/i18n';
import { Providers } from '../app/Providers';
import { routes } from '../app/router';
import { createStore } from '../app/store';
import { API_KEY_STORAGE_KEY } from '../features/api-key';

export { TEST_API_KEY } from './fixtures';

export function renderApp({ apiKey, route = '/jobs' }: { apiKey?: string; route?: string } = {}) {
  if (apiKey) window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  const store = createStore(window.localStorage);
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const user = userEvent.setup();
  const view = render(
    <Providers store={store} i18n={initI18n('en')}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, store, user, router };
}
