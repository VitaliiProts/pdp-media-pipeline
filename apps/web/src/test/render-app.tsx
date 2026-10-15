import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, type InitialEntry, RouterProvider } from 'react-router';
import { initI18n } from '../app/i18n';
import { Providers } from '../app/Providers';
import { routes } from '../app/router';
import { createStore } from '../app/store';
import { signedOut } from '../features/auth';
import { testSession } from './session';

export function renderApp({
  signedIn = false,
  route = '/jobs',
}: { signedIn?: boolean; route?: InitialEntry } = {}) {
  if (signedIn) testSession.signIn();
  const store = createStore();
  // `cleanup()` only unmounts: without this, upload thunks, RTK timers and late responses keep
  // dispatching into the old store, into later tests and past the end of the jsdom window.
  onTestFinished(() => {
    store.dispatch(signedOut());
  });
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const user = userEvent.setup();
  const view = render(
    <Providers store={store} i18n={initI18n('en')}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, store, user, router };
}
