import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { ERROR_HTTP_STATUS, ErrorResponseSchema, type ErrorCode } from '@secure360/shared';
import { Prisma } from '../../src/generated/prisma/client';
import {
  AppError,
  conflict,
  forbidden,
  notFound,
  rateLimited,
  unauthenticated,
  validationError,
} from '../../src/http/app-error';
import { createErrorHandler } from '../../src/http/error-handler';
import { aadFor, decrypt, DecryptionError, encrypt } from '../../src/platform/crypto/aes-gcm';
import { testKeyring } from '../helpers/keys';
import { captureLogger } from '../helpers/log-capture';
import { buildTestApp, errorOf } from '../helpers/test-app';

const CLIENT_VERSION = '7.10.1';

// Same shapes as the real errors pinned in tests/integration/db-errors.test.ts.
function prismaError(code: string, cause?: Record<string, unknown>): Error {
  return new Prisma.PrismaClientKnownRequestError(`Invalid invocation in C:\\src\\x.ts: ${code}`, {
    code,
    clientVersion: CLIENT_VERSION,
    meta: cause ? { driverAdapterError: { cause } } : {},
  });
}

const pgError = (sqlstate: string, message: string, prismaCode = 'P2039') =>
  prismaError(prismaCode, {
    originalCode: sqlstate,
    originalMessage: message,
    kind: 'postgres',
    code: sqlstate,
    message,
  });

function poolTimeout(): Error {
  return Object.assign(new Error('timeout exceeded when trying to connect'), {
    clientVersion: CLIENT_VERSION,
  });
}

/** App whose /throw route forwards the error produced by `make`. */
function appThrowing(make: () => unknown) {
  const router = Router();
  router.all('/throw', () => {
    throw make();
  });
  router.post('/echo', (req, res) => {
    res.json({ success: true, data: req.body as unknown });
  });
  return buildTestApp([router]);
}

async function expectEnvelope(make: () => unknown, code: ErrorCode, lang?: string) {
  const { app, lines } = appThrowing(make);
  const req = request(app).get('/throw');
  const res = await (lang ? req.set('Accept-Language', lang) : req);
  expect(res.status).toBe(ERROR_HTTP_STATUS[code]);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(ErrorResponseSchema.safeParse(res.body).success).toBe(true);
  expect(errorOf(res).code).toBe(code);
  expect(errorOf(res).requestId).toBe(res.headers['x-request-id']);
  return { res, lines: lines() };
}

const failureLine = (lines: ReturnType<ReturnType<typeof captureLogger>['lines']>) =>
  lines.find((line) => line.msg === 'http.request.failed');

describe('AppError', () => {
  it.each([
    [notFound(), 'NOT_FOUND'],
    [forbidden(), 'FORBIDDEN'],
    [conflict(), 'CONFLICT'],
    [unauthenticated(), 'UNAUTHENTICATED'],
    [validationError([{ path: 'title', code: 'too_small' }]), 'VALIDATION_ERROR'],
    [rateLimited(3), 'RATE_LIMITED'],
  ] as const)('%#: takes its status from the shared map', (error, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(ERROR_HTTP_STATUS[code]);
  });

  it('rounds Retry-After up to whole seconds, at least 1', () => {
    expect(rateLimited(0).retryAfterSeconds).toBe(1);
    expect(rateLimited(0.2).retryAfterSeconds).toBe(1);
    expect(rateLimited(2.1).retryAfterSeconds).toBe(3);
  });
});

describe('error handler: application errors', () => {
  it('sends the localized envelope with the request id', async () => {
    const { res } = await expectEnvelope(() => notFound(), 'NOT_FOUND', 'en');
    expect(errorOf(res).message).toBe('Item not found.');
  });

  it('defaults to French', async () => {
    const { res } = await expectEnvelope(() => forbidden(), 'FORBIDDEN');
    expect(errorOf(res).message).toBe('Vous n’avez pas les droits pour effectuer cette action.');
  });

  it('sends Retry-After for RATE_LIMITED', async () => {
    const { res } = await expectEnvelope(() => rateLimited(0.4), 'RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('1');
  });

  it('keeps validation details', async () => {
    const details = [{ path: 'title', code: 'too_small' }];
    const { res } = await expectEnvelope(() => validationError(details), 'VALIDATION_ERROR');
    expect(errorOf(res).details).toEqual(details);
  });
});

describe('error handler: Zod', () => {
  it('maps a ZodError to VALIDATION_ERROR with path and code only', async () => {
    const secretInput = 'MARKER-rejected-value';
    const schema = z.object({ title: z.string().min(50), answers: z.object({ n: z.number() }) });
    const { res } = await expectEnvelope(
      () => schema.safeParse({ title: secretInput, answers: { n: secretInput } }).error,
      'VALIDATION_ERROR',
    );
    expect(errorOf(res).details).toEqual([
      { path: 'title', code: 'too_small' },
      { path: 'answers.n', code: 'invalid_type' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(secretInput);
  });
});

describe('error handler: body parser', () => {
  it('answers malformed JSON with VALIDATION_ERROR as JSON, not HTML', async () => {
    const { app } = appThrowing(() => null);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(errorOf(res)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(res.text).not.toMatch(/<html|SyntaxError|Unexpected/i);
  });

  it('answers an oversized body with PAYLOAD_TOO_LARGE and a generic message', async () => {
    const { app } = appThrowing(() => null);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'a'.repeat(101 * 1024) }));

    expect(res.status).toBe(413);
    expect(errorOf(res)).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Contenu trop volumineux.',
    });
  });

  it('answers an unsupported charset with UNSUPPORTED_MEDIA_TYPE', async () => {
    const { app } = appThrowing(() => null);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json; charset=koi8-r')
      .send('{}');

    expect(res.status).toBe(415);
    expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('answers an unsupported content encoding with UNSUPPORTED_MEDIA_TYPE', async () => {
    const { app } = appThrowing(() => null);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'x-unknown')
      .send('{}');

    expect(res.status).toBe(415);
    expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('error handler: database', () => {
  it('maps P2025 to NOT_FOUND', async () => {
    await expectEnvelope(() => prismaError('P2025'), 'NOT_FOUND');
  });

  it('maps P2002 to CONFLICT without constraint or column names', async () => {
    const { res } = await expectEnvelope(
      () =>
        prismaError('P2002', {
          originalCode: '23505',
          originalMessage: 'duplicate key value violates unique constraint "users_email_key"',
          kind: 'UniqueConstraintViolation',
          constraint: { index: 'users_email_key' },
          table: 'users',
        }),
      'CONFLICT',
    );
    expect(JSON.stringify(res.body)).not.toMatch(/users|email|constraint|P2002/);
  });

  it('maps an RLS violation to NOT_FOUND and logs it at warn', async () => {
    const { lines } = await expectEnvelope(
      () => pgError('42501', 'new row violates row-level security policy for table "incidents"'),
      'NOT_FOUND',
    );
    expect(failureLine(lines)).toMatchObject({ level: 'warn', reason: 'db.rls_violation' });
  });

  it.each([
    'users.id cannot change',
    'only an ADMIN may change role, organization_id, is_active or email',
    'session_version cannot decrease',
    'session_version may only be raised by the user or an ADMIN',
    'totp_last_step cannot decrease',
    'TECHNICIAN and ADMIN users must belong to the PROVIDER organization',
    'incidents identity, provenance and confidentiality columns cannot change',
    'incidents.assigned_to must be an active staff user',
  ])('maps guard trigger "%s" to FORBIDDEN, logging the message only', async (message) => {
    const { res, lines } = await expectEnvelope(() => pgError('42501', message), 'FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toContain(message);
    const line = failureLine(lines);
    expect(line).toMatchObject({ level: 'warn', reason: 'db.guard_trigger', db_message: message });
    expect(line).not.toHaveProperty('err');
  });

  it.each([
    ['missing GRANT', 'permission denied for table _prisma_migrations', 'db.permission_denied'],
    ['other 42501', 'must be owner of table incidents', 'db.insufficient_privilege'],
  ])('maps a %s to INTERNAL_ERROR at error level', async (_label, message, reason) => {
    const { res, lines } = await expectEnvelope(
      () => pgError('42501', message, 'P2010'),
      'INTERNAL_ERROR',
    );
    expect(JSON.stringify(res.body)).not.toContain(message);
    expect(failureLine(lines)).toMatchObject({ level: 'error', reason });
  });

  it.each([
    ['P1001', () => prismaError('P1001')],
    ['P1017', () => prismaError('P1017')],
    ['P2024', () => prismaError('P2024')],
    ['DatabaseNotReachable', () => prismaError('P2010', { kind: 'DatabaseNotReachable' })],
    ['ConnectionClosed', () => prismaError('P2010', { kind: 'ConnectionClosed' })],
    ['SocketTimeout', () => prismaError('P2010', { kind: 'SocketTimeout' })],
    ['TooManyConnections', () => prismaError('P2010', { kind: 'TooManyConnections' })],
    ['57P01', () => pgError('57P01', 'terminating connection due to administrator command')],
    ['57P03', () => pgError('57P03', 'the database system is starting up')],
    ['08006', () => pgError('08006', 'connection failure')],
    ['pool timeout', poolTimeout],
  ])('maps %s (database unreachable) to SERVICE_UNAVAILABLE', async (_label, make) => {
    const { lines } = await expectEnvelope(make, 'SERVICE_UNAVAILABLE');
    expect(failureLine(lines)).toMatchObject({ level: 'error', reason: 'db.unavailable' });
  });

  it.each([
    ['P2039 (ORM call)', 'P2039'],
    ['P2010 (raw query)', 'P2010'],
  ])(
    'maps 57014 (statement timeout) on %s to SERVICE_UNAVAILABLE at warn',
    async (_l, prismaCode) => {
      const message = 'canceling statement due to statement timeout';
      const { res, lines } = await expectEnvelope(
        () => pgError('57014', message, prismaCode),
        'SERVICE_UNAVAILABLE',
      );
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain(message);
      const line = failureLine(lines);
      expect(line).toMatchObject({
        level: 'warn',
        reason: 'db.statement_timeout',
        error_code: 'SERVICE_UNAVAILABLE',
        route: '/throw',
        request_id: res.headers['x-request-id'],
      });
      expect(line).not.toHaveProperty('err');
    },
  );

  it('keeps P2003 (foreign key) as INTERNAL_ERROR so no other tenant id is confirmed', async () => {
    await expectEnvelope(
      () => prismaError('P2003', { originalCode: '23503', kind: 'ForeignKeyConstraintViolation' }),
      'INTERNAL_ERROR',
    );
  });
});

describe('error handler: unexpected errors', () => {
  it('sends a generic INTERNAL_ERROR and logs the stack with the request id', async () => {
    const { res, lines } = await expectEnvelope(
      () => new Error('boom at C:\\dev\\Secure360\\apps\\api\\src\\x.ts SELECT * FROM users'),
      'INTERNAL_ERROR',
      'en',
    );
    expect(errorOf(res).message).toBe('Something went wrong. Try again later.');
    expect(JSON.stringify(res.body)).not.toMatch(/boom|SELECT|Secure360|\.ts|at /);
    const line = failureLine(lines);
    expect(line).toMatchObject({ level: 'error', request_id: res.headers['x-request-id'] });
    expect(JSON.stringify(line?.['err'])).toMatch(/boom[\s\S]*stack/);
  });

  it('handles a thrown non-Error value', async () => {
    await expectEnvelope(() => 'a string', 'INTERNAL_ERROR');
  });

  it('never puts a Prisma message, SQL or path in any response', async () => {
    for (const make of [
      () => prismaError('P2010', { originalCode: '22P02', originalMessage: 'invalid input "x"' }),
      () => pgError('42501', 'permission denied for table users'),
    ]) {
      const { res } = await expectEnvelope(make, 'INTERNAL_ERROR');
      expect(Object.keys(errorOf(res)).sort()).toEqual(['code', 'message', 'requestId']);
      expect(JSON.stringify(res.body)).not.toMatch(/Invalid|invocation|P20|42501|\\src|permission/);
    }
  });
});

describe('error handler: decryption failures', () => {
  it.each([
    'too_short',
    'bad_encoding',
    'unknown_version',
    'unknown_key_id',
    'auth_failed',
  ] as const)('logs reason %s but sends only the generic INTERNAL_ERROR', async (reason) => {
    const { res, lines } = await expectEnvelope(
      () => new DecryptionError(reason),
      'INTERNAL_ERROR',
      'en',
    );

    expect(errorOf(res).message).toBe('Something went wrong. Try again later.');
    expect(Object.keys(errorOf(res)).sort()).toEqual(['code', 'message', 'requestId']);
    expect(JSON.stringify(res.body)).not.toMatch(
      /decrypt|reason|too_short|encoding|version|key_id|auth/i,
    );
    expect(failureLine(lines)).toMatchObject({
      level: 'error',
      reason: `decryption.${reason}`,
      error_code: 'INTERNAL_ERROR',
    });
  });

  it('logs a real decryption failure from the crypto module the same way', async () => {
    const keyring = testKeyring([1]);
    const blob = encrypt(keyring, Buffer.from('secret'), aadFor('users.totp_secret', 'a'));
    const { res, lines } = await expectEnvelope(
      () => decrypt(keyring, blob, aadFor('users.totp_secret', 'b')),
      'INTERNAL_ERROR',
    );

    expect(JSON.stringify(res.body)).not.toMatch(/auth_failed|Decryption/);
    expect(failureLine(lines)?.['reason']).toBe('decryption.auth_failed');
  });
});

describe('error handler: headers already sent', () => {
  it('delegates to next(err)', () => {
    const { logger } = captureLogger();
    const handler = createErrorHandler(logger);
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const error = new Error('late');

    handler(error, {} as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
