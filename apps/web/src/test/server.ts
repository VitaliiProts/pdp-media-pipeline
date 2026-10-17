import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { TEST_EMAIL, TEST_ME, TEST_PASSWORD } from './fixtures';
import { testSession } from './session';

export const STORAGE_ORIGIN = 'http://storage.test';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const unauthorized = (message: string) =>
  HttpResponse.json({ statusCode: 401, message }, { status: 401 });

/**
 * Each test declares the handlers it relies on; unknown requests fail the test. Shared ones:
 * the runtime config (Grafana off by default) and the session — `/v1/me` answers while
 * `testSession` is signed in, which sign-in with the test credentials and sign-out switch.
 */
export const server = setupServer(
  http.get('/config.json', () => HttpResponse.json({ grafanaUrl: null })),
  http.get('/v1/me', () =>
    testSession.isSignedIn() ? HttpResponse.json(TEST_ME) : unauthorized('unauthorized'),
  ),
  http.post('/v1/auth/login', async ({ request }) => {
    const body: unknown = await request.json();
    if (!isRecord(body) || body.email !== TEST_EMAIL || body.password !== TEST_PASSWORD) {
      return unauthorized('invalid email or password');
    }
    testSession.signIn();
    const { id, name, email, createdAt } = TEST_ME;
    return HttpResponse.json({ id, name, email, createdAt });
  }),
  http.post('/v1/auth/logout', () => {
    testSession.signOut();
    return new HttpResponse(null, { status: 204 });
  }),
);
