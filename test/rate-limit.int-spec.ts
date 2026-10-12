import { type Pool } from 'pg';
import { seedUser } from '../apps/metadata/src/seed-user';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

const USER_BURST = 5;
const GLOBAL_BURST = 8;
const IP_BURST = 3;

describe('rate limiting at the gateway', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let gateway: string;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    alice = db.user.apiKey;
    bob = (await seedUser(infra.databaseUrl, 'int-test-bob')).apiKey;
    apps = createApps(infra);
    await apps.start('metadata');
    // Rates are low enough that refill during a burst of requests is negligible.
    gateway = await apps.start('api-gateway', {
      RATE_LIMIT_USER_RPS: '1',
      RATE_LIMIT_USER_BURST: String(USER_BURST),
      RATE_LIMIT_GLOBAL_RPS: '1',
      RATE_LIMIT_GLOBAL_BURST: String(GLOBAL_BURST),
      RATE_LIMIT_IP_RPS: '1',
      RATE_LIMIT_IP_BURST: String(IP_BURST),
      REDIS_COMMAND_TIMEOUT_MS: '100',
      RATE_LIMIT_REDIS_RETRY_MS: '60000',
    });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  beforeEach(async () => {
    // Resolve both keys once so the IP limit for unknown keys stays out of the way.
    await Promise.all([listJobs(alice), listJobs(bob)]);
    await infra.redisCli('FLUSHALL');
  });

  const listJobs = (apiKey: string) =>
    fetch(`${gateway}/v1/jobs?limit=1`, { headers: { 'x-api-key': apiKey } });

  async function burst(apiKey: string, count: number): Promise<Response[]> {
    const responses: Response[] = [];
    for (let i = 0; i < count; i++) responses.push(await listJobs(apiKey));
    return responses;
  }

  const statuses = (responses: Response[]) => responses.map((r) => r.status);

  it('lets a user burst up to the limit, then answers 429 with Retry-After', async () => {
    const responses = await burst(alice, USER_BURST + 2);

    expect(statuses(responses)).toEqual([...Array<number>(USER_BURST).fill(200), 429, 429]);
    const first = responses[0];
    expect(first?.headers.get('ratelimit-limit')).toBe(String(USER_BURST));
    expect(first?.headers.get('ratelimit-remaining')).toBe(String(USER_BURST - 1));

    const refused = responses[USER_BURST];
    expect(refused?.headers.get('ratelimit-remaining')).toBe('0');
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const body = (await refused?.json()) as { statusCode: number; retryAfterSeconds: number };
    expect(body.statusCode).toBe(429);
    expect(body.retryAfterSeconds).toBe(Number(refused?.headers.get('retry-after')));
  });

  it('caps all users together at the global limit', async () => {
    const aliceStatuses = statuses(await burst(alice, USER_BURST));
    const bobStatuses = statuses(await burst(bob, USER_BURST));

    expect(aliceStatuses).toEqual(Array<number>(USER_BURST).fill(200));
    const bobAllowed = GLOBAL_BURST - USER_BURST;
    expect(bobStatuses).toEqual([
      ...Array<number>(bobAllowed).fill(200),
      ...Array<number>(USER_BURST - bobAllowed).fill(429),
    ]);
  });

  it('limits unknown api keys per client IP before asking metadata', async () => {
    const responses: Response[] = [];
    for (let i = 0; i < IP_BURST + 2; i++) {
      responses.push(await listJobs(`pdp_unknown_${i}_${'x'.repeat(32)}`));
    }

    expect(statuses(responses)).toEqual([...Array<number>(IP_BURST).fill(401), 429, 429]);
    expect(Number(responses[IP_BURST]?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('keeps serving with local limits while Redis does not answer', async () => {
    await infra.redisCli('CLIENT', 'PAUSE', '3000', 'ALL');

    const started = Date.now();
    const responses = await burst(alice, USER_BURST + 1);

    expect(statuses(responses)).toEqual([...Array<number>(USER_BURST).fill(200), 429]);
    expect(Date.now() - started).toBeLessThan(2000);
    const ready = await fetch(`${gateway}/health/ready`);
    expect(ready.status).toBe(200);
  });
});
