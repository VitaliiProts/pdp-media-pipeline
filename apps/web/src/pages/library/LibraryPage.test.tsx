import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type AssetSummary, LIVE_POLL_MS } from '../../features/assets';
import { uploadsSlice } from '../../features/upload';
import { formatBytes } from '../../shared/lib/format-bytes';
import { testAsset } from '../../test/fixtures';
import { FakeIntersectionObserver } from '../../test/intersection-observer';
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

async function uploadFiles(user: ReturnType<typeof renderApp>['user'], files: File[]) {
  await user.click(await screen.findByRole('button', { name: 'Upload' }));
  await user.upload(
    screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
    files,
  );
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

    // The file name leads the link's name; the type and length follow it.
    const video = screen.getByRole('link', { name: /^cliffs\.mp4/ });
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

  it('shows the uploads of this tab first, only without filters, and lets a failed one go', async () => {
    listAssets([testAsset()]);
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('link', { name: /harbour\.jpg/ });
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );

    const tile = (await screen.findByText('The file is empty.')).closest('li');
    if (!tile) throw new Error('tile not found');
    expect(tile.parentElement?.firstElementChild).toBe(tile);
    expect(within(tile).getByText('empty.png')).toBeInTheDocument();
    expect(within(tile).getByText('Not submitted')).toBeInTheDocument();

    // Whether a file will match the filters is not known until the server lists it.
    await user.click(screen.getByRole('radio', { name: 'Photos' }));
    await waitFor(() => expect(screen.queryByText('empty.png')).not.toBeInTheDocument());
    await user.click(screen.getByRole('radio', { name: 'All' }));

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('empty.png')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
  });

  it('counts down on the tile of an upload that waits for the gateway', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post('/v1/uploads', () =>
        ++calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json(
              { code: 'STORAGE_QUOTA_EXCEEDED', message: 'quota' },
              { status: 413 },
            ),
      ),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await uploadFiles(user, [new File([new Uint8Array(64)], 'busy.png', { type: 'image/png' })]);

    const tile = (await screen.findByText('Rate limited, waiting')).closest('li');
    if (!tile) throw new Error('tile not found');
    expect(within(tile).getByRole('timer')).toHaveTextContent(/retry in \d s/);
    // The retry comes back refused for good, which ends the upload.
    expect(
      await screen.findByText(
        'Storage is full. Delete files you no longer need.',
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
  });

  it('moves focus on to the next tile when a failed upload is removed', async () => {
    listAssets([testAsset()]);
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('link', { name: /harbour\.jpg/ });
    await uploadFiles(user, [
      new File([], 'one.png', { type: 'image/png' }),
      new File([], 'two.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2));
    const [first, second] = screen.getAllByRole('button', { name: 'Remove' });
    if (!first || !second) throw new Error('buttons not found');

    await user.click(first);
    expect(second).toHaveFocus();
    await user.click(second);
    expect(screen.getByRole('link', { name: /harbour\.jpg/ })).toHaveFocus();
  });

  it('moves focus back to the previous tile, then to the search, as failed uploads go', async () => {
    listAssets();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('heading', { name: 'Your files will live here' });
    await uploadFiles(user, [
      new File([], 'one.png', { type: 'image/png' }),
      new File([], 'two.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2));
    const [first, last] = screen.getAllByRole('button', { name: 'Remove' });
    if (!first || !last) throw new Error('buttons not found');

    await user.click(last);
    expect(first).toHaveFocus();
    await user.click(first);
    expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveFocus();
  });

  it('offers to reset filters that match nothing', async () => {
    listAssets();
    const { user, router } = renderApp({ signedIn: true, route: '/library?kind=video&q=sea' });

    expect(await screen.findByRole('heading', { name: 'Nothing found' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    const searchBox = screen.getByRole('searchbox', { name: 'Search by name' });
    expect(searchBox).toHaveValue('');
    // The reset button is gone with its empty state; focus goes where the user carries on.
    expect(searchBox).toHaveFocus();
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

describe('library pages', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver));
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeIntersectionObserver.reset();
  });

  const SECOND = testAsset({ id: 'a0000000-0000-4000-8000-000000000003', name: 'dunes.jpg' });

  function twoPages(
    nextPage: () => Response | Promise<Response> = () =>
      HttpResponse.json({ items: [SECOND], nextCursor: null }),
  ) {
    server.use(
      http.get('/v1/assets', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === 'c1'
          ? nextPage()
          : HttpResponse.json({ items: [testAsset()], nextCursor: 'c1' }),
      ),
    );
  }

  it('loads the next page from the button and says how many files came', async () => {
    twoPages();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    const dunes = await screen.findByRole('link', { name: /dunes\.jpg/ });
    expect(screen.getByText('Added 1 more file.').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    // The button is gone; focus goes on to the first file it brought.
    await waitFor(() => expect(dunes).toHaveFocus());
  });

  it('keeps focus on the page when the button brings no files', async () => {
    twoPages(() => HttpResponse.json({ items: [], nextCursor: null }));
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Search by name' })).toHaveFocus(),
    );
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
  });

  it('keeps focus on the button when a page brings no files but more are left', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/v1/assets', async ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor === 'c1') {
          await held;
          return HttpResponse.json({ items: [], nextCursor: 'c2' });
        }
        if (cursor === 'c2') return HttpResponse.json({ items: [SECOND], nextCursor: null });
        return HttpResponse.json({ items: [testAsset()], nextCursor: 'c1' });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });
    const button = await screen.findByRole('button', { name: 'Show more' });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    release();

    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    expect(button).toHaveFocus();
    await user.click(button);
    const dunes = await screen.findByRole('link', { name: /dunes\.jpg/ });
    await waitFor(() => expect(dunes).toHaveFocus());
  });

  it('moves focus past the files still uploading to the first file the button brought', async () => {
    twoPages();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('button', { name: 'Show more' });
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );
    const uploadTile = (await screen.findByText('The file is empty.')).closest('li');
    expect(uploadTile?.parentElement?.firstElementChild).toBe(uploadTile);
    expect(uploadTile).not.toHaveAttribute('data-asset-id');

    await user.click(screen.getByRole('button', { name: 'Show more' }));
    const dunes = await screen.findByRole('link', { name: /^dunes\.jpg/ });
    await waitFor(() => expect(dunes).toHaveFocus());
  });

  it('loads the next page when the end of the grid scrolls into view', async () => {
    twoPages();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await screen.findByRole('button', { name: 'Show more' });
    const searchBox = screen.getByRole('searchbox', { name: 'Search by name' });
    await user.click(searchBox);

    act(() => FakeIntersectionObserver.latest()?.reveal());
    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
    await act(() => Promise.resolve());
    expect(searchBox).toHaveFocus();
  });

  it('reads out every page, even one as long as the last', async () => {
    const THIRD = testAsset({ id: 'a0000000-0000-4000-8000-000000000004', name: 'reef.jpg' });
    server.use(
      http.get('/v1/assets', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor === 'c1') return HttpResponse.json({ items: [SECOND], nextCursor: 'c2' });
        if (cursor === 'c2') return HttpResponse.json({ items: [THIRD], nextCursor: null });
        return HttpResponse.json({ items: [testAsset()], nextCursor: 'c1' });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByRole('link', { name: /dunes\.jpg/ });
    const second = screen.getByText('Added 1 more file.');

    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByRole('link', { name: /reef\.jpg/ });
    // A live region reads additions; the same text left in the same node is not read again.
    expect(screen.getByText('Added 1 more file.')).not.toBe(second);
  });

  it('does not read out pages it already had when the filters come back', async () => {
    twoPages();
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Added 1 more file.');

    await user.click(screen.getByRole('radio', { name: 'Videos' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /dunes\.jpg/ })).not.toBeInTheDocument(),
    );
    await screen.findByRole('button', { name: 'Show more' });
    await user.click(screen.getByRole('radio', { name: 'All' }));

    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
  });

  it('keeps what it has when the next page fails, and tries again', async () => {
    let failed = false;
    twoPages(() => {
      if (failed) return HttpResponse.json({ items: [SECOND], nextCursor: null });
      failed = true;
      return HttpResponse.json({ message: 'down' }, { status: 500 });
    });
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Could not load more files.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
    // Scrolling does not retry on its own: nothing is watched until the button is pressed.
    expect(FakeIntersectionObserver.latest()).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /dunes\.jpg/ })).toBeInTheDocument();
  });
});

describe('live library', () => {
  afterEach(() => vi.useRealTimers());

  it('polls while a file is processing and stops when it is done', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get('/v1/assets', () => {
        calls += 1;
        return HttpResponse.json({
          items: [
            testAsset({
              latestJob: {
                id: 'b0000000-0000-4000-8000-000000000001',
                type: 'image.resize',
                status: calls === 1 ? 'running' : 'succeeded',
              },
            }),
          ],
          nextCursor: null,
        });
      }),
    );
    renderApp({ signedIn: true, route: '/library' });

    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('Done')).toBeInTheDocument();
    const settled = calls;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(calls).toBe(settled);
  });

  it('polls until the file of an upload shows up, then stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const jobId = 'b0000000-0000-4000-8000-000000000009';
    let calls = 0;
    server.use(
      http.get('/v1/assets', () => {
        calls += 1;
        const listed = testAsset({
          latestJob: { id: jobId, type: 'image.resize', status: 'succeeded' },
        });
        return HttpResponse.json({ items: calls === 1 ? [] : [listed], nextCursor: null });
      }),
    );
    const { store } = renderApp({ signedIn: true, route: '/library' });
    const { uploadStarted, uploadSubmitted } = uploadsSlice.actions;
    act(() => {
      store.dispatch(
        uploadStarted({
          id: 'u1',
          fileName: 'new.png',
          kind: 'image',
          previewUrl: 'blob:new',
          createdAt: 1,
        }),
      );
      store.dispatch(uploadSubmitted({ id: 'u1', jobId }));
    });

    expect(await screen.findByText('new.png')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS / 2));
    expect(calls).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS / 2));
    expect(await screen.findByRole('link', { name: /harbour\.jpg/ })).toBeInTheDocument();
    expect(screen.queryByText('new.png')).not.toBeInTheDocument();
    const settled = calls;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(calls).toBe(settled);
  });
});
