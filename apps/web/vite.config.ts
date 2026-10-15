import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

// Same-origin in dev as in compose (nginx): the browser never needs CORS for the API.
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:18080';

/** Tests of the prerender itself run in Node, where no browser global exists. */
const SSR_TESTS = 'src/**/*.ssr.test.{ts,tsx}';

export default defineConfig({
  plugins: [react()],
  // The prerender links each page's lazy chunks and their CSS from it (scripts/prerender.mjs).
  build: { manifest: true },
  server: {
    port: 5173,
    proxy: { '/v1': gateway, '/docs': gateway },
  },
  test: {
    globals: true,
    // Room for `asyncUtilTimeout` (setup.ts) when the first test of a file loads its chunks cold.
    testTimeout: 15_000,
    // Stylesheets stay out of jsdom; `?raw` imports still need their text.
    css: { include: [/\.css\?raw$/] },
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          exclude: [...configDefaults.exclude, SSR_TESTS],
        },
      },
      {
        extends: true,
        test: { name: 'ssr', environment: 'node', include: [SSR_TESTS] },
      },
    ],
  },
});
