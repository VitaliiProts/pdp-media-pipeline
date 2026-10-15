import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type Job } from '../../features/jobs';
import { renderApp, TEST_API_KEY } from '../../test/render-app';
import { server } from '../../test/server';

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

describe('webhooks', () => {
  const ENDPOINT = {
    id: '11111111-0000-4000-8000-00000000000a',
    url: 'https://hooks.example.com/pdp',
    events: ['job.succeeded', 'job.dead'],
    createdAt: '2026-10-09T10:00:00.000Z',
  };
  const DELIVERY_ID = '22222222-0000-4000-8000-00000000000b';
  const delivery = (overrides: Record<string, unknown> = {}) => ({
    id: DELIVERY_ID,
    messageId: 'msg_abc',
    event: 'job.succeeded',
    jobId: VIDEO_JOB_ID,
    status: 'dead',
    attempts: 5,
    responseStatus: null,
    lastError: 'receiver answered 500',
    deadReason: 'exhausted',
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-09T10:01:00.000Z',
    ...overrides,
  });

  it('adds an endpoint and shows its secret once', async () => {
    let endpoints: (typeof ENDPOINT)[] = [];
    let body: unknown = null;
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: endpoints })),
      http.post('/v1/webhooks', async ({ request }) => {
        body = await request.json();
        endpoints = [ENDPOINT];
        return HttpResponse.json({ ...ENDPOINT, secret: 'whsec_c2VjcmV0' }, { status: 201 });
      }),
      http.get(`/v1/webhooks/${ENDPOINT.id}/deliveries`, () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });
    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/URL that receives/), ENDPOINT.url);
    await user.click(screen.getByLabelText(/Job gave up/));
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));

    expect(await screen.findByText('whsec_c2VjcmV0')).toBeInTheDocument();
    expect(body).toEqual({ url: ENDPOINT.url, events: ['job.succeeded'] });
    expect(await screen.findByText(/Nothing sent yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(screen.queryByText('whsec_c2VjcmV0')).not.toBeInTheDocument();
  });

  it('explains why the gateway refused an endpoint', async () => {
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: [] })),
      http.post('/v1/webhooks', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'url resolves to a non-public address' },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });

    await user.type(await screen.findByLabelText(/URL that receives/), 'http://10.0.0.1/hook');
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The gateway rejected the endpoint.');
    expect(alert).toHaveTextContent('url resolves to a non-public address');
  });

  it('lists deliveries and sends a dead one again', async () => {
    let redriven = false;
    server.use(
      http.get('/v1/webhooks', () => HttpResponse.json({ items: [ENDPOINT] })),
      http.get(`/v1/webhooks/${ENDPOINT.id}/deliveries`, () =>
        HttpResponse.json({
          items: [redriven ? delivery({ status: 'queued', deadReason: null }) : delivery()],
          nextCursor: null,
        }),
      ),
      http.post(`/v1/jobs/${DELIVERY_ID}/redrive`, () => {
        redriven = true;
        return HttpResponse.json(job({ id: DELIVERY_ID, type: 'webhook.deliver' }), {
          status: 202,
        });
      }),
    );
    const { user } = renderApp({ apiKey: TEST_API_KEY, route: '/webhooks' });

    const row = (await screen.findByText('msg_abc')).closest('tr');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText('Gave up')).toBeInTheDocument();
    expect(within(row).getByText('receiver answered 500')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Run again' }));

    await waitFor(() => expect(screen.getByText('Waiting')).toBeInTheDocument());
    expect(redriven).toBe(true);
  });
});
