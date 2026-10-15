import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Same-origin in dev as in compose (nginx): the browser never needs CORS for the API.
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:18080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': gateway, '/docs': gateway },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Room for `asyncUtilTimeout` (setup.ts) when the first test of a file loads its chunks cold.
    testTimeout: 15_000,
    // Stylesheets stay out of jsdom; `?raw` imports still need their text.
    css: { include: [/\.css\?raw$/] },
  },
});
