import '@fontsource-variable/archivo/wdth.css';
import './shared/ui/tokens.css';
import './app/global.css';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n } from './app/i18n';
import { Providers } from './app/Providers';
import { createStore } from './app/store';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing in index.html');

createRoot(root).render(
  <Providers store={createStore()} i18n={initI18n()}>
    <App />
  </Providers>,
);
