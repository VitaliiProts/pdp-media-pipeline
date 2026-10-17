import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type Job } from '../../features/jobs';
import { renderApp } from '../../test/render-app';
import { server, STORAGE_ORIGIN } from '../../test/server';

const job = (overrides: Partial<Job> = {}): Job => ({
  id: '0b6f1c2e-0000-4000-8000-000000000001',
  type: 'image.resize',
  status: 'queued',
  attempts: 0,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  traceId: null,
  ...overrides,
});

const VIDEO_JOB_ID = '99999999-0000-4000-8000-000000000009';

const CORS = {
  'Access-Control-Allow-Origin': window.location.origin,
  'Access-Control-Allow-Methods': 'PUT',
  'Access-Control-Allow-Headers': 'content-type',
};

const listJobs = (items: Job[]) =>
  http.get('/v1/jobs', () => HttpResponse.json({ items, nextCursor: null }));

/** Starting an upload takes the user to the library. */
const emptyLibrary = http.get('/v1/assets', () =>
  HttpResponse.json({ items: [], nextCursor: null }),
);

async function openUpload(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('button', { name: 'Upload' }));
}

async function backToJobs({ user, router }: ReturnType<typeof renderApp>) {
  await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
  await user.click(screen.getByRole('link', { name: 'Jobs' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
}

describe('jobs sheet', () => {
  it('shows result links for finished jobs and why dead ones stopped', async () => {
    server.use(
      listJobs([
        job({
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          status: 'succeeded',
          attempts: 1,
          results: [
            {
              preset: 'thumb',
              width: 200,
              height: 133,
              bytes: 9_400,
              url: `${STORAGE_ORIGIN}/t.webp`,
            },
          ],
        }),
        job({
          id: 'bbbbbbbb-0000-4000-8000-000000000002',
          status: 'dead',
          attempts: 3,
          lastError: 'unsupported image format',
          deadReason: 'permanent',
        }),
      ]),
    );
    renderApp({ signedIn: true });

    const done = (await screen.findByRole('heading', { name: 'Job aaaaaaaa' })).closest('article');
    if (!done) throw new Error('mount not found');
    expect(within(done).getByText('Done')).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: /Thumbnail/ })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/t.webp`,
    );

    const dead = screen.getByRole('heading', { name: 'Job bbbbbbbb' }).closest('article');
    if (!dead) throw new Error('mount not found');
    expect(within(dead).getByText('Gave up')).toBeInTheDocument();
    expect(within(dead).getByText('Attempt 3')).toBeInTheDocument();
    expect(within(dead).getByText('unsupported image format')).toBeInTheDocument();
    expect(within(dead).getByText('This file cannot be processed.')).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  });

  it('links each job to its trace and logs once Grafana is configured', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    server.use(
      http.get('/config.json', () => HttpResponse.json({ grafanaUrl: 'http://grafana.test/' })),
      listJobs([job({ id: 'cccccccc-0000-4000-8000-000000000003', traceId })]),
    );
    renderApp({ signedIn: true });

    const mount = (await screen.findByRole('heading', { name: 'Job cccccccc' })).closest('article');
    if (!mount) throw new Error('mount not found');
    const link = await within(mount).findByRole('link', { name: 'Trace and logs' });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('http://grafana.test/d/pdp-job/job');
    expect(url.searchParams.get('var-trace_id')).toBe(traceId);
    expect(url.searchParams.get('var-job_id')).toBe('cccccccc-0000-4000-8000-000000000003');
  });

  it('shows no trace link without Grafana', async () => {
    server.use(listJobs([job({ id: 'dddddddd-0000-4000-8000-000000000004' })]));
    renderApp({ signedIn: true });

    const mount = (await screen.findByRole('heading', { name: 'Job dddddddd' })).closest('article');
    if (!mount) throw new Error('mount not found');
    await waitFor(() => expect(within(mount).queryByRole('link')).not.toBeInTheDocument());
  });

  it('runs a dead job again and shows it queued', async () => {
    const id = 'eeeeeeee-0000-4000-8000-000000000005';
    let redriven = false;
    server.use(
      http.get('/v1/jobs', () =>
        HttpResponse.json({
          items: [
            redriven
              ? job({ id, status: 'queued', attempts: 5 })
              : job({
                  id,
                  status: 'dead',
                  attempts: 5,
                  lastError: 'connect ECONNREFUSED',
                  deadReason: 'exhausted',
                }),
          ],
          nextCursor: null,
        }),
      ),
      http.post(`/v1/jobs/${id}/redrive`, () => {
        redriven = true;
        return HttpResponse.json(job({ id, status: 'queued', attempts: 5 }), { status: 202 });
      }),
    );
    const { user } = renderApp({ signedIn: true });

    const mount = (await screen.findByRole('heading', { name: 'Job eeeeeeee' })).closest('article');
    if (!mount) throw new Error('mount not found');
    expect(within(mount).getByText('Every attempt failed.')).toBeInTheDocument();
    await user.click(within(mount).getByRole('button', { name: 'Run again' }));

    await waitFor(() => {
      const card = screen.getByRole('heading', { name: 'Job eeeeeeee' }).closest('article');
      expect(card && within(card).getByText('Queued')).toBeInTheDocument();
    });
    expect(redriven).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  });

  it('says so when a redrive is refused', async () => {
    const id = 'ffffffff-0000-4000-8000-000000000006';
    server.use(
      listJobs([job({ id, status: 'dead', attempts: 1, deadReason: 'permanent' })]),
      http.post(`/v1/jobs/${id}/redrive`, () =>
        HttpResponse.json({ code: 'NOT_REDRIVABLE', message: 'not dead' }, { status: 409 }),
      ),
    );
    const { user } = renderApp({ signedIn: true });

    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the job again.');
  });

  it('reports a failed load and recovers on retry', async () => {
    let calls = 0;
    server.use(
      http.get('/v1/jobs', () =>
        ++calls === 1
          ? HttpResponse.json({ message: 'boom' }, { status: 503 })
          : HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    const { user } = renderApp({ signedIn: true });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load jobs');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('keeps the status filter in the URL', async () => {
    const statuses: (string | null)[] = [];
    server.use(
      http.get('/v1/jobs', ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status'));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { user, router } = renderApp({ signedIn: true });
    await screen.findByText(/No jobs yet/);

    await user.click(screen.getByRole('button', { name: 'Gave up' }));

    expect(await screen.findByText('No jobs with this status.')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?status=dead');
    expect(statuses).toContain('dead');
  });

  it('announces jobs that finish while the page is open', async () => {
    const id = 'abababab-0000-4000-8000-000000000007';
    let polls = 0;
    server.use(
      http.get('/v1/jobs', () =>
        HttpResponse.json({
          items: [job({ id, status: ++polls === 1 ? 'running' : 'succeeded', attempts: 1 })],
          nextCursor: null,
        }),
      ),
    );
    renderApp({ signedIn: true });
    await screen.findByRole('heading', { name: 'Job abababab' });
    expect(
      await screen.findByText('Job abababab — Done', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe('uploading', () => {
  it('uploads the file to storage, creates a job and shows it on the sheet', async () => {
    const jobId = 'cccccccc-0000-4000-8000-000000000003';
    let created = false;
    let putContentType: string | null = null;
    let jobBody: unknown = null;
    let idempotencyKey: string | null = null;
    server.use(
      emptyLibrary,
      http.get('/v1/jobs', () =>
        HttpResponse.json({ items: created ? [job({ id: jobId })] : [], nextCursor: null }),
      ),
      http.post('/v1/uploads', () =>
        HttpResponse.json({
          uploadUrl: `${STORAGE_ORIGIN}/sources/1.png?sig=x`,
          sourceKey: 'sources/1.png',
        }),
      ),
      // Storage lives on another origin, so the browser preflights the PUT.
      http.options(
        `${STORAGE_ORIGIN}/sources/1.png`,
        () => new HttpResponse(null, { status: 204, headers: CORS }),
      ),
      http.put(`${STORAGE_ORIGIN}/sources/1.png`, ({ request }) => {
        putContentType = request.headers.get('content-type');
        return new HttpResponse(null, { status: 200, headers: CORS });
      }),
      http.post('/v1/jobs', async ({ request }) => {
        jobBody = await request.json();
        idempotencyKey = request.headers.get('idempotency-key');
        created = true;
        return HttpResponse.json({ jobId }, { status: 201 });
      }),
    );
    const app = renderApp({ signedIn: true });
    const { user } = app;
    await screen.findByText(/No jobs yet/);
    await openUpload(user);

    await user.click(screen.getByLabelText(/Large/));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    await backToJobs(app);

    const mount = (await screen.findByRole('heading', { name: 'harbour.png' })).closest('article');
    if (!mount) throw new Error('mount not found');
    await waitFor(() => expect(within(mount).getByText('Queued')).toBeInTheDocument());
    expect(putContentType).toBe('image/png');
    expect(jobBody).toEqual({
      type: 'image.resize',
      sourceKey: 'sources/1.png',
      presets: ['thumb', 'medium'],
    });
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects unusable files locally and lets the user remove them', async () => {
    server.use(listJobs([]), emptyLibrary);
    const app = renderApp({ signedIn: true });
    const { user } = app;
    await screen.findByText(/No jobs yet/);
    await openUpload(user);

    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );
    await backToJobs(app);

    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('empty.png')).not.toBeInTheDocument();
  });
});

describe('video', () => {
  it('creates a frames job for a video file', async () => {
    let jobBody: unknown = null;
    server.use(
      listJobs([]),
      emptyLibrary,
      http.post('/v1/uploads', () =>
        HttpResponse.json({
          uploadUrl: `${STORAGE_ORIGIN}/sources/3.mp4?sig=x`,
          sourceKey: 'sources/3.mp4',
        }),
      ),
      http.options(
        `${STORAGE_ORIGIN}/sources/3.mp4`,
        () => new HttpResponse(null, { status: 204, headers: CORS }),
      ),
      http.put(
        `${STORAGE_ORIGIN}/sources/3.mp4`,
        () => new HttpResponse(null, { status: 200, headers: CORS }),
      ),
      http.post('/v1/jobs', async ({ request }) => {
        jobBody = await request.json();
        return HttpResponse.json({ jobId: VIDEO_JOB_ID }, { status: 201 });
      }),
    );
    const { user } = renderApp({ signedIn: true });
    await screen.findByText(/No jobs yet/);
    await openUpload(user);

    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'clip.mp4', { type: 'video/mp4' }),
    );

    await waitFor(() =>
      expect(jobBody).toEqual({ type: 'video.frames', sourceKey: 'sources/3.mp4' }),
    );
  });

  it('shows the preview and the frames of a finished video', async () => {
    const frame = (atSeconds: number) => ({
      atSeconds,
      width: 640,
      height: 360,
      bytes: 4_000,
      url: `${STORAGE_ORIGIN}/frames/${atSeconds}.jpg`,
    });
    server.use(
      listJobs([
        job({
          id: VIDEO_JOB_ID,
          type: 'video.frames',
          status: 'succeeded',
          attempts: 1,
          video: {
            durationSeconds: 4,
            width: 1280,
            height: 720,
            codec: 'h264',
            preview: { ...frame(1), url: `${STORAGE_ORIGIN}/preview.jpg` },
            frames: [frame(0), frame(2)],
          },
        }),
      ]),
    );
    renderApp({ signedIn: true });

    const mount = (await screen.findByRole('heading', { name: 'Job 99999999' })).closest('article');
    if (!mount) throw new Error('mount not found');
    const frames = within(mount).getByRole('list', { name: 'Frames' });
    expect(within(frames).getByRole('link', { name: 'Frame at 0:02' })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/frames/2.jpg`,
    );
    expect(within(frames).getAllByRole('listitem')).toHaveLength(2);
  });

  it('creates a transcode job when transcoding is chosen', async () => {
    let jobBody: unknown = null;
    server.use(
      listJobs([]),
      emptyLibrary,
      http.post('/v1/uploads', () =>
        HttpResponse.json({
          uploadUrl: `${STORAGE_ORIGIN}/sources/4.mp4?sig=x`,
          sourceKey: 'sources/4.mp4',
        }),
      ),
      http.options(
        `${STORAGE_ORIGIN}/sources/4.mp4`,
        () => new HttpResponse(null, { status: 204, headers: CORS }),
      ),
      http.put(
        `${STORAGE_ORIGIN}/sources/4.mp4`,
        () => new HttpResponse(null, { status: 200, headers: CORS }),
      ),
      http.post('/v1/jobs', async ({ request }) => {
        jobBody = await request.json();
        return HttpResponse.json({ jobId: VIDEO_JOB_ID }, { status: 201 });
      }),
    );
    const { user } = renderApp({ signedIn: true });
    await screen.findByText(/No jobs yet/);
    await openUpload(user);

    await user.click(screen.getByRole('radio', { name: /Transcode/ }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'clip.mp4', { type: 'video/mp4' }),
    );

    await waitFor(() =>
      expect(jobBody).toEqual({ type: 'video.transcode', sourceKey: 'sources/4.mp4' }),
    );
  });

  it('shows the progress of a running transcode', async () => {
    server.use(
      listJobs([
        job({ id: VIDEO_JOB_ID, type: 'video.transcode', status: 'running', progress: 40 }),
      ]),
    );
    renderApp({ signedIn: true });
    expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '0.4');
  });

  it('lists the renditions of a finished transcode as downloads', async () => {
    server.use(
      listJobs([
        job({
          id: VIDEO_JOB_ID,
          type: 'video.transcode',
          status: 'succeeded',
          attempts: 1,
          transcode: {
            durationSeconds: 10,
            width: 1920,
            height: 1080,
            codec: 'h264',
            preview: {
              atSeconds: 1,
              width: 640,
              height: 360,
              bytes: 4_000,
              url: `${STORAGE_ORIGIN}/preview.jpg`,
            },
            renditions: [
              {
                rendition: '720p',
                width: 1280,
                height: 720,
                durationSeconds: 10,
                bytes: 2_500_000,
                bitrate: 2_000_000,
                url: `${STORAGE_ORIGIN}/720p.mp4`,
              },
            ],
            skipped: [],
          },
        }),
      ]),
    );
    renderApp({ signedIn: true });
    const results = await screen.findByRole('list', { name: 'Results' });
    expect(within(results).getByRole('link', { name: /720p/ })).toHaveAttribute(
      'href',
      `${STORAGE_ORIGIN}/720p.mp4`,
    );
  });
});

describe('when the gateway asks to come back later', () => {
  it('waits out a full queue and creates the job on retry', async () => {
    const jobId = 'dddddddd-0000-4000-8000-000000000004';
    let attempts = 0;
    const keys: (string | null)[] = [];
    // Held until the user is back on the sheet: the wait it leads to lasts about a second.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      emptyLibrary,
      http.get('/v1/jobs', () =>
        HttpResponse.json({ items: attempts > 1 ? [job({ id: jobId })] : [], nextCursor: null }),
      ),
      http.post('/v1/uploads', async () => {
        await held;
        return HttpResponse.json({
          uploadUrl: `${STORAGE_ORIGIN}/sources/2.png?sig=x`,
          sourceKey: 'sources/2.png',
        });
      }),
      http.options(
        `${STORAGE_ORIGIN}/sources/2.png`,
        () => new HttpResponse(null, { status: 204, headers: CORS }),
      ),
      http.put(
        `${STORAGE_ORIGIN}/sources/2.png`,
        () => new HttpResponse(null, { status: 200, headers: CORS }),
      ),
      http.post('/v1/jobs', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return ++attempts === 1
          ? HttpResponse.json(
              { statusCode: 503, message: 'the cpu queue is full, retry later' },
              { status: 503, headers: { 'Retry-After': '1' } },
            )
          : HttpResponse.json({ jobId }, { status: 202 });
      }),
    );
    const app = renderApp({ signedIn: true });
    const { user } = app;
    await screen.findByText(/No jobs yet/);
    await openUpload(user);

    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'busy.png', { type: 'image/png' }),
    );
    await backToJobs(app);
    release();

    expect(await screen.findByText('Queue is full, waiting')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/retry in \d s/);
    await waitFor(
      () => {
        const mount = screen.getByRole('heading', { name: 'busy.png' }).closest('article');
        expect(mount && within(mount).getByText('Queued')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(attempts).toBe(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('says how long until the next refresh when polling is rate limited', async () => {
    server.use(
      http.get(
        '/v1/jobs',
        () =>
          new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '3', 'RateLimit-Remaining': '0' },
          }),
      ),
    );
    renderApp({ signedIn: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Refreshing in 3 seconds.',
    );
  });
});
