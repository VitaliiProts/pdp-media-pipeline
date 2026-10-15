import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TEST_ME } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';
import { testSession } from '../../test/session';

const NEW_EMAIL = 'new@example.com';

function registerHandler(onBody: (body: unknown) => void = () => undefined) {
  server.use(
    http.post('/v1/auth/register', async ({ request }) => {
      const body: unknown = await request.json();
      onBody(body);
      if (
        typeof body === 'object' &&
        body !== null &&
        'email' in body &&
        body.email === 'taken@example.com'
      ) {
        return HttpResponse.json(
          { statusCode: 409, code: 'EMAIL_TAKEN', message: 'email is already registered' },
          { status: 409 },
        );
      }
      testSession.signIn();
      return HttpResponse.json({ ...TEST_ME, email: NEW_EMAIL }, { status: 201 });
    }),
    http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
  );
}

async function fill(user: ReturnType<typeof renderApp>['user'], email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('creating an account', () => {
  it('creates the account and opens the library', async () => {
    let sent: unknown;
    registerHandler((body) => {
      sent = body;
    });
    const { user, router } = renderApp({ route: '/register' });
    await user.type(await screen.findByLabelText('Name'), '  Ann  ');
    await fill(user, NEW_EMAIL, 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(sent).toEqual({ name: 'Ann', email: NEW_EMAIL, password: 'long enough' });
  });

  it('leaves the name out when it is empty', async () => {
    let sent: unknown;
    registerHandler((body) => {
      sent = body;
    });
    const { user } = renderApp({ route: '/register' });
    await fill(user, NEW_EMAIL, 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(sent).toEqual({ email: NEW_EMAIL, password: 'long enough' }));
  });

  it('points to sign-in when the email is taken, keeping the return address', async () => {
    registerHandler();
    const { user } = renderApp({ route: '/register?next=%2Fjobs' });
    await fill(user, 'taken@example.com', 'long enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This email is already registered.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute(
      'href',
      '/login?next=%2Fjobs',
    );
  });

  it('wants a password of at least 8 characters', async () => {
    registerHandler();
    const { user } = renderApp({ route: '/register' });
    await fill(user, NEW_EMAIL, 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('explains when the sign-in check fails, and still offers the form', async () => {
    server.use(http.get('/v1/me', () => HttpResponse.json({ message: 'down' }, { status: 502 })));
    renderApp({ route: '/register' });
    const title = await screen.findByText('Could not check your sign-in');
    expect(title.closest('[role="alert"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});
