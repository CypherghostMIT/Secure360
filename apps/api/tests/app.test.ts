import request from 'supertest';
import { ErrorResponseSchema } from '@secure360/shared';
import { createApp } from '../src/app';

const app = createApp({ trustProxy: 0 });

describe('createApp', () => {
  it('returns 404 with the shared error envelope on an unknown route', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(ErrorResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Élément introuvable.' },
    });
  });

  it('localizes the 404 message from Accept-Language', async () => {
    const res = await request(app).post('/nowhere').set('Accept-Language', 'en-US,en;q=0.9');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Item not found.' },
    });
  });

  it('does not send X-Powered-By', async () => {
    const res = await request(app).get('/');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends no CORS headers, even to a cross-origin request', async () => {
    const res = await request(app).options('/').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a JSON body larger than 100 kb with 413', async () => {
    const body = JSON.stringify({ text: 'a'.repeat(101 * 1024) });
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(413);
  });

  it('accepts a JSON body under 100 kb (then 404, as no route exists yet)', async () => {
    const res = await request(app)
      .post('/anything')
      .send({ text: 'a'.repeat(90 * 1024) });

    expect(res.status).toBe(404);
  });
});
