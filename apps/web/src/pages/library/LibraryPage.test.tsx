import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type AssetSummary } from '../../features/assets';
import { formatBytes } from '../../shared/lib/format-bytes';
import { testAsset } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server } from '../../test/server';

const VIDEO = testAsset({
  id: 'a0000000-0000-4000-8000-000000000002',
  kind: 'video',
  name: 'cliffs.mp4',
  contentType: 'video/mp4',
  durationSeconds: 12,
  preview: null,
  latestJob: { id: 'b0000000-0000-4000-8000-000000000002', type: 'video.frames', status: 'queued' },
});

/** Answers every list request with `items` and records what was asked. */
function listAssets(items: AssetSummary[] = []) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get('/v1/assets', ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items, nextCursor: null });
    }),
  );
  return requests;
}

describe('library', () => {
  it('shows each file with its preview, status and size', async () => {
    listAssets([testAsset(), VIDEO]);
    renderApp({ signedIn: true, route: '/library' });

    const photo = await screen.findByRole('link', { name: /harbour\.jpg/ });
    expect(photo).toHaveAttribute('href', '/library/a0000000-0000-4000-8000-000000000001');
    const photoTile = photo.closest('li');
    expect(photoTile).not.toBeNull();
    if (!photoTile) return;
    expect(within(photoTile).getByText('Done')).toBeInTheDocument();
    expect(within(photoTile).getByText(formatBytes(2_400_000, 'en'))).toBeInTheDocument();

    const video = screen.getByRole('link', { name: /cliffs\.mp4/ });
    expect(video).toHaveTextContent('Video · 0:12');
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('keeps the filters in the address and asks the gateway for them', async () => {
    const requests = listAssets();
    const { user, router } = renderApp({ signedIn: true, route: '/library' });

    await user.click(await screen.findByRole('radio', { name: 'Videos' }));
    await waitFor(() => expect(requests.at(-1)?.get('kind')).toBe('video'));
    expect(router.state.location.search).toBe('?kind=video');
    expect(router.state.historyAction).toBe('PUSH');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Failed');
    await waitFor(() => expect(requests.at(-1)?.get('status')).toBe('failed'));

    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'harb');
    await waitFor(() => expect(requests.at(-1)?.get('q')).toBe('harb'));
    expect(router.state.location.search).toBe('?kind=video&status=failed&q=harb');
    expect(router.state.historyAction).toBe('REPLACE');
    // One request for the whole word, not one per key.
    expect(requests.filter((r) => r.has('q'))).toHaveLength(1);
  });

  it('ignores filter values it does not know', async () => {
    const requests = listAssets();
    renderApp({ signedIn: true, route: '/library?kind=audio&status=done&q=sea' });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.has('kind')).toBe(false);
    expect(requests[0]?.has('status')).toBe(false);
    expect(requests[0]?.get('q')).toBe('sea');
    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
  });

  it('invites the first upload when the library is empty', async () => {
    listAssets();
    const { user } = renderApp({ signedIn: true, route: '/library' });

    expect(
      await screen.findByRole('heading', { name: 'Your files will live here' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload a file' }));
    expect(screen.getByRole('dialog', { name: 'Upload files' })).toHaveAttribute('open');
  });

  it('offers to reset filters that match nothing', async () => {
    listAssets();
    const { user, router } = renderApp({ signedIn: true, route: '/library?kind=video&q=sea' });

    expect(await screen.findByRole('heading', { name: 'Nothing found' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveValue('');
  });

  it('shows a skeleton first, and a way back from an error', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.get('/v1/assets', async () => {
        calls += 1;
        if (calls === 1) {
          await held;
          return HttpResponse.json({ message: 'down' }, { status: 500 });
        }
        return HttpResponse.json({ items: [testAsset()], nextCursor: null });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });

    expect(await screen.findByRole('status', { name: 'Loading files…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    release();
    expect(
      await screen.findByRole('heading', { name: 'Could not load the library' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
  });
});
