import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_EMAIL, TEST_PASSWORD } from '../test/fixtures';
import { renderApp } from '../test/render-app';
import { server } from '../test/server';
import { testSession } from '../test/session';

const noJobs = () => http.get('/v1/jobs', () => HttpResponse.json({ items: [], nextCursor: null }));
const noWebhooks = () => http.get('/v1/webhooks', () => HttpResponse.json({ items: [] }));

async function signIn(user: ReturnType<typeof renderApp>['user'], password = TEST_PASSWORD) {
  await user.type(await screen.findByLabelText('Email'), TEST_EMAIL);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in', () => {
  it('sends a visitor to sign in and back to the page they asked for', async () => {
    server.use(noWebhooks());
    const { user, router } = renderApp({ route: '/webhooks?x=1' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fwebhooks%3Fx%3D1');
    await signIn(user);

    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/webhooks');
    expect(router.state.location.search).toBe('?x=1');
  });

  it.each(['https://evil.example', '//evil.example'])(
    'ignores a return address that leaves the app: %s',
    async (next) => {
      server.use(http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })));
      const { user, router } = renderApp({ route: `/login?next=${encodeURIComponent(next)}` });
      await signIn(user);
      await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    },
  );

  it('skips the form for someone already signed in', async () => {
    server.use(noJobs());
    const { router } = renderApp({ signedIn: true, route: '/login?next=%2Fjobs' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
  });

  it('ignores spaces around the email', async () => {
    server.use(noJobs());
    const { user } = renderApp();

    await user.type(await screen.findByLabelText('Email'), `  ${TEST_EMAIL} `);
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('says so when the password is wrong, and clears it', async () => {
    const { user } = renderApp({ route: '/login' });
    await signIn(user, 'not the password');

    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong email or password.');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveValue('');
    expect(password).toHaveFocus();
  });

  it('checks the fields before asking the server', async () => {
    let attempts = 0;
    server.use(
      http.post('/v1/auth/login', () => {
        attempts += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    const { user } = renderApp({ route: '/login' });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(attempts).toBe(0);
  });

  it('puts focus on the password when only the password is missing', async () => {
    const { user } = renderApp({ route: '/login' });
    await user.type(await screen.findByLabelText('Email'), TEST_EMAIL);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });

  it('counts down when there were too many attempts', async () => {
    server.use(
      http.post(
        '/v1/auth/login',
        () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '30' } }),
      ),
    );
    const { user } = renderApp({ route: '/login' });
    await signIn(user);

    expect(
      await screen.findByText('Too many attempts. Try again in 30 seconds.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 30 seconds.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('says the server could not be reached', async () => {
    server.use(http.post('/v1/auth/login', () => HttpResponse.error()));
    const { user } = renderApp({ route: '/login' });
    await signIn(user);

    expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
  });

  it('shows what the server refused', async () => {
    server.use(
      http.post('/v1/auth/login', () =>
        HttpResponse.json({ statusCode: 400, message: 'email must be an email' }, { status: 400 }),
      ),
    );
    const { user } = renderApp({ route: '/login' });
    await signIn(user);

    expect(
      await screen.findByText('The server refused: email must be an email'),
    ).toBeInTheDocument();
  });

  it('keeps the return address on the way to sign-up', async () => {
    renderApp({ route: '/login?next=%2Fwebhooks' });
    expect(await screen.findByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/register?next=%2Fwebhooks',
    );
  });

  it('sends someone whose session ended back to sign in, and back to work after', async () => {
    let expired = false;
    server.use(
      http.get('/v1/jobs', () => {
        if (expired) return HttpResponse.json({ items: [], nextCursor: null });
        expired = true;
        testSession.signOut();
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const { user, router } = renderApp({ signedIn: true, route: '/jobs' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fjobs');

    await signIn(user);
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/jobs');
  });

  it('forgets the API key an older version kept in the browser', async () => {
    window.localStorage.setItem('pdp.apiKey', 'pdp_old');
    renderApp({ route: '/login' });
    await waitFor(() => expect(window.localStorage.getItem('pdp.apiKey')).toBeNull());
  });

  it('explains when the sign-in check itself fails', async () => {
    server.use(http.get('/v1/me', () => HttpResponse.json({ message: 'down' }, { status: 502 })));
    renderApp({ signedIn: true, route: '/jobs' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check your sign-in');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('explains on the sign-in page when the check fails, and still offers the form', async () => {
    server.use(http.get('/v1/me', () => HttpResponse.json({ message: 'down' }, { status: 502 })));
    renderApp({ route: '/login' });
    const title = await screen.findByText('Could not check your sign-in');
    expect(title.closest('[role="alert"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('app shell', () => {
  it('names the page in the tab and marks the current section', async () => {
    server.use(noJobs(), noWebhooks());
    const { user } = renderApp({ signedIn: true, route: '/jobs' });
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

  it('signs out through the gateway from the user menu', async () => {
    server.use(noJobs());
    const { user, router } = renderApp({ signedIn: true, route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Account: dev@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(testSession.isSignedIn()).toBe(false);
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('stays signed in and says so when signing out fails', async () => {
    server.use(
      noJobs(),
      http.post('/v1/auth/logout', () => HttpResponse.error()),
    );
    const { user, router } = renderApp({ signedIn: true, route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Account: dev@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByText('Could not sign out. Check the connection and try again.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/jobs');
  });

  it('closes the user menu with Escape and returns focus to its button', async () => {
    server.use(noJobs());
    const { user } = renderApp({ signedIn: true, route: '/jobs' });
    const trigger = await screen.findByRole('button', { name: 'Account: dev@example.com' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes the user menu when the page changes', async () => {
    server.use(noJobs(), noWebhooks());
    const { user } = renderApp({ signedIn: true, route: '/jobs' });
    const trigger = await screen.findByRole('button', { name: 'Account: dev@example.com' });
    await user.click(trigger);
    within(screen.getByRole('navigation', { name: 'Main' }))
      .getByRole('link', { name: 'Webhooks' })
      .focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { level: 1, name: 'Webhooks' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the language switch out of the account navigation', async () => {
    renderApp({ route: '/login' });
    const nav = await screen.findByRole('navigation', { name: 'Account' });
    expect(within(nav).queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});
