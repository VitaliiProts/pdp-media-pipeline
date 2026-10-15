import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ApiKey } from '../../features/api-keys';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';

const CI_KEY: ApiKey = {
  id: 'c0000000-0000-4000-8000-000000000001',
  name: 'ci',
  prefix: 'pdp_ab12',
  createdAt: '2026-10-10T10:00:00.000Z',
  lastUsedAt: null,
};
const SECRET = 'pdp_cd34_0123456789abcdef';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** An in-memory key store behind the three endpoints. */
function keysApi(initial: ApiKey[] = [CI_KEY]) {
  let items = [...initial];
  const revoked: string[] = [];
  server.use(
    http.get('/v1/api-keys', () => HttpResponse.json({ items })),
    http.post('/v1/api-keys', async ({ request }) => {
      const body: unknown = await request.json();
      const name = isRecord(body) && typeof body.name === 'string' ? body.name : '';
      const stored: ApiKey = {
        id: 'c0000000-0000-4000-8000-000000000002',
        name,
        prefix: 'pdp_cd34',
        createdAt: '2026-10-15T10:00:00.000Z',
        lastUsedAt: null,
      };
      items = [...items, stored];
      return HttpResponse.json({ ...stored, key: SECRET }, { status: 201 });
    }),
    http.delete('/v1/api-keys/:id', ({ params }) => {
      revoked.push(String(params.id));
      items = items.filter((key) => key.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { revoked };
}

describe('settings', () => {
  it('shows the profile and lets the language change', async () => {
    keysApi();
    renderApp({ signedIn: true, route: '/settings' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const profile = screen.getByRole('region', { name: 'Profile' });
    expect(within(profile).getByText('dev@example.com')).toBeInTheDocument();
    expect(within(profile).getByText('dev')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Language' })).getByRole('group', {
        name: 'Language',
      }),
    ).toBeInTheDocument();
  });

  it('lists keys with their prefix and when they were last used', async () => {
    keysApi();
    renderApp({ signedIn: true, route: '/settings' });

    const row = (await screen.findByText('ci')).closest('li');
    expect(row).not.toBeNull();
    if (!row) return;
    expect(within(row).getByText('pdp_ab12…')).toBeInTheDocument();
    expect(within(row).getByText('Never used')).toBeInTheDocument();
  });

  it('shows a new key once, copies it, and forgets it on close', async () => {
    keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.type(await screen.findByLabelText('Key name'), 'deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const dialog = await screen.findByRole('dialog', { name: 'Your new API key' });
    expect(within(dialog).getByLabelText('API key')).toHaveValue(SECRET);
    expect(within(dialog).getByText(new RegExp(`X-API-Key: ${SECRET}`))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(within(dialog).getByText('Copied.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
    expect(await screen.findByText('deploy')).toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveValue('');
  });

  it('selects the key for a manual copy when the clipboard refuses', async () => {
    keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('Write permission denied.', 'NotAllowedError'),
    );
    await user.type(await screen.findByLabelText('Key name'), 'deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your new API key' });

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(
      await within(dialog).findByText(
        'The key is selected. Press Ctrl+C (⌘C on a Mac) to copy it.',
      ),
    ).toBeInTheDocument();
    const field = within(dialog).getByLabelText('API key');
    expect(field).toHaveFocus();
    if (!(field instanceof HTMLInputElement)) throw new Error('expected an <input>');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, SECRET.length]);
  });

  it('says when the key could not be created and keeps the name', async () => {
    keysApi();
    server.use(
      http.post('/v1/api-keys', () => HttpResponse.json({ message: 'down' }, { status: 500 })),
    );
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.type(await screen.findByLabelText('Key name'), 'deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText('Could not create the key. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveValue('deploy');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wants a name for a new key', async () => {
    keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Create key' }));

    expect(
      screen.getByText('Name the key, e.g. after the script that uses it.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Key name')).toHaveFocus();
  });

  it('stops at ten keys', async () => {
    keysApi(
      Array.from({ length: 10 }, (_, index) => ({
        ...CI_KEY,
        id: `c0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        name: `key ${index}`,
      })),
    );
    renderApp({ signedIn: true, route: '/settings' });

    await screen.findByText('key 9');
    expect(screen.getByLabelText('Key name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
    expect(
      screen.getByText('You have reached the limit of 10 keys. Revoke one you no longer need.'),
    ).toBeInTheDocument();
  });

  it('revokes a key after asking', async () => {
    const { revoked } = keysApi();
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Revoke ci' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke ci?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(revoked).toEqual([CI_KEY.id]));
    expect(await screen.findByText(/No keys yet/)).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'API keys' });
    await waitFor(() => expect(section.contains(document.activeElement)).toBe(true));
  });

  it('holds the revoke dialog until the gateway answers, then says it failed', async () => {
    keysApi();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete('/v1/api-keys/:id', async () => {
        await gate;
        return HttpResponse.json({ message: 'down' }, { status: 500 });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Revoke ci' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke ci?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Revoke' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).toHaveAttribute('open');

    release();
    expect(
      await within(dialog).findByText('Could not revoke the key. Try again.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).not.toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Revoke ci' }));
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a retry when the keys do not load', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/api-keys', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'down' }, { status: 500 })
          : HttpResponse.json({ items: [CI_KEY] });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/settings' });

    expect(
      await screen.findByRole('heading', { name: 'Could not load API keys' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('ci')).toBeInTheDocument();
  });
});
