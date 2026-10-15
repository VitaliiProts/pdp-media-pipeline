import '@fontsource-variable/archivo/wdth.css';
import './shared/ui/tokens.css';
import './app/global.css';
import { setupListeners } from '@reduxjs/toolkit/query';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { initI18n } from './app/i18n';
import { Providers } from './app/Providers';
import { routes } from './app/router';
import { createStore } from './app/store';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing in index.html');

const store = createStore();
// Focus and reconnect events drive `refetchOnFocus` and `skipPollingIfUnfocused`.
setupListeners(store.dispatch);

createRoot(root).render(
  <Providers store={store} i18n={initI18n()}>
    <RouterProvider router={createBrowserRouter(routes)} />
  </Providers>,
);
