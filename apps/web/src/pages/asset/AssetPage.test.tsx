import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type InitialEntry } from 'react-router';
import { type AssetDetails, type AssetJob, assetsApi, LIVE_POLL_MS } from '../../features/assets';
import { DUB_JOB_ID, DUB_QUOTA, dubAsset, dubJob, TEST_DUB } from '../../test/dub-fixtures';
import { TEST_ASSET, testAsset } from '../../test/fixtures';
import { renderApp } from '../../test/render-app';
import { server, STORAGE_ORIGIN } from '../../test/server';

const ID = 'a0000000-0000-4000-8000-000000000001';

const job = (overrides: Partial<AssetJob> = {}): AssetJob => ({
  id: 'b0000000-0000-4000-8000-000000000001',
  type: 'image.resize',
  status: 'succeeded',
  attempts: 1,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

function details(overrides: Partial<AssetDetails> = {}): AssetDetails {
  return {
    ...TEST_ASSET,
    originalUrl: `${STORAGE_ORIGIN}/original`,
    originalDownloadUrl: `${STORAGE_ORIGIN}/original?download`,
    jobs: [
      job({
        results: [
          {
            preset: 'thumb',
            width: 200,
            height: 133,
            bytes: 9_400,
            url: `${STORAGE_ORIGIN}/thumb.webp`,
            downloadUrl: `${STORAGE_ORIGIN}/thumb.webp?download`,
          },
        ],
      }),
    ],
    jobsNextCursor: null,
    ...overrides,
  };
}

const serve = (body: AssetDetails) =>
  server.use(http.get(`/v1/assets/${ID}`, () => HttpResponse.json(body)));

const rendition = (name: string, height: number, signature: string) => ({
  rendition: name,
  width: Math.round((height * 16) / 9),
  height,
  durationSeconds: 12,
  bytes: 1,
  bitrate: 1,
  url: `${STORAGE_ORIGIN}/${name}.mp4${signature}`,
  downloadUrl: `${STORAGE_ORIGIN}/${name}.mp4?download`,
});

/** A finished transcode; `signature` stands for the query string every fetch signs anew. */
const transcoded = (signature = ''): AssetJob =>
  job({
    type: 'video.transcode',
    transcode: {
      durationSeconds: 12,
      width: 1280,
      height: 720,
      codec: 'h264',
      preview: {
        atSeconds: 0,
        width: 640,
        height: 360,
        bytes: 1,
        url: `${STORAGE_ORIGIN}/preview.jpg`,
        downloadUrl: `${STORAGE_ORIGIN}/preview.jpg?download`,
      },
      renditions: [rendition('480p', 480, signature), rendition('720p', 720, signature)],
    },
  });

const VIDEO_BASE = {
  kind: 'video' as const,
  name: 'cliffs.mp4',
  contentType: 'video/mp4',
  width: 1920,
  height: 1080,
  durationSeconds: 12,
};

describe('file page', () => {
  it('shows an image with its facts and versions to download', async () => {
    serve(details());
    renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'harbour.jpg' })).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/original`,
    );
    expect(screen.getByText('1200 × 800')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/original?download`,
    );
    const panel = screen.getByRole('tabpanel', { name: 'Versions' });
    expect(
      within(panel).getByRole('link', { name: 'Download Thumbnail · 200 px' }),
    ).toHaveAttribute('href', `${STORAGE_ORIGIN}/thumb.webp?download`);
    expect(within(panel).getByText('WebP')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', {
        name: 'Library',
      }),
    ).toHaveAttribute('href', '/library');
  });

  it('plays the best transcoded rendition and switches quality', async () => {
    serve(details({ ...VIDEO_BASE, jobs: [transcoded()] }));
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/720p.mp4`);
    expect(video).toHaveAttribute('poster', `${STORAGE_ORIGIN}/preview.jpg`);
    await user.click(screen.getByRole('radio', { name: '480p' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/480p.mp4`,
    );
  });

  it('says when a transcoded rendition cannot be played, and still offers the other', async () => {
    serve(details({ ...VIDEO_BASE, jobs: [transcoded()] }));
    renderApp({ signedIn: true, route: `/library/${ID}` });

    fireEvent.error(await screen.findByLabelText('Play cliffs.mp4'));
    expect(await screen.findByText('This video could not be played.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '480p' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/480p.mp4`,
    );
  });

  it('plays the original without a transcode, and explains when the browser cannot', async () => {
    serve(details({ ...VIDEO_BASE, jobs: [] }));
    renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/original`);
    fireEvent.error(video);
    expect(
      await screen.findByText(
        'This browser cannot play this format. Transcode it to 480p or 720p.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Versions will appear once processing is done.')).toBeInTheDocument();
  });

  it('offers every frame of a video to download', async () => {
    const frame = (atSeconds: number) => ({
      atSeconds,
      width: 640,
      height: 360,
      bytes: 1,
      url: `${STORAGE_ORIGIN}/frame-${atSeconds}.jpg`,
      downloadUrl: `${STORAGE_ORIGIN}/frame-${atSeconds}.jpg?download`,
    });
    serve(
      details({
        ...VIDEO_BASE,
        jobs: [
          job({
            type: 'video.frames',
            video: {
              durationSeconds: 12,
              width: 1920,
              height: 1080,
              codec: 'h264',
              preview: frame(0),
              frames: [frame(0), frame(2)],
            },
          }),
        ],
      }),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    const panel = await screen.findByRole('tabpanel', { name: 'Versions' });
    expect(within(panel).getByRole('link', { name: 'Download Preview frame' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/frame-0.jpg?download`,
    );
    const frames = within(panel).getByRole('region', { name: 'Frames' });
    expect(within(frames).getByRole('heading', { level: 2 })).toHaveTextContent('Frames');
    expect(
      within(frames).getByRole('link', { name: 'Download the frame at 0:02' }),
    ).toHaveAttribute('href', `${STORAGE_ORIGIN}/frame-2.jpg?download`);
  });

  it('lists the jobs on the file with what went wrong', async () => {
    serve(
      details({
        jobs: [
          job({
            status: 'dead',
            attempts: 3,
            lastError: 'unsupported image format',
            deadReason: 'permanent',
          }),
        ],
        jobsNextCursor: 'more',
      }),
    );
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });
    await user.click(await screen.findByRole('tab', { name: 'Jobs' }));

    const panel = screen.getByRole('tabpanel', { name: 'Jobs' });
    expect(within(panel).getByText('Resize')).toBeInTheDocument();
    expect(within(panel).getByText('Gave up')).toBeInTheDocument();
    expect(within(panel).getByText('Attempt 3')).toBeInTheDocument();
    expect(within(panel).getByText('unsupported image format')).toBeInTheDocument();
    expect(within(panel).getByText('Showing the 1 newest jobs.')).toBeInTheDocument();
  });

  it('returns to the library with the filters it came from', async () => {
    server.use(
      http.get('/v1/assets', () => HttpResponse.json({ items: [testAsset()], nextCursor: null })),
    );
    serve(details());
    const { user } = renderApp({ signedIn: true, route: '/library?kind=image' });
    await user.click(await screen.findByRole('link', { name: /harbour\.jpg/ }));

    await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' });
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', {
        name: 'Library',
      }),
    ).toHaveAttribute('href', '/library?kind=image');
  });

  it('says so when the file does not exist', async () => {
    server.use(
      http.get(`/v1/assets/${ID}`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(await screen.findByRole('heading', { name: 'File not found' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'File' })).toBeInTheDocument();
    expect(document.title).toBe('File — PDP Media Pipeline');
    expect(screen.getByRole('link', { name: 'Back to the library' })).toHaveAttribute(
      'href',
      '/library',
    );
  });

  it('says so when the file is deleted elsewhere while the page is open', async () => {
    let gone = false;
    server.use(
      http.get(`/v1/assets/${ID}`, () =>
        gone
          ? HttpResponse.json({ message: 'not found' }, { status: 404 })
          : HttpResponse.json(details()),
      ),
    );
    const { store } = renderApp({ signedIn: true, route: `/library/${ID}` });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' }),
    ).toBeInTheDocument();

    gone = true;
    await act(async () => {
      await store.dispatch(
        assetsApi.endpoints.getAsset.initiate(ID, { subscribe: false, forceRefetch: true }),
      );
    });

    expect(await screen.findByRole('heading', { name: 'File not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download original' })).not.toBeInTheDocument();
  });

  it('offers a retry when the gateway fails', async () => {
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(details());
      }),
    );
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(
      await screen.findByRole('heading', { name: 'Could not load the file' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'File' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' }),
    ).toBeInTheDocument();
  });
});

describe('deleting a file', () => {
  async function openDelete(
    status: number,
    body?: object,
    {
      route = `/library/${ID}`,
      gate = Promise.resolve(),
    }: { route?: InitialEntry; gate?: Promise<void> } = {},
  ) {
    let deletes = 0;
    serve(details());
    server.use(
      http.delete(`/v1/assets/${ID}`, async () => {
        deletes += 1;
        await gate;
        return body ? HttpResponse.json(body, { status }) : new HttpResponse(null, { status });
      }),
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const view = renderApp({ signedIn: true, route });
    await view.user.click(await screen.findByRole('button', { name: 'Delete harbour.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete harbour.jpg?' });
    return { ...view, dialog, deletes: () => deletes };
  }

  it.each([204, 404])('goes back to the library once the file is gone (%i)', async (status) => {
    const { user, router, dialog } = await openDelete(
      status,
      status === 404 ? { message: 'not found' } : undefined,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByText('File deleted.')).toBeInTheDocument();
  });

  it('keeps the dialog open while a job still works on the file', async () => {
    const { user, router, dialog } = await openDelete(409, { code: 'ASSET_BUSY', message: 'busy' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This file is still being processed. Try again when its job finishes.',
    );
    expect(dialog).toHaveAttribute('open');
    expect(router.state.location.pathname).toBe(`/library/${ID}`);
  });

  it('says what the server said when deleting fails otherwise', async () => {
    const { user, dialog } = await openDelete(500, { message: 'storage unavailable' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not delete the file. storage unavailable',
    );
  });

  it('cancels without deleting', async () => {
    const { user, dialog, deletes } = await openDelete(204);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Delete harbour.jpg' })).toHaveFocus();
    expect(deletes()).toBe(0);
  });

  it('goes back to the library with the filters it came from', async () => {
    const { user, router, dialog } = await openDelete(204, undefined, {
      route: { pathname: `/library/${ID}`, state: { librarySearch: '?kind=image' } },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(router.state.location.search).toBe('?kind=image');
  });

  it('stays open until the gateway answers, whatever the user presses', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user, router, dialog } = await openDelete(204, undefined, { gate });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).toHaveAttribute('open');

    release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(await screen.findByText('File deleted.')).toBeInTheDocument();
  });

  it('stays open when the browser closes it mid-request, and shows a late failure', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user, dialog } = await openDelete(500, { message: 'storage unavailable' }, { gate });
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('expected a <dialog>');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );

    dialog.close();
    expect(dialog).toHaveAttribute('open');
    release();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not delete the file. storage unavailable',
    );
    expect(dialog).toHaveAttribute('open');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).not.toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Delete harbour.jpg' }));
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not pull the user back once they have left the page', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user, router, dialog, deletes } = await openDelete(204, undefined, { gate });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deletes()).toBe(1));

    await act(() => router.navigate('/jobs'));
    release();

    expect(await screen.findByText('File deleted.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/jobs');
  });

  it('drops the cached library but leaves the deleted file alone', async () => {
    let listFetches = 0;
    let fileFetches = 0;
    server.use(
      http.get('/v1/assets', () => {
        listFetches += 1;
        return HttpResponse.json({ items: [testAsset()], nextCursor: null });
      }),
      http.get(`/v1/assets/${ID}`, () => {
        fileFetches += 1;
        return HttpResponse.json(details());
      }),
      http.delete(`/v1/assets/${ID}`, () => new HttpResponse(null, { status: 204 })),
    );
    const { user, router } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('link', { name: /harbour\.jpg/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete harbour.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete harbour.jpg?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    await waitFor(() => expect(listFetches).toBe(2));
    expect(fileFetches).toBe(1);
  });
});

describe('translating a video', () => {
  async function openTranslate(quota = DUB_QUOTA, asset = dubAsset([])) {
    const bodies: unknown[] = [];
    server.use(
      http.get(`/v1/assets/${ID}`, () => HttpResponse.json(asset)),
      http.get('/v1/dub-quota', () => HttpResponse.json(quota)),
      http.post('/v1/jobs', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ jobId: DUB_JOB_ID }, { status: 202 });
      }),
    );
    const view = renderApp({ signedIn: true, route: `/library/${ID}` });
    await view.user.click(await screen.findByRole('button', { name: 'Translate' }));
    const dialog = screen.getByRole('dialog', { name: 'Translate cliffs.mp4' });
    return { ...view, dialog, bodies };
  }

  it('starts a dub in the chosen languages and opens its page', async () => {
    const { user, dialog, bodies, router } = await openTranslate();

    expect(within(dialog).getByText('Length: 0:13')).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        'Translation time left this month: 20:00 of 30:00, renewed on November 1.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The sound and its text are sent to OpenAI for recognition and translation.',
      ),
    ).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Translate into'), 'Spanish');
    await user.selectOptions(within(dialog).getByLabelText('Spoken language'), 'English');
    await user.click(within(dialog).getByRole('button', { name: 'Translate' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/library/${ID}/dubs/${DUB_JOB_ID}`),
    );
    expect(bodies).toEqual([
      { type: 'video.dub', sourceKey: 'u/1/cliffs', targetLanguage: 'es', sourceLanguage: 'en' },
    ]);
  });

  it('warns before starting what the month’s time does not cover', async () => {
    const { dialog } = await openTranslate({ ...DUB_QUOTA, remainingSeconds: 10 });
    expect(
      await within(dialog).findByText('Not enough translation time left this month.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Translate' })).toBeDisabled();
  });

  it('warns about a video longer than a dub may be', async () => {
    const { dialog } = await openTranslate(DUB_QUOTA, dubAsset([], { durationSeconds: 95 }));
    expect(
      await within(dialog).findByText('Longer than 1:00: too long to translate.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Translate' })).toBeDisabled();
  });

  it('says so when the gateway refuses for the quota after all', async () => {
    const { user, dialog } = await openTranslate();
    server.use(
      http.post('/v1/jobs', () =>
        HttpResponse.json(
          { statusCode: 429, code: 'DUB_QUOTA_EXCEEDED', message: 'quota' },
          { status: 429 },
        ),
      ),
    );
    await within(dialog).findByText(/Translation time left/);
    await user.click(within(dialog).getByRole('button', { name: 'Translate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Not enough translation time left this month.',
    );
    expect(dialog).toHaveAttribute('open');
  });

  it('offers a retry when the time left cannot be checked', async () => {
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => HttpResponse.json(dubAsset([]))),
      http.get('/v1/dub-quota', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(DUB_QUOTA);
      }),
    );
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });
    await user.click(await screen.findByRole('button', { name: 'Translate' }));
    const dialog = screen.getByRole('dialog', { name: 'Translate cliffs.mp4' });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not check the translation time left.',
    );
    expect(within(dialog).getByRole('button', { name: 'Translate' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText(/Translation time left/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Translate' })).toBeEnabled();
  });

  it('offers no translation for a photo', async () => {
    serve(details());
    renderApp({ signedIn: true, route: `/library/${ID}` });
    await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' });
    expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument();
  });

  it('lists a finished dub among the versions', async () => {
    server.use(
      http.get(`/v1/assets/${ID}`, () =>
        HttpResponse.json(
          dubAsset([dubJob({ id: 'd2', status: 'running', dub: undefined }), dubJob()]),
        ),
      ),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });
    const panel = within(await screen.findByRole('tabpanel', { name: 'Versions' }));

    const row = panel.getByRole('listitem');
    expect(within(row).getByRole('link', { name: 'Translation · German' })).toHaveAttribute(
      'href',
      `/library/${ID}/dubs/${DUB_JOB_ID}`,
    );
    expect(row).toHaveTextContent('0:13');
    expect(row).toHaveTextContent('MP4');
    expect(
      within(row).getByRole('link', { name: 'Download Translation · German' }),
    ).toHaveAttribute('href', TEST_DUB.video.downloadUrl);
  });

  it('links a dub on the jobs tab to its page', async () => {
    server.use(http.get(`/v1/assets/${ID}`, () => HttpResponse.json(dubAsset([dubJob()]))));
    const { user } = renderApp({ signedIn: true, route: `/library/${ID}` });
    await user.click(await screen.findByRole('tab', { name: 'Jobs' }));
    const panel = screen.getByRole('tabpanel', { name: 'Jobs' });
    expect(within(panel).getByText('Translation')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Open the translation' })).toHaveAttribute(
      'href',
      `/library/${ID}/dubs/${DUB_JOB_ID}`,
    );
  });
});

describe('live file page', () => {
  afterEach(() => vi.useRealTimers());

  it('polls while a job on the file is going and stops when it is done', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1 ? details({ jobs: [job({ status: 'running' })] }) : details(),
        );
      }),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    expect(
      await screen.findByText('Versions will appear once processing is done.'),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(
      await screen.findByRole('link', { name: 'Download Thumbnail · 200 px' }),
    ).toBeInTheDocument();
    const settled = calls;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(calls).toBe(settled);
  });

  it('keeps the video and its failure when a poll signs the links anew, retrying a stale link once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => {
        calls += 1;
        return HttpResponse.json(
          details({
            ...VIDEO_BASE,
            // A visible change, so the test can tell the poll's answer has rendered.
            size: calls * 1_000_000,
            originalUrl: `${STORAGE_ORIGIN}/original?signature=${calls}`,
            jobs: [job({ type: 'video.transcode', status: 'running' })],
          }),
        );
      }),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('2 MB')).toBeInTheDocument();
    expect(screen.getByLabelText('Play cliffs.mp4')).toBe(video);
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/original?signature=1`);

    fireEvent.error(video);
    const retried = screen.getByLabelText('Play cliffs.mp4');
    expect(retried).toHaveAttribute('src', `${STORAGE_ORIGIN}/original?signature=2`);
    fireEvent.error(retried);
    const unsupported = 'This browser cannot play this format. Transcode it to 480p or 720p.';
    expect(await screen.findByText(unsupported)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('3 MB')).toBeInTheDocument();
    expect(screen.getByText(unsupported)).toBeInTheDocument();
    expect(screen.queryByLabelText('Play cliffs.mp4')).not.toBeInTheDocument();
  });

  it('switches quality to the freshest link after a poll signed them anew', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => {
        calls += 1;
        return HttpResponse.json(
          details({
            ...VIDEO_BASE,
            size: calls * 1_000_000,
            jobs: [
              job({ id: 'b0000000-0000-4000-8000-000000000002', status: 'running' }),
              transcoded(`?signature=${calls}`),
            ],
          }),
        );
      }),
    );
    renderApp({ signedIn: true, route: `/library/${ID}` });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('2 MB')).toBeInTheDocument();
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/720p.mp4?signature=1`);

    fireEvent.click(screen.getByRole('radio', { name: '480p' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/480p.mp4?signature=2`,
    );
    fireEvent.click(screen.getByRole('radio', { name: '720p' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/720p.mp4?signature=2`,
    );
  });

  it('waits as long as the gateway asks when a poll is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const retryAfterS = 10;
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${ID}`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(details({ jobs: [job({ status: 'running' })] }))
          : new HttpResponse(null, {
              status: 429,
              headers: { 'Retry-After': String(retryAfterS) },
            });
      }),
    );
    const { store } = renderApp({ signedIn: true, route: `/library/${ID}` });
    const refused = () => assetsApi.endpoints.getAsset.select(ID)(store.getState()).isError;

    await screen.findByRole('heading', { level: 1, name: 'harbour.jpg' });
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    await waitFor(() => expect(refused()).toBe(true));
    // RTK Query schedules the next poll as one starts, so the poll after the refusal keeps the old pace.
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(calls).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(calls).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(retryAfterS * 1000 - LIVE_POLL_MS * 3));
    await waitFor(() => expect(calls).toBe(4));
    expect(screen.getByRole('heading', { level: 1, name: 'harbour.jpg' })).toBeInTheDocument();
  });
});
