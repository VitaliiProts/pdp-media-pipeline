import { act, screen, waitFor } from '@testing-library/react';
import { renderPage, type PrerenderedPath } from '../entry-server';
import { signedOut } from '../features/auth';
import { startApp } from './start';

/** What nginx serves for `builtFor`, opened at `url`: the build's markup in `#root`. */
async function openPrerendered(builtFor: PrerenderedPath, url: string = builtFor) {
  const root = document.createElement('div');
  root.id = 'root';
  root.dataset.prerendered = builtFor;
  root.innerHTML = await renderPage(builtFor);
  document.body.append(root);
  window.history.replaceState(null, '', url);

  const errors = vi.spyOn(console, 'error');
  const recoverable = vi.fn();
  window.addEventListener('error', recoverable);
  const started = await act(() => startApp(root));
  onTestFinished(() => {
    act(() => started.reactRoot.unmount());
    started.store.dispatch(signedOut());
    root.remove();
    window.removeEventListener('error', recoverable);
    errors.mockRestore();
  });
  return { root, errors, recoverable };
}

describe('hydrating a prerendered page', () => {
  it('keeps the sign-in form the build rendered, without a mismatch', async () => {
    const page = await openPrerendered('/login');
    const email = page.root.querySelector('input[type="email"]');
    expect(email).not.toBeNull();

    // `GET /v1/me` answers 401: a visitor, the form stays.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    expect(screen.getByLabelText('Email')).toBe(email);
    expect(page.errors).not.toHaveBeenCalled();
    expect(page.recoverable).not.toHaveBeenCalled();
  });

  it('picks up the return address after hydration', async () => {
    const page = await openPrerendered('/login', '/login?next=%2Fjobs');
    expect(await screen.findByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/register?next=%2Fjobs',
    );
    expect(page.errors).not.toHaveBeenCalled();
  });

  it('switches to the language the visitor picked once hydrated', async () => {
    window.localStorage.setItem('pdp.language', 'uk');
    const page = await openPrerendered('/register');
    expect(await screen.findByRole('heading', { level: 1, name: 'Реєстрація' })).toBeVisible();
    expect(document.documentElement.lang).toBe('uk');
    expect(page.errors).not.toHaveBeenCalled();
  });

  it('renders from scratch when the server sent another page', async () => {
    // A fallback to index.html (`vite preview`, a CDN) puts the landing page on any address.
    const page = await openPrerendered('/', '/no-such-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('API and webhooks')).toBeNull();
    expect(page.errors).not.toHaveBeenCalled();
    expect(page.recoverable).not.toHaveBeenCalled();
  });
});
