import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { initI18n } from '../app/i18n';
import { Providers } from '../app/Providers';
import { routes } from '../app/router';
import { createStore } from '../app/store';
import { testSession } from './session';

export function renderApp({
  signedIn = false,
  route = '/jobs',
}: { signedIn?: boolean; route?: string } = {}) {
  if (signedIn) testSession.signIn();
  const store = createStore();
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const user = userEvent.setup();
  const view = render(
    <Providers store={store} i18n={initI18n('en')}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, store, user, router };
}
