import { Router } from 'express';
import request from 'supertest';
import { buildTestApp, errorOf } from '../helpers/test-app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NGINX_ID = '0123456789abcdef'.repeat(2);
const USER_ID = '20000000-0000-4000-8000-0000000000a1';

function testRouter(): Router {
  const v1 = Router();
  v1.get('/items/:id', (req, res) => {
    req.log?.info('handler.reached');
    res.json({ success: true, data: { id: req.params['id'] } });
  });
  v1.get('/me', (req, res) => {
    if (req.context) req.context.userId = USER_ID;
    res.json({ success: true, data: null });
  });
  v1.get('/boom', () => {
    throw new Error('boom');
  });
  const root = Router();
  root.use('/v1', v1);
  root.get('/health/live', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });
  return root;
}

const requestLines = (lines: ReturnType<ReturnType<typeof buildTestApp>['lines']>) =>
  lines.filter((line) => line.msg === 'http.request.completed');

describe('request id', () => {
  it('generates a UUID when none is sent and echoes it', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/nowhere');

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(errorOf(res).requestId).toBe(res.headers['x-request-id']);
  });

  it('keeps an Nginx $request_id', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/nowhere').set('X-Request-Id', NGINX_ID);

    expect(res.headers['x-request-id']).toBe(NGINX_ID);
  });

  it('keeps a UUID, lower-cased', async () => {
    const { app } = buildTestApp();
    const id = 'ABCDEF01-2345-4678-89AB-CDEF01234567';
    const res = await request(app).get('/nowhere').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id.toLowerCase());
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(200)],
    ['upper-case hex', NGINX_ID.toUpperCase()],
    ['JSON fragment', '","level":"fatal","msg":"forged'],
  ])('replaces a %s value and never logs it', async (_label, value) => {
    const { app, raw } = buildTestApp();
    const res = await request(app).get('/nowhere').set('X-Request-Id', value);

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(raw()).not.toContain(value);
  });

  it('gives each request its own id', async () => {
    const { app } = buildTestApp();
    const [a, b] = await Promise.all([request(app).get('/x'), request(app).get('/y')]);

    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('request log', () => {
  it('writes one line with only the allowed fields', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    const res = await request(app)
      .get('/v1/items/42?email=someone@example.test')
      .set('User-Agent', 'MARKER-UA')
      .set('Authorization', 'Bearer MARKER-TOKEN');

    const logged = requestLines(lines());
    expect(logged).toHaveLength(1);
    const line: Record<string, unknown> = logged[0] ?? {};
    expect(line).toMatchObject({
      level: 'info',
      module: 'http',
      request_id: res.headers['x-request-id'],
      method: 'GET',
      route: '/v1/items/:id',
      status: 200,
    });
    expect(typeof line['duration_ms']).toBe('number');
    expect(Object.keys(line).sort()).toEqual(
      ['duration_ms', 'hostname', 'level', 'method', 'module', 'msg', 'pid', 'request_id']
        .concat(['route', 'status', 'time'])
        .sort(),
    );
  });

  it('never logs the query string, user agent, IP or headers', async () => {
    const { app, raw } = buildTestApp([testRouter()]);
    await request(app)
      .get('/v1/items/42?email=someone@example.test')
      .set('User-Agent', 'MARKER-UA')
      .set('Authorization', 'Bearer MARKER-TOKEN');

    expect(raw()).not.toMatch(/someone@example|MARKER-|127\.0\.0\.1|::1|remoteAddress/);
  });

  it('uses the path without query string when no route matched', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    await request(app).get('/v1/unknown/path?token=abc');

    expect(requestLines(lines())[0]).toMatchObject({ route: '/v1/unknown/path', status: 404 });
  });

  it('adds user_id only when the request is authenticated', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    await request(app).get('/v1/me');
    await request(app).get('/v1/items/1');

    const [authenticated, anonymous] = requestLines(lines());
    expect(authenticated?.['user_id']).toBe(USER_ID);
    expect(anonymous).not.toHaveProperty('user_id');
  });

  it('logs health checks at debug level', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    await request(app).get('/health/live');

    expect(requestLines(lines())[0]).toMatchObject({ level: 'debug', route: '/health/live' });
  });

  it('logs a 5xx at error level', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    await request(app).get('/v1/boom');

    expect(requestLines(lines())[0]).toMatchObject({
      level: 'error',
      status: 500,
      route: '/v1/boom',
    });
  });

  it('binds req.log to the request id', async () => {
    const { app, lines } = buildTestApp([testRouter()]);
    const res = await request(app).get('/v1/items/7');

    const handlerLine = lines().find((line) => line.msg === 'handler.reached');
    expect(handlerLine?.['request_id']).toBe(res.headers['x-request-id']);
  });
});

describe('security headers (helmet)', () => {
  it('sends JSON-API headers and leaves HSTS to Nginx', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/nowhere');

    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
