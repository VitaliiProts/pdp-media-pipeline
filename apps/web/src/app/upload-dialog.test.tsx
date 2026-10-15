import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { type Job } from '../features/jobs';
import { TEST_API_KEY } from '../test/fixtures';
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

function uploadHandlers() {
  let created = false;
  server.use(
    http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
    http.get('/v1/jobs', () =>
      HttpResponse.json({ items: created ? [queued] : [], nextCursor: null }),
    ),
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
    http.put(
      `${STORAGE_ORIGIN}/sources/9.png`,
      () => new HttpResponse(null, { status: 200, headers: CORS }),
    ),
    http.post('/v1/jobs', () => {
      created = true;
      return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
    }),
  );
}

describe('upload dialog', () => {
  it('uploads from any page and points to the jobs', async () => {
    uploadHandlers();
    const { user, router } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });

    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload files' });
    await user.upload(
      within(dialog).getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );

    expect(dialog).not.toHaveAttribute('open');
    expect(await screen.findByText('Uploading 1 file.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Open jobs' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
    expect(await screen.findByRole('heading', { name: 'harbour.png' })).toBeInTheDocument();
  });

  it('offers an upload from the empty jobs page and keeps focus on the page', async () => {
    uploadHandlers();
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/jobs' });
    await user.click(await screen.findByRole('button', { name: 'Upload a file' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload files' });
    expect(dialog).toHaveAttribute('open');

    await user.upload(
      within(dialog).getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
  });

  it('stops and forgets the uploads of a user who signs out', async () => {
    let jobsCreated = 0;
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
      http.get('/v1/jobs', () => HttpResponse.json({ items: [], nextCursor: null })),
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
        await delay(150);
        return new HttpResponse(null, { status: 200, headers: CORS });
      }),
      http.post('/v1/jobs', () => {
        jobsCreated += 1;
        return HttpResponse.json({ jobId: JOB_ID }, { status: 202 });
      }),
    );
    const { user, router } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }), [
      new File([new Uint8Array(64)], 'harbour.png', { type: 'image/png' }),
      new File([], 'empty.png', { type: 'image/png' }),
    ]);
    expect(await screen.findByText('empty.png was not uploaded.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account: dev' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.type(await screen.findByLabelText('API key'), TEST_API_KEY);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'));
    await user.click(screen.getByRole('link', { name: 'Jobs' }));

    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
    await delay(300);
    expect(jobsCreated).toBe(0);
    expect(screen.queryAllByText('empty.png was not uploaded.').length).toBeLessThan(2);
  });

  it('alerts about a file that could not be uploaded, away from the jobs page', async () => {
    server.use(http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })));
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });
    await user.click(await screen.findByRole('button', { name: 'Upload' }));
    await user.upload(
      screen.getByLabelText(/Drop images or videos here/, { selector: 'input' }),
      new File([], 'empty.png', { type: 'image/png' }),
    );
    const message = await screen.findByText('empty.png was not uploaded.');
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
  });
});
