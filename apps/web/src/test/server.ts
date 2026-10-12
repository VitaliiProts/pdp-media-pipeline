import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const STORAGE_ORIGIN = 'http://storage.test';

/**
 * Each test declares the handlers it relies on; unknown requests fail the test. The runtime
 * config is the exception: every page loads it, and by default Grafana is not configured.
 */
export const server = setupServer(
  http.get('/config.json', () => HttpResponse.json({ grafanaUrl: null })),
);
