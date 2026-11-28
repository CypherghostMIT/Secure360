import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Express, Router } from 'express';
import request from 'supertest';
import type { UserRole } from '@secure360/shared';
import {
  type AuthenticateDeps,
  createAuthenticate,
  requireRole,
} from '../../src/http/authenticate';
import { signAccessToken, signMfaToken } from '../../src/platform/auth/jwt';
import type {
  SessionRecord,
  SessionState,
  SessionStateReader,
  SessionVersionLoader,
} from '../../src/platform/auth/session-state';
import { jwtKeyring, randomKey } from '../helpers/keys';
import { buildTestApp, errorOf } from '../helpers/test-app';

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const keyring = jwtKeyring(new Map([[1, randomKey()]]), 1);
const userId = randomUUID();
const orgId = randomUUID();

const tokenFor = (sessionVersion = 2, role: UserRole = 'MANAGER', now = NOW) =>
  signAccessToken(keyring, { userId, orgId, role, sessionVersion }, now);

class FakeSessionState implements SessionStateReader {
  calls: [string, string][] = [];

  constructor(private readonly result: SessionState | 'unavailable') {}

  read(user: string, jti: string): Promise<SessionState | 'unavailable'> {
    this.calls.push([user, jti]);
    return Promise.resolve(this.result);
  }
}

const cached = (sessionVersion: number | 'miss', isDenied = false) =>
  new FakeSessionState({ sessionVersion, isDenied });

interface Setup {
  readonly sessionState?: SessionStateReader;
  readonly loadSessionVersion?: SessionVersionLoader;
  readonly roles?: [UserRole, ...UserRole[]];
}

const activeUser: SessionVersionLoader = () =>
  Promise.resolve({ sessionVersion: 2, isActive: true });

function setup({ sessionState = cached(2), loadSessionVersion = activeUser, roles }: Setup = {}) {
  const authenticate = createAuthenticate({
    keyring,
    sessionState,
    loadSessionVersion,
    now: () => NOW,
  });
  const router = Router();
  const guards = roles === undefined ? [] : [requireRole(...roles)];
  router.get('/me', authenticate, ...guards, (req, res) => {
    res.json({ context: req.context });
  });
  // requireRole mounted without authenticate: must fail closed.
  router.get('/unguarded', requireRole('ADMIN'), (_req, res) => {
    res.json({ ok: true });
  });
  return buildTestApp([router]);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** supertest folds repeated headers into one; Node's http client sends one line per array value. */
async function getWithAuthorizations(
  app: Express,
  values: string[],
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    const req = http.request({ host: '127.0.0.1', port, path: '/me', method: 'GET' });
    req.setHeader('Authorization', values);
    req.end();
    const [res] = (await once(req, 'response')) as [http.IncomingMessage];
    let text = '';
    for await (const chunk of res) text += String(chunk);
    return { status: res.statusCode ?? 0, body: JSON.parse(text) as unknown };
  } finally {
    server.close();
  }
}

function expectRejected(res: request.Response, code: 'UNAUTHENTICATED' | 'TOKEN_EXPIRED'): void {
  expect(res.status).toBe(401);
  expect(errorOf(res).code).toBe(code);
  // No detail on which check failed.
  expect(errorOf(res).details).toBeUndefined();
  expect(res.headers['www-authenticate']).toBe('Bearer');
}

function rejectionReasons(lines: () => Record<string, unknown>[]): unknown[] {
  return lines()
    .filter((line) => line['msg'] === 'auth.token.rejected')
    .map((line) => line['reason']);
}

describe('authenticate: reading the token', () => {
  it('fills req.context from a valid token and keeps the request id', async () => {
    const { app } = setup();
    const res = await request(app).get('/me').set(bearer(tokenFor()));

    expect(res.status).toBe(200);
    const body = res.body as { context: Record<string, unknown> };
    expect(body.context).toEqual({
      requestId: expect.any(String) as unknown,
      userId,
      orgId,
      role: 'MANAGER',
      tokenId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      sessionVersion: 2,
    });
  });

  it('accepts the scheme in any case', async () => {
    const { app } = setup();
    const res = await request(app).get('/me').set('Authorization', `bEaReR ${tokenFor()}`);
    expect(res.status).toBe(200);
  });

  it('rejects a request without an Authorization header', async () => {
    const { app, lines } = setup();
    expectRejected(await request(app).get('/me'), 'UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['missing']);
  });

  it.each([
    ['another scheme', (token: string) => `Basic ${token}`],
    ['no scheme', (token: string) => token],
    ['two tokens', (token: string) => `Bearer ${token} ${token}`],
    ['comma-separated tokens', (token: string) => `Bearer ${token},${token}`],
    // RFC 6750 §2.1 allows only spaces after the scheme (a trailing space never arrives: Node strips OWS).
    ['a tab separator', (token: string) => `Bearer\t${token}`],
    ['an empty token', () => 'Bearer '],
  ])('rejects %s', async (_label, build) => {
    const { app, lines } = setup();
    const res = await request(app).get('/me').set('Authorization', build(tokenFor()));

    expectRejected(res, 'UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['bad_scheme']);
  });

  it('ignores a token in the query string or a cookie', async () => {
    const { app } = setup();
    const token = tokenFor();
    const res = await request(app)
      .get(`/me?access_token=${token}&token=${token}`)
      .set('Cookie', `access_token=${token}`);

    expectRejected(res, 'UNAUTHENTICATED');
  });

  it('rejects a tampered token as UNAUTHENTICATED', async () => {
    const { app, lines } = setup();
    const [head, payload, signature = ''] = tokenFor().split('.');
    const flipped = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    const res = await request(app)
      .get('/me')
      .set(bearer(`${head}.${payload}.${flipped}`));

    expectRejected(res, 'UNAUTHENTICATED');
    expect(lines().find((line) => line['msg'] === 'auth.token.rejected')).toMatchObject({
      level: 'warn',
      reason: 'bad_signature',
    });
  });

  it('rejects an MFA token', async () => {
    const { app } = setup();
    const { token } = signMfaToken(keyring, userId, NOW);
    expectRejected(await request(app).get('/me').set(bearer(token)), 'UNAUTHENTICATED');
  });

  it('rejects an expired MFA token as UNAUTHENTICATED, not TOKEN_EXPIRED', async () => {
    const { app, lines } = setup();
    const { token } = signMfaToken(keyring, userId, NOW - 600_000);

    expectRejected(await request(app).get('/me').set(bearer(token)), 'UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['wrong_audience']);
  });

  it('rejects a request carrying two Authorization headers', async () => {
    const { app, lines } = setup();
    const res = await getWithAuthorizations(app, [`Bearer ${tokenFor()}`, `Bearer ${tokenFor()}`]);

    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['multiple_headers']);
  });

  it('accepts exactly one Authorization header sent raw (the helper is sound)', async () => {
    const { app } = setup();
    expect((await getWithAuthorizations(app, [`Bearer ${tokenFor()}`])).status).toBe(200);
  });

  it('answers TOKEN_EXPIRED for an expired token', async () => {
    const { app, lines } = setup();
    const res = await request(app)
      .get('/me')
      .set(bearer(tokenFor(2, 'MANAGER', NOW - 2 * 3600_000)));

    expectRejected(res, 'TOKEN_EXPIRED');
    expect(rejectionReasons(lines)).toEqual(['expired']);
  });
});

describe('authenticate: session state', () => {
  it('reads the session state for the token user and jti', async () => {
    const sessionState = cached(2);
    const { app } = setup({ sessionState });
    await request(app).get('/me').set(bearer(tokenFor()));

    expect(sessionState.calls).toEqual([[userId, expect.stringMatching(/^[0-9a-f-]{36}$/)]]);
  });

  it('answers TOKEN_EXPIRED when the cached session version is newer (stale sv)', async () => {
    const { app, lines } = setup({ sessionState: cached(3) });
    expectRejected(
      await request(app)
        .get('/me')
        .set(bearer(tokenFor(2))),
      'TOKEN_EXPIRED',
    );
    expect(rejectionReasons(lines)).toEqual(['stale_session']);
  });

  it('accepts a token whose sv is above the cache (the cache lags; sv only grows)', async () => {
    const { app } = setup({ sessionState: cached(1) });
    expect(
      (
        await request(app)
          .get('/me')
          .set(bearer(tokenFor(2)))
      ).status,
    ).toBe(200);
  });

  it('rejects a deny-listed jti as UNAUTHENTICATED', async () => {
    const { app, lines } = setup({ sessionState: cached(2, true) });
    expectRejected(await request(app).get('/me').set(bearer(tokenFor())), 'UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['denied']);
  });

  it('falls back to the token sv when Redis is unavailable, deny-list included (L2 §9.2)', async () => {
    const { app } = setup({ sessionState: new FakeSessionState('unavailable') });
    const res = await request(app).get('/me').set(bearer(tokenFor()));

    expect(res.status).toBe(200);
    expect((res.body as { context: { sessionVersion: number } }).context.sessionVersion).toBe(2);
  });

  it('calls the loader on a cache miss', async () => {
    const loader = jest.fn(activeUser);
    const { app } = setup({ sessionState: cached('miss'), loadSessionVersion: loader });

    expect((await request(app).get('/me').set(bearer(tokenFor()))).status).toBe(200);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refuses to build without a session version loader', () => {
    const deps = { keyring, sessionState: cached(2) } as unknown as AuthenticateDeps;
    expect(() => createAuthenticate(deps)).toThrow(TypeError);
  });
});

describe('authenticate: session version loader on a cache miss', () => {
  const loaderReturning = (record: SessionRecord) => {
    const loader = jest.fn<Promise<SessionRecord>, Parameters<SessionVersionLoader>>(() =>
      Promise.resolve(record),
    );
    return loader;
  };

  it('accepts when the loaded sv matches and the user is active', async () => {
    const loader = loaderReturning({ sessionVersion: 2, isActive: true });
    const { app } = setup({ sessionState: cached('miss'), loadSessionVersion: loader });

    expect((await request(app).get('/me').set(bearer(tokenFor()))).status).toBe(200);
    expect(loader).toHaveBeenCalledWith(
      expect.objectContaining({ sub: userId, org: orgId, sv: 2 }),
    );
  });

  it('is not called on a cache hit', async () => {
    const loader = loaderReturning({ sessionVersion: 2, isActive: true });
    const { app } = setup({ sessionState: cached(2), loadSessionVersion: loader });
    await request(app).get('/me').set(bearer(tokenFor()));

    expect(loader).not.toHaveBeenCalled();
  });

  it('answers TOKEN_EXPIRED when the loaded sv is newer', async () => {
    const loader = loaderReturning({ sessionVersion: 5, isActive: true });
    const { app } = setup({ sessionState: cached('miss'), loadSessionVersion: loader });
    expectRejected(await request(app).get('/me').set(bearer(tokenFor())), 'TOKEN_EXPIRED');
  });

  it.each([
    ['an inactive user', { sessionVersion: 2, isActive: false } as const],
    ['a user that is not found', 'not_found' as const],
  ])('rejects %s as UNAUTHENTICATED', async (_label, record) => {
    const { app, lines } = setup({
      sessionState: cached('miss'),
      loadSessionVersion: loaderReturning(record),
    });

    expectRejected(await request(app).get('/me').set(bearer(tokenFor())), 'UNAUTHENTICATED');
    expect(rejectionReasons(lines)).toEqual(['inactive_or_missing']);
  });

  it('lets a loader failure (database down) reach the error handler instead of accepting', async () => {
    const loader = jest.fn(() => Promise.reject(new Error('connection refused')));
    const { app } = setup({ sessionState: cached('miss'), loadSessionVersion: loader });
    const res = await request(app).get('/me').set(bearer(tokenFor()));

    expect(res.status).toBe(500);
    expect(errorOf(res).code).toBe('INTERNAL_ERROR');
  });
});

describe('requireRole', () => {
  it('lets an allowed role through', async () => {
    const { app } = setup({ roles: ['MANAGER', 'ADMIN'] });
    expect((await request(app).get('/me').set(bearer(tokenFor()))).status).toBe(200);
  });

  it('answers FORBIDDEN for another role, without a challenge header', async () => {
    const { app } = setup({ roles: ['ADMIN'] });
    const res = await request(app)
      .get('/me')
      .set(bearer(tokenFor(2, 'USER')));

    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('fails closed with UNAUTHENTICATED when mounted without authenticate', async () => {
    const { app } = setup();
    expectRejected(await request(app).get('/unguarded'), 'UNAUTHENTICATED');
  });

  it('refuses to build without a role', () => {
    const noRoles = [] as unknown as [UserRole];
    expect(() => requireRole(...noRoles)).toThrow(TypeError);
  });
});

describe('authenticate: nothing sensitive leaves the process', () => {
  it('never writes the token, its signature or its claims to logs or responses', async () => {
    const { app, raw } = setup({ sessionState: cached(9) });
    const token = tokenFor();
    const signature = token.split('.')[2] ?? '';
    const responses = [
      await request(app).get('/me').set(bearer(token)),
      await request(app).get('/me').set('Authorization', `Basic ${token}`),
      await request(app)
        .get('/me')
        .set(bearer(`${token}x`)),
    ];

    const shown = [raw(), ...responses.map((res) => JSON.stringify(res.body))];
    for (const text of shown) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(signature);
      expect(text).not.toContain(token.split('.')[1] ?? '');
      expect(text).not.toContain(orgId);
    }
  });
});
