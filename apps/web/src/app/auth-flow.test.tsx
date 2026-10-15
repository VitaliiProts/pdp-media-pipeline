import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_API_KEY, TEST_ME } from '../test/fixtures';
import { renderApp } from '../test/render-app';
import { server } from '../test/server';

const noJobs = () => http.get('/v1/jobs', () => HttpResponse.json({ items: [], nextCursor: null }));
const noWebhooks = () => http.get('/v1/webhooks', () => HttpResponse.json({ items: [] }));

describe('signing in', () => {
  it('sends a visitor to sign-in and back to where they were going', async () => {
    server.use(noWebhooks());
    const { user, router } = renderApp({ route: '/webhooks' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fwebhooks');

    await user.type(screen.getByLabelText('API key'), TEST_API_KEY);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/webhooks');
  });

  it('ignores a return address that leaves the app', async () => {
    const { user, router } = renderApp({ route: '/login?next=//evil.example' });
    await user.type(await screen.findByLabelText('API key'), TEST_API_KEY);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
  });

  it('skips the form when already signed in', async () => {
    const { router } = renderApp({ apiKey: TEST_API_KEY, route: '/login?next=%2Fsettings' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('explains when the sign-in check itself fails', async () => {
    server.use(http.get('/v1/me', () => HttpResponse.json({ message: 'down' }, { status: 502 })));
    renderApp({ apiKey: TEST_API_KEY, route: '/jobs' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check your sign-in');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks for a key and sends it with every request', async () => {
    const seenKeys: (string | null)[] = [];
    server.use(
      http.get('/v1/jobs', ({ request }) => {
        seenKeys.push(request.headers.get('x-api-key'));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { user } = renderApp();

    await user.type(await screen.findByLabelText('API key'), `  ${TEST_API_KEY} `);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
    expect(seenKeys[0]).toBe(TEST_API_KEY);
    expect(window.localStorage.getItem('pdp.apiKey')).toBe(TEST_API_KEY);
  });

  it('returns to the form when the gateway rejects the stored key', async () => {
    server.use(http.get('/v1/jobs', () => new HttpResponse(null, { status: 401 })));
    renderApp({ apiKey: 'revoked' });

    expect(await screen.findByRole('alert')).toHaveTextContent('rejected this key');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(window.localStorage.getItem('pdp.apiKey')).toBeNull();
  });
});

describe('app shell', () => {
  it('names the page in the tab and marks the current section', async () => {
    server.use(noJobs(), noWebhooks());
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/jobs' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');

    await user.click(within(nav).getByRole('link', { name: 'Webhooks' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Webhooks' });
    expect(heading).toHaveFocus();
    expect(document.title).toBe('Webhooks — PDP Media Pipeline');
  });

  it('shows a not-found page for unknown addresses', async () => {
    renderApp({ route: '/nowhere' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the library' })).toHaveAttribute(
      'href',
      '/library',
    );
  });

  it('signs out an API key from the user menu', async () => {
    server.use(noJobs());
    const { user, router } = renderApp({ apiKey: TEST_API_KEY, route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Account: dev' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(window.localStorage.getItem('pdp.apiKey')).toBeNull();
  });

  it('signs out a session through the gateway', async () => {
    let signedIn = true;
    server.use(
      noJobs(),
      http.get('/v1/me', () =>
        signedIn
          ? HttpResponse.json({ ...TEST_ME, email: 'dev@example.com', authMethod: 'session' })
          : HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
      ),
      http.post('/v1/auth/logout', () => {
        signedIn = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, router } = renderApp({ route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Account: dev@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(signedIn).toBe(false);
    expect(await screen.findByLabelText('API key')).toBeInTheDocument();
  });

  it('closes the user menu with Escape and returns focus to its button', async () => {
    server.use(noJobs());
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/jobs' });
    const trigger = await screen.findByRole('button', { name: 'Account: dev' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
