import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type AssetJob, LIVE_POLL_MS } from '../../features/assets';
import { DUB_ASSET_ID, DUB_JOB_ID, dubAsset, dubJob, TEST_DUB } from '../../test/dub-fixtures';
import { renderApp } from '../../test/render-app';
import { server, STORAGE_ORIGIN } from '../../test/server';

const ROUTE = `/library/${DUB_ASSET_ID}/dubs/${DUB_JOB_ID}`;
const VTT = 'WEBVTT\n\n00:00.500 --> 00:02.500\nWohin gehst du?\n';

function serve(...jobs: AssetJob[]) {
  server.use(
    http.get(`/v1/assets/${DUB_ASSET_ID}`, () => HttpResponse.json(dubAsset(jobs))),
    http.get(`${STORAGE_ORIGIN}/dubbed.vtt`, () =>
      HttpResponse.text(VTT, { headers: { 'Access-Control-Allow-Origin': '*' } }),
    ),
  );
}

const running = (progressStep: string, progress: number) =>
  dubJob({ status: 'running', progressStep, progress, dub: undefined });

describe('dub page', () => {
  afterEach(() => vi.useRealTimers());

  it('follows the steps as the worker reports them, then shows the result', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const events = [
      dubJob({ status: 'queued', attempts: 0, dub: undefined }),
      running('separate', 12),
      running('translate', 55),
      dubJob(),
    ];
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${DUB_ASSET_ID}`, () =>
        HttpResponse.json(dubAsset([events[Math.min(calls++, events.length - 1)]!])),
      ),
      http.get(`${STORAGE_ORIGIN}/dubbed.vtt`, () => HttpResponse.text(VTT)),
    );
    renderApp({ signedIn: true, route: ROUTE });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'cliffs.mp4 · German' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for a free worker…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Translation progress' })).toHaveAttribute(
      'value',
      '0',
    );

    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('12% done')).toBeInTheDocument();
    expect(
      screen.getByText('Separate the voice and recognise the speech').closest('li'),
    ).toHaveAttribute('aria-current', 'step');

    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByText('55% done')).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Extract the sound (done)',
      'Separate the voice and recognise the speech (done)',
      'Time every word (done)',
      'Translate (in progress)',
      'Voice the translation (to do)',
      'Mix it over the background (to do)',
    ]);

    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS));
    expect(await screen.findByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/dubbed.mp4`,
    );
    const settled = calls;
    await act(() => vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3));
    expect(calls).toBe(settled);
  });

  it('says it will try again after a provider outage', async () => {
    serve(
      dubJob({
        status: 'scheduled',
        attempts: 1,
        lastError: 'stt_unavailable: openai answered 503',
        dub: undefined,
      }),
    );
    renderApp({ signedIn: true, route: ROUTE });
    expect(
      await screen.findByText(
        'Trying again soon. Last time: Speech recognition is unavailable right now. Try again later.',
      ),
    ).toBeInTheDocument();
  });

  it('plays the dub with its subtitles, switches to the original and offers downloads', async () => {
    serve(dubJob());
    const { user } = renderApp({ signedIn: true, route: ROUTE });

    const video = await screen.findByLabelText('Play cliffs.mp4');
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/dubbed.mp4`);
    await waitFor(() =>
      expect(video.querySelector('track')).toHaveAttribute('label', 'Subtitles · German'),
    );
    expect(video.querySelector('track')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    expect(video.querySelector('track')).toHaveAttribute('srclang', 'de');

    await user.click(screen.getByRole('radio', { name: 'Original' }));
    expect(screen.getByLabelText('Play cliffs.mp4')).toHaveAttribute(
      'src',
      `${STORAGE_ORIGIN}/original.mp4`,
    );
    expect(screen.getByRole('radio', { name: 'Translation · German' })).not.toBeChecked();

    expect(screen.getByRole('link', { name: 'Download MP4 · 2.4 MB' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/dubbed.mp4?download`,
    );
    expect(screen.getByRole('link', { name: 'Download subtitles (VTT)' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/dubbed.vtt?download`,
    );
    expect(screen.getByText('English (detected)')).toBeInTheDocument();
    expect(screen.getByText('3: 2 sped up, 2 shortened, 1 ran over')).toBeInTheDocument();
  });

  it('carries on from the same moment after switching the soundtrack', async () => {
    serve(dubJob());
    const { user } = renderApp({ signedIn: true, route: ROUTE });
    const video = await screen.findByLabelText<HTMLVideoElement>('Play cliffs.mp4');
    Object.defineProperty(video, 'currentTime', { value: 4.2, writable: true });

    await user.click(screen.getByRole('radio', { name: 'Original' }));
    const original = screen.getByLabelText<HTMLVideoElement>('Play cliffs.mp4');
    expect(original).not.toBe(video);
    fireEvent.loadedMetadata(original);
    expect(original.currentTime).toBe(4.2);
  });

  it.each([
    ['no_speech: nothing recognised', 'No speech was recognised in the video.'],
    ['too_long: 75 s', 'The video is longer than a minute.'],
    ['same_language: already de', 'The speech is already in the language of the translation.'],
    ['no_audio: silent', 'The video has no sound.'],
  ])('explains a failure that another try would not fix (%s)', async (lastError, message) => {
    serve(dubJob({ status: 'dead', deadReason: 'permanent', lastError, dub: undefined }));
    renderApp({ signedIn: true, route: ROUTE });

    expect(
      await screen.findByRole('heading', { name: 'The video was not translated' }),
    ).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the file' })).toHaveAttribute(
      'href',
      `/library/${DUB_ASSET_ID}`,
    );
  });

  it('starts the same dub again after an outage and opens it', async () => {
    const bodies: unknown[] = [];
    const retried = 'd0000000-0000-4000-8000-000000000002';
    serve(
      dubJob({
        status: 'dead',
        deadReason: 'exhausted',
        lastError: 'stt_unavailable: still down',
        dub: undefined,
      }),
      dubJob({ id: retried, status: 'queued', attempts: 0, dub: undefined }),
    );
    server.use(
      http.post('/v1/jobs', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ jobId: retried }, { status: 202 });
      }),
    );
    const { user, router } = renderApp({ signedIn: true, route: ROUTE });

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/library/${DUB_ASSET_ID}/dubs/${retried}`),
    );
    expect(bodies).toEqual([
      {
        type: 'video.dub',
        sourceKey: 'u/1/cliffs',
        targetLanguage: 'de',
        sourceLanguage: 'auto',
      },
    ]);
    expect(await screen.findByText('Waiting for a free worker…')).toBeInTheDocument();
  });

  it('shows the worker’s message for a failure it has no words for', async () => {
    serve(dubJob({ status: 'failed', lastError: 'ffmpeg exited with 1', dub: undefined }));
    renderApp({ signedIn: true, route: ROUTE });
    expect(await screen.findByText('Something went wrong while translating.')).toBeInTheDocument();
    expect(screen.getByText('ffmpeg exited with 1')).toBeInTheDocument();
  });

  it('says so when the file has no such dub', async () => {
    serve(dubJob({ id: 'd0000000-0000-4000-8000-000000000009' }));
    renderApp({ signedIn: true, route: ROUTE });
    expect(
      await screen.findByRole('heading', { name: 'Translation not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the file' })).toHaveAttribute(
      'href',
      `/library/${DUB_ASSET_ID}`,
    );
  });

  it('says so when the file is gone', async () => {
    server.use(
      http.get(`/v1/assets/${DUB_ASSET_ID}`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 }),
      ),
    );
    renderApp({ signedIn: true, route: ROUTE });
    expect(
      await screen.findByRole('heading', { name: 'Translation not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the library' })).toBeInTheDocument();
  });

  it('offers a retry when the gateway fails, and shows a loading state first', async () => {
    let calls = 0;
    server.use(
      http.get(`/v1/assets/${DUB_ASSET_ID}`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 500 })
          : HttpResponse.json(dubAsset([dubJob({ status: 'queued', dub: undefined })]));
      }),
    );
    const { user } = renderApp({ signedIn: true, route: ROUTE });

    expect(
      await screen.findByRole('status', { name: 'Loading the translation…' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Could not load the translation' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Waiting for a free worker…')).toBeInTheDocument();
  });

  it('plays without subtitles when they cannot be fetched', async () => {
    let refused = 0;
    server.use(
      http.get(`/v1/assets/${DUB_ASSET_ID}`, () => HttpResponse.json(dubAsset([dubJob()]))),
      http.get(TEST_DUB.subtitles.url, () => {
        refused += 1;
        return new HttpResponse(null, { status: 403 });
      }),
    );
    renderApp({ signedIn: true, route: ROUTE });
    const video = await screen.findByLabelText('Play cliffs.mp4');
    await waitFor(() => expect(refused).toBe(1));
    await act(() => Promise.resolve());

    expect(video.querySelector('track')).toBeNull();
    expect(video).toHaveAttribute('src', `${STORAGE_ORIGIN}/dubbed.mp4`);
    expect(screen.getByRole('link', { name: 'Download subtitles (VTT)' })).toBeInTheDocument();
  });
});

describe('dub transcript', () => {
  const cellsOf = (row: HTMLElement) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

  it('lays the original beside the translation, with what fitting did to each phrase', async () => {
    serve(dubJob());
    renderApp({ signedIn: true, route: ROUTE });
    const table = within(await screen.findByRole('table'));

    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Time',
      'Speaker',
      'English',
      'German',
    ]);
    const [, ...rows] = table.getAllByRole('row');
    expect(rows.map(cellsOf)).toEqual([
      ['0:01', 'Speaker A', 'Where are you going?', 'Wohin gehst du?'],
      [
        '0:04',
        'Speaker B',
        'Home, before it rains.',
        'Nach Hause, bevor es regnet.Sped up ×1.3Shortened',
      ],
      [
        '0:06',
        'Speaker A',
        'Wait for me.',
        'Warte auf mich, bitte, ich komme gleich.Sped up ×1.4ShortenedRuns over',
      ],
      ['0:08', 'Speech not recognised, until 0:10: not translated'],
    ]);
    expect(table.getByText('Runs over')).toHaveAttribute(
      'title',
      'Still too long: it runs into the next phrase or past the end of the video.',
    );
  });

  it('jumps to a phrase and marks the one being heard', async () => {
    serve(dubJob());
    const { user } = renderApp({ signedIn: true, route: ROUTE });
    const video = await screen.findByLabelText<HTMLVideoElement>('Play cliffs.mp4');
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
    const rowOf = (text: string) => screen.getByText(text).closest('tr');
    expect(screen.getByRole('table').querySelector('[aria-current]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Play from 0:04' }));
    expect(video.currentTime).toBe(4);
    expect(rowOf('Home, before it rains.')).toHaveAttribute('aria-current', 'true');

    video.currentTime = 1.2;
    fireEvent.timeUpdate(video);
    expect(rowOf('Where are you going?')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Home, before it rains.')).not.toHaveAttribute('aria-current');
  });

  it('says so when nothing was recognised', async () => {
    serve(dubJob({ dub: { ...TEST_DUB, phrases: [], unrecognized: [], speakers: [] } }));
    renderApp({ signedIn: true, route: ROUTE });
    expect(await screen.findByText('No speech was recognised.')).toBeInTheDocument();
    expect(screen.getByText('No speakers were found.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('dub speakers', () => {
  const REDUB_ID = 'd0000000-0000-4000-8000-000000000003';

  function serveRedub(reply: () => Response) {
    const bodies: unknown[] = [];
    serve(dubJob(), dubJob({ id: REDUB_ID, status: 'queued', attempts: 0, dub: undefined }));
    server.use(
      http.post('/v1/jobs', async ({ request }) => {
        bodies.push(await request.json());
        return reply();
      }),
    );
    return bodies;
  }

  it('lists who speaks, and voices again with only the corrections', async () => {
    const bodies = serveRedub(() => HttpResponse.json({ jobId: REDUB_ID }, { status: 202 }));
    const { user, router } = renderApp({ signedIn: true, route: ROUTE });
    const speakers = within(await screen.findByRole('region', { name: 'Speakers' }));

    expect(speakers.getByText('0:07 of speech · Male voice, 81% sure')).toBeInTheDocument();
    expect(speakers.getByText('0:03 of speech · Female voice, 70% sure')).toBeInTheDocument();
    expect(speakers.getByLabelText('Voice for Speaker B')).toHaveDisplayValue('Voice 2');
    const redub = speakers.getByRole('button', { name: 'Voice again' });
    expect(redub).toBeDisabled();

    await user.selectOptions(speakers.getByLabelText('Voice type for Speaker B'), 'Male voice');
    expect(speakers.getByLabelText('Voice for Speaker B')).toHaveDisplayValue('Voice 2');
    expect(redub).toBeEnabled();
    await user.click(redub);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/library/${DUB_ASSET_ID}/dubs/${REDUB_ID}`),
    );
    expect(bodies).toEqual([
      {
        type: 'video.dub',
        sourceKey: 'u/1/cliffs',
        targetLanguage: 'de',
        sourceLanguage: 'auto',
        speakers: { B: { gender: 'male', voice: 'M2' } },
        reuseOf: DUB_JOB_ID,
      },
    ]);
    expect(await screen.findByText('Waiting for a free worker…')).toBeInTheDocument();
  });

  it('goes back to nothing to send when a correction is undone', async () => {
    serveRedub(() => HttpResponse.json({ jobId: REDUB_ID }, { status: 202 }));
    const { user } = renderApp({ signedIn: true, route: ROUTE });
    const speakers = within(await screen.findByRole('region', { name: 'Speakers' }));
    const voice = speakers.getByLabelText('Voice for Speaker A');

    await user.selectOptions(voice, 'Voice 3');
    expect(speakers.getByRole('button', { name: 'Voice again' })).toBeEnabled();
    await user.selectOptions(voice, 'Voice 1');
    expect(speakers.getByRole('button', { name: 'Voice again' })).toBeDisabled();
  });

  it('says so when the month’s translation time has run out', async () => {
    serveRedub(() =>
      HttpResponse.json(
        { statusCode: 429, code: 'DUB_QUOTA_EXCEEDED', message: 'quota' },
        { status: 429 },
      ),
    );
    const { user, router } = renderApp({ signedIn: true, route: ROUTE });
    const speakers = within(await screen.findByRole('region', { name: 'Speakers' }));

    await user.selectOptions(speakers.getByLabelText('Voice for Speaker A'), 'Voice 4');
    await user.click(speakers.getByRole('button', { name: 'Voice again' }));
    expect(await speakers.findByRole('alert')).toHaveTextContent(
      'Not enough translation time left this month.',
    );
    expect(router.state.location.pathname).toBe(ROUTE);
  });
});
