import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type Job } from '../features/jobs';
import { renderApp, TEST_API_KEY } from '../test/render-app';
import { server, STORAGE_ORIGIN } from '../test/server';

const job = (overrides: Partial<Job> = {}): Job => ({
  id: '0b6f1c2e-0000-4000-8000-000000000001',
  status: 'queued',
  attempts: 0,
  lastError: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  ...overrides,
});

const CORS = {
  'Access-Control-Allow-Origin': window.location.origin,
  'Access-Control-Allow-Methods': 'PUT',
  'Access-Control-Allow-Headers': 'content-type',
};

const listJobs = (items: Job[]) =>
  http.get('/v1/jobs', () => HttpResponse.json({ items, nextCursor: null }));

describe('API key gate', () => {
  it('asks for a key and sends it with every request', async () => {
    const seenKeys: (string | null)[] = [];
    server.use(
      http.get('/v1/jobs', ({ request }) => {
        seenKeys.push(request.headers.get('x-api-key'));
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { user } = renderApp();

    await user.type(screen.getByLabelText('API key'), `  ${TEST_API_KEY} `);
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

describe('jobs sheet', () => {
  it('shows result links for finished jobs and the error of failed ones', async () => {
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
        }),
      ]),
    );
    renderApp({ apiKey: TEST_API_KEY });

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
    const { user } = renderApp({ apiKey: TEST_API_KEY });

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
    const { user } = renderApp({ apiKey: TEST_API_KEY });
    await screen.findByText(/No jobs yet/);

    await user.click(screen.getByRole('button', { name: 'Failed' }));

    expect(await screen.findByText('No jobs with this status.')).toBeInTheDocument();
    expect(window.location.search).toBe('?status=failed');
    expect(statuses).toContain('failed');
  });
});

describe('uploading', () => {
  it('uploads the file to storage, creates a job and shows it on the sheet', async () => {
    const jobId = 'cccccccc-0000-4000-8000-000000000003';
    let created = false;
    let putContentType: string | null = null;
    let jobBody: unknown = null;
    server.use(
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
        created = true;
        return HttpResponse.json({ jobId }, { status: 201 });
      }),
    );
    const { user } = renderApp({ apiKey: TEST_API_KEY });
    await screen.findByText(/No jobs yet/);

    await user.click(screen.getByLabelText(/Large/));
    await user.upload(
      screen.getByLabelText(/Drop images here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );

    const mount = (await screen.findByRole('heading', { name: 'harbour.png' })).closest('article');
    if (!mount) throw new Error('mount not found');
    await waitFor(() => expect(within(mount).getByText('Queued')).toBeInTheDocument());
    expect(putContentType).toBe('image/png');
    expect(jobBody).toEqual({
      type: 'image.resize',
      sourceKey: 'sources/1.png',
      presets: ['thumb', 'medium'],
    });
  });

  it('rejects unusable files locally and lets the user remove them', async () => {
    server.use(listJobs([]));
    const { user } = renderApp({ apiKey: TEST_API_KEY });
    await screen.findByText(/No jobs yet/);

    await user.upload(
      screen.getByLabelText(/Drop images here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('empty.png')).not.toBeInTheDocument();
  });
});
