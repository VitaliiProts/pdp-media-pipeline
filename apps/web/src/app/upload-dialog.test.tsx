import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { type Job } from '../features/jobs';
import { TEST_EMAIL, TEST_PASSWORD, testAsset } from '../test/fixtures';
import { renderApp } from '../test/render-app';
import { server, STORAGE_ORIGIN } from '../test/server';

const CORS = {
  'Access-Control-Allow-Origin': window.location.origin,
  'Access-Control-Allow-Methods': 'PUT',
  'Access-Control-Allow-Headers': 'content-type',
};

const JOB_ID = '12121212-0000-4000-8000-000000000012';
const queued: Job = {
  id: JOB_ID,
  type: 'image.resize',
  status: 'queued',
  attempts: 0,
  lastError: null,
  deadReason: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  traceId: null,
};

const ASSET = testAsset({
  id: 'a0000000-0000-4000-8000-000000000009',
  name: 'harbour.png',
  preview: null,
  latestJob: { id: JOB_ID, type: 'image.resize', status: 'queued' },
});

function uploadHandlers() {
  let created = false;
  const uploadBodies: unknown[] = [];
  server.use(
    http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
    http.get('/v1/jobs', () =>
      HttpResponse.json({ items: created ? [queued] : [], nextCursor: null }),
    ),
    http.get('/v1/assets', () =>
      HttpResponse.json({ items: created ? [ASSET] : [], nextCursor: null }),
    ),
    http.post('/v1/uploads', async ({ request }) => {
      uploadBodies.push(await request.json());
      return HttpResponse.json({
        uploadUrl: `${STORAGE_ORIGIN}/sources/9.png?sig=x`,
        sourceKey: 'sources/9.png',
      });
    }),
    http.options(
      `${STORAGE_ORIGIN}/sources/9.png`,
      () => new HttpResponse(null, { status: 204, headers: CORS }),
    ),
    http.put(
      `${STORAGE_ORIGIN}/sources/9.png`,
      () => new HttpResponse(null, { status: 200, headers: CORS }),
    ),
    http.post('/v1/jobs', () => {
      created = true;
      return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
    }),
  );
  return { uploadBodies };
}

describe('upload dialog', () => {
  it('takes the upload to the library, where the file shows once', async () => {
    const { uploadBodies } = uploadHandlers();
    const { user, router } = renderApp({ signedIn: true, route: '/webhooks' });

    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload files' });
    await user.upload(
      within(dialog).getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );

    expect(dialog).not.toHaveAttribute('open');
    expect(await screen.findByText('Uploading 1 file.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(await screen.findByRole('link', { name: /harbour\.png/ })).toBeInTheDocument();
    // The local tile gave way to the server's one.
    await waitFor(() => expect(screen.getAllByText('harbour.png')).toHaveLength(1));
    expect(uploadBodies).toEqual([{ contentType: 'image/png', size: 64, name: 'harbour.png' }]);
  });

  it('refreshes the library as soon as the job is created, not on the next poll', async () => {
    uploadHandlers();
    let listRequests = 0;
    let releaseJob: () => void = () => undefined;
    const jobHeld = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    server.use(
      http.get('/v1/assets', () => {
        listRequests += 1;
        return HttpResponse.json({ items: listRequests > 1 ? [ASSET] : [], nextCursor: null });
      }),
      http.post('/v1/jobs', async () => {
        await jobHeld;
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await waitFor(() => expect(listRequests).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('harbour.png')).toBeInTheDocument();
    expect(listRequests).toBe(1);

    releaseJob();
    // Well inside the library's 3 s poll: only the tag invalidation can ask this early.
    await waitFor(() => expect(listRequests).toBe(2), { timeout: 1500 });
    expect(await screen.findByRole('link', { name: /harbour\.png/ })).toBeInTheDocument();
  });

  it('offers an upload from the empty jobs page and moves focus to the library', async () => {
    uploadHandlers();
    const { user } = renderApp({ signedIn: true, route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Upload a file' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload files' });
    expect(dialog).toHaveAttribute('open');

    await user.upload(
      within(dialog).getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toHaveFocus(),
    );
  });

  it('stops and forgets the uploads of a user who signs out', async () => {
    let jobsCreated = 0;
    let releaseStorage: () => void = () => undefined;
    const storageHeld = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
      http.get('/v1/jobs', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post('/v1/uploads', () =>
        HttpResponse.json({
          uploadUrl: `${STORAGE_ORIGIN}/sources/9.png?sig=x`,
          sourceKey: 'sources/9.png',
        }),
      ),
      http.options(
        `${STORAGE_ORIGIN}/sources/9.png`,
        () => new HttpResponse(null, { status: 204, headers: CORS }),
      ),
      http.put(`${STORAGE_ORIGIN}/sources/9.png`, async () => {
        await storageHeld;
        return new HttpResponse(null, { status: 200, headers: CORS });
      }),
      http.post('/v1/jobs', () => {
        jobsCreated += 1;
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    const { user } = renderApp({ signedIn: true, route: '/webhooks' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }), [
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
      new File([], 'empty.png', { type: 'image/png' }),
    ]);
    // The library shows the failure on its tile, so no alert repeats it.
    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
    expect(screen.queryByText('empty.png was not uploaded.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account: dev@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.type(await screen.findByLabelText('Email'), TEST_EMAIL);
    await user.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    releaseStorage();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Your files will live here' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('The file is empty.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Jobs' }));

    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
    await delay(100);
    expect(jobsCreated).toBe(0);
  });

  it('alerts about a failure that happens after leaving the library', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post('/v1/uploads', async () => {
        await held;
        return HttpResponse.json(
          { statusCode: 413, code: 'STORAGE_QUOTA_EXCEEDED', message: 'quota' },
          { status: 413 },
        );
      }),
    );
    const { user, router } = renderApp({ signedIn: true, route: '/webhooks' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    await user.click(screen.getByRole('link', { name: 'Webhooks' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/webhooks'));
    release();

    const message = await screen.findByText(
      'harbour.png was not uploaded: storage is full. Delete files you no longer need.',
    );
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
  });

  it('takes an upload from a filtered library to the unfiltered one, where its tile shows', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    uploadHandlers();
    server.use(
      http.put(`${STORAGE_ORIGIN}/sources/9.png`, async () => {
        await held;
        return new HttpResponse(null, { status: 200, headers: CORS });
      }),
    );
    const { user, router } = renderApp({ signedIn: true, route: '/library?kind=video' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    expect(router.state.location.search).toBe('');
    expect(await screen.findByRole('progressbar', { name: 'Uploading' })).toBeInTheDocument();
    expect(screen.getByText('harbour.png')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('link', { name: /harbour\.png/ })).toBeInTheDocument();
  });

  it('shows a failure from a filtered library on its tile, not as an alert', async () => {
    server.use(http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })));
    const { user, router } = renderApp({ signedIn: true, route: '/library?q=harbour' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('The file is empty.')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
    expect(screen.queryByText('empty.png was not uploaded.')).not.toBeInTheDocument();
  });

  it('shows on the tile when storage is full', async () => {
    server.use(
      http.get('/v1/assets', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post('/v1/uploads', () =>
        HttpResponse.json({ code: 'STORAGE_QUOTA_EXCEEDED', message: 'quota' }, { status: 413 }),
      ),
    );
    const { user } = renderApp({ signedIn: true, route: '/library' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    expect(
      await screen.findByText('Storage is full. Delete files you no longer need.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/was not uploaded/)).not.toBeInTheDocument();
  });
});
