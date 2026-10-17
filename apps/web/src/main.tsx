import '@fontsource-variable/archivo/wdth.css';
import './shared/ui/tokens.css';
import './app/global.css';
import { startApp } from './app/start';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing in index.html');

void startApp(root);
