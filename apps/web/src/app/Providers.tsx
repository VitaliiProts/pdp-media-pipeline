import { type i18n } from 'i18next';
import { type ReactNode, StrictMode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { type AppStore } from './store';

type ProvidersProps = { store: AppStore; i18n: i18n; children: ReactNode };

export function Providers({ store, i18n, children }: ProvidersProps) {
  return (
    <StrictMode>
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </Provider>
    </StrictMode>
  );
}
