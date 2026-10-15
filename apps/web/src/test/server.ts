import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { TEST_API_KEY, TEST_ME } from './fixtures';

export const STORAGE_ORIGIN = 'http://storage.test';

/**
 * Each test declares the handlers it relies on; unknown requests fail the test. Two are
 * shared: every page loads the runtime config (Grafana off by default), and the app shell
 * asks who is signed in, which the test key answers.
 */
export const server = setupServer(
  http.get('/config.json', () => HttpResponse.json({ grafanaUrl: null })),
  http.get('/v1/me', ({ request }) =>
    request.headers.get('x-api-key') === TEST_API_KEY
      ? HttpResponse.json(TEST_ME)
      : HttpResponse.json({ statusCode: 401, message: 'unauthorized' }, { status: 401 }),
  ),
);
