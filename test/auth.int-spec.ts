import { API_KEY_MAX_PER_USER } from '@pdp/contracts';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { createApps, type RunningApps } from './support/apps';
import { prepareDatabase } from './support/helpers';
import { type Infra, startInfra } from './support/infra';

const ORIGIN = 'http://localhost:5173';
const EMAIL_BURST = 3;
const PASSWORD = 'correct horse battery';

describe('accounts and sessions at the gateway', () => {
  let infra: Infra;
  let apps: RunningApps;
  let pool: Pool;
  let gateway: string;
  let seededKey: string;

  beforeAll(async () => {
    infra = await startInfra();
    const db = await prepareDatabase(infra);
    pool = db.pool;
    seededKey = db.user.apiKey;
    apps = createApps(infra);
    await apps.start('metadata');
    // Every request comes from 127.0.0.1, so the per-IP rule is out of the way here.
    gateway = await apps.start('api-gateway', {
      AUTH_IP_RATE_PER_MIN: '10000',
      AUTH_IP_BURST: '10000',
      AUTH_EMAIL_BURST: String(EMAIL_BURST),
      API_KEY_CACHE_TTL_MS: '0',
    });
  });

  afterAll(async () => {
    await apps?.stopAll();
    await pool?.end();
    await infra?.stop();
  });

  const newEmail = () => `user-${randomUUID()}@example.com`;

  const call = (
    method: string,
    path: string,
    { body, cookie, apiKey, origin = ORIGIN }: CallOptions = {},
  ) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (apiKey) headers['x-api-key'] = apiKey;
    if (origin) headers.origin = origin;
    return fetch(`${gateway}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  /** The `name=value` part of the session cookie the response set. */
  function sessionCookie(res: Response): string {
    const header = res.headers.getSetCookie().find((c) => c.startsWith('pdp_session='));
    if (!header) throw new Error(`no session cookie in ${res.status} response`);
    return header.split(';')[0] ?? '';
  }

  async function register(email = newEmail()) {
    const res = await call('POST', '/v1/auth/register', { body: { email, password: PASSWORD } });
    expect(res.status).toBe(201);
    return { email, cookie: sessionCookie(res), user: (await res.json()) as { id: string } };
  }

  it('registers, sets a hardened cookie and lets the session use the API', async () => {
    const res = await call('POST', '/v1/auth/register', {
      body: { email: '  New.User@Example.COM ', password: PASSWORD, name: 'New User' },
    });

    expect(res.status).toBe(201);
    const setCookie = res.headers.getSetCookie().join('\n');
    expect(setCookie).toMatch(
      /pdp_session=[\w-]{43}; Max-Age=\d+; Path=\/; .*HttpOnly; Secure; SameSite=Lax/,
    );
    const user = (await res.json()) as Record<string, unknown>;
    expect(user).toMatchObject({ email: 'new.user@example.com', name: 'New User' });
    expect(user).not.toHaveProperty('passwordHash');

    const cookie = sessionCookie(res);
    const me = await call('GET', '/v1/me', { cookie, origin: null });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: user.id, authMethod: 'session' });

    const jobs = await call('GET', '/v1/jobs?limit=1', { cookie, origin: null });
    expect(jobs.status).toBe(200);
  });

  it('refuses a second account for the same mailbox, whatever the case', async () => {
    const { email } = await register();
    const res = await call('POST', '/v1/auth/register', {
      body: { email: email.toUpperCase(), password: PASSWORD },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('does not tell an unknown email from a wrong password', async () => {
    const { email } = await register();
    const wrong = await call('POST', '/v1/auth/login', {
      body: { email, password: 'not the password' },
    });
    const unknown = await call('POST', '/v1/auth/login', {
      body: { email: newEmail(), password: PASSWORD },
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  it('logs in with a fresh session and drops the one sent along', async () => {
    const { email, cookie: before } = await register();
    const res = await call('POST', '/v1/auth/login', {
      body: { email: email.toUpperCase(), password: PASSWORD },
      cookie: before,
    });

    expect(res.status).toBe(200);
    const after = sessionCookie(res);
    expect(after).not.toBe(before);
    expect((await call('GET', '/v1/me', { cookie: after })).status).toBe(200);
    expect((await call('GET', '/v1/me', { cookie: before })).status).toBe(401);
  });

  it('throttles guessing per email, the right password included', async () => {
    const { email } = await register();
    const attempt = (password: string) =>
      call('POST', '/v1/auth/login', { body: { email, password } });

    for (let i = 0; i < EMAIL_BURST; i++) expect((await attempt(`guess-${i}`)).status).toBe(401);
    const refused = await attempt(PASSWORD);

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('accepts requests from the Web UI origin only', async () => {
    const { email, cookie } = await register();

    const foreignLogin = await call('POST', '/v1/auth/login', {
      body: { email, password: PASSWORD },
      origin: 'https://evil.example',
    });
    expect(foreignLogin.status).toBe(403);

    const noOrigin = await call('POST', '/v1/api-keys', {
      body: { name: 'ci' },
      cookie,
      origin: null,
    });
    expect(noOrigin.status).toBe(403);

    // Scripts log in without a browser, so a missing Origin is fine here.
    const scripted = await call('POST', '/v1/auth/login', {
      body: { email, password: PASSWORD },
      origin: null,
    });
    expect(scripted.status).toBe(200);
  });

  it('logs out: the cookie is cleared and the session is gone on the server', async () => {
    const { cookie } = await register();
    const res = await call('POST', '/v1/auth/logout', { cookie });

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join('\n')).toMatch(
      /pdp_session=;.*Expires=Thu, 01 Jan 1970/,
    );
    const me = await call('GET', '/v1/me', { cookie });
    expect(me.status).toBe(401);
    expect(me.headers.getSetCookie().join('\n')).toMatch(/pdp_session=;/);
  });

  it('manages API keys from a session; a key cannot mint keys', async () => {
    const { cookie, user } = await register();

    const created = await call('POST', '/v1/api-keys', { body: { name: 'ci' }, cookie });
    expect(created.status).toBe(201);
    const { id, key, prefix } = (await created.json()) as Record<string, string>;
    expect(key).toMatch(/^pdp_/);
    expect(key?.startsWith(prefix ?? '-')).toBe(true);

    const listed = await call('GET', '/v1/api-keys', { cookie });
    const { items } = (await listed.json()) as { items: Record<string, unknown>[] };
    expect(items.map((k) => k.id)).toEqual([id]);
    expect(items[0]).not.toHaveProperty('key');

    const me = await call('GET', '/v1/me', { apiKey: key, origin: null });
    expect(await me.json()).toMatchObject({ id: user.id, authMethod: 'api-key' });

    const minted = await call('POST', '/v1/api-keys', { body: { name: 'x' }, apiKey: key });
    expect(minted.status).toBe(403);

    const revoked = await call('DELETE', `/v1/api-keys/${id}`, { cookie });
    expect(revoked.status).toBe(204);
    expect((await call('GET', '/v1/me', { apiKey: key, origin: null })).status).toBe(401);
  });

  it('caps active keys per user and keeps other users out of them', async () => {
    const owner = await register();
    const other = await register();
    const create = () =>
      call('POST', '/v1/api-keys', { body: { name: 'k' }, cookie: owner.cookie });

    let firstId = '';
    for (let i = 0; i < API_KEY_MAX_PER_USER; i++) {
      const res = await create();
      expect(res.status).toBe(201);
      if (i === 0) firstId = ((await res.json()) as { id: string }).id;
    }
    const over = await create();
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ code: 'API_KEY_LIMIT_REACHED' });

    const foreign = await call('DELETE', `/v1/api-keys/${firstId}`, { cookie: other.cookie });
    expect(foreign.status).toBe(404);
  });

  it('still accepts the API key of a user created before accounts', async () => {
    const me = await call('GET', '/v1/me', { apiKey: seededKey, origin: null });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: 'int-test', email: null, authMethod: 'api-key' });

    const { rows } = await pool.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM api_keys WHERE user_id = (SELECT id FROM users WHERE name = 'int-test')`,
    );
    expect(rows[0]?.last_used_at).toBeInstanceOf(Date);
  });
});

interface CallOptions {
  body?: unknown;
  cookie?: string;
  apiKey?: string;
  /** `null` sends no Origin header, as curl and server-side clients do. */
  origin?: string | null;
}
