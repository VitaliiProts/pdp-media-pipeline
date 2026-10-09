import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';
import { initI18n } from '../app/i18n';
import { Providers } from '../app/Providers';
import { createStore } from '../app/store';
import { API_KEY_STORAGE_KEY } from '../features/api-key';

export const TEST_API_KEY = 'pdp_test_key';

export function renderApp({ apiKey }: { apiKey?: string } = {}) {
  if (apiKey) window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  const store = createStore(window.localStorage);
  const user = userEvent.setup();
  const view = render(
    <Providers store={store} i18n={initI18n('en')}>
      <App />
    </Providers>,
  );
  return { ...view, store, user };
}
