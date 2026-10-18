import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ChangePasswordInputSchema,
  CreateIncidentInputSchema,
  CreateMessageInputSchema,
  CreateOrgInputSchema,
  CreateUserInputSchema,
  CursorPaginationQuerySchema,
  errorResponse,
  ErrorResponseSchema,
  ForgotPasswordInputSchema,
  IncidentFiltersSchema,
  listResponse,
  LoginInputSchema,
  PasswordSchema,
  RefreshInputSchema,
  ResetPasswordInputSchema,
  SeverityAnswersSchema,
  successResponse,
  UpdateIncidentInputSchema,
  UpdateOrgInputSchema,
  UpdateUserInputSchema,
  UuidParamsSchema,
  VerifyTotpInputSchema,
} from '../src/index.js';

// Valid v4 layout (version nibble 4, variant 8) with zeroed random bits.
const UUID_V4 = '00000000-0000-4000-8000-000000000001';
// Deliberately low-entropy: test fixture, not a secret (gitleaks)
const TOKEN = 'A'.repeat(43); // 43 = base64url length of a 256-bit token
// Deliberately low-entropy: test fixture, not a secret (gitleaks)
const PASSWORD = 'Aa1'.repeat(4); // 12 chars with an uppercase, a lowercase and a digit
// Deliberately low-entropy: test fixture, not a secret (gitleaks)
const CURSOR = 'A'.repeat(16);

const accepts = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(true);
const rejects = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);

const answers = { moneyLost: 'no', sharedSecret: 'yes', othersAffected: 'unknown' };
const incident = {
  categoryCode: 'MSG-01',
  title: 'Faux e-mail de la banque',
  description: 'Lien cliqué',
  answers,
  clientRequestId: UUID_V4,
};

// One valid example per object schema; each must reject an unknown field (.strict()).
const VALID: [string, z.ZodType, Record<string, unknown>][] = [
  ['LoginInput', LoginInputSchema, { email: 'aime@example.cm', password: 'x' }],
  ['VerifyTotpInput', VerifyTotpInputSchema, { code: '123456' }],
  ['RefreshInput', RefreshInputSchema, { refreshToken: TOKEN }],
  ['ForgotPasswordInput', ForgotPasswordInputSchema, { email: 'aime@example.cm' }],
  ['ResetPasswordInput', ResetPasswordInputSchema, { token: TOKEN, newPassword: PASSWORD }],
  [
    'ChangePasswordInput',
    ChangePasswordInputSchema,
    { currentPassword: 'old', newPassword: PASSWORD },
  ],
  ['UuidParams', UuidParamsSchema, { id: UUID_V4 }],
  ['CursorPaginationQuery', CursorPaginationQuerySchema, { limit: '50', cursor: CURSOR }],
  ['SeverityAnswers', SeverityAnswersSchema, answers],
  ['CreateIncidentInput', CreateIncidentInputSchema, incident],
  [
    'UpdateIncidentInput',
    UpdateIncidentInputSchema,
    { version: 3, status: 'ASSIGNED', assignedTo: UUID_V4 },
  ],
  ['IncidentFilters', IncidentFiltersSchema, { status: 'NEW', severity: 'HIGH', limit: '10' }],
  [
    'CreateUserInput',
    CreateUserInputSchema,
    {
      organizationId: UUID_V4,
      firstName: 'Aimé',
      lastName: 'Ngono',
      email: 'aime@example.cm',
      role: 'USER',
    },
  ],
  ['UpdateUserInput', UpdateUserInputSchema, { isActive: false }],
  [
    'CreateOrgInput',
    CreateOrgInputSchema,
    {
      name: 'Banque Exemple',
      type: 'COMPANY',
      sector: 'Finance',
      city: 'Douala',
      contactEmail: 'it@example.cm',
      subscriptionPlan: 'STANDARD',
    },
  ],
  ['UpdateOrgInput', UpdateOrgInputSchema, { subscriptionPlan: 'PREMIUM' }],
  ['CreateMessageInput', CreateMessageInputSchema, { body: 'Merci, je regarde.' }],
  ['successResponse', successResponse(UuidParamsSchema), { success: true, data: { id: UUID_V4 } }],
  [
    'listResponse',
    listResponse(UuidParamsSchema),
    { success: true, data: [{ id: UUID_V4 }], meta: { nextCursor: null } },
  ],
  [
    'ErrorResponse',
    ErrorResponseSchema,
    { success: false, error: { code: 'NOT_FOUND', message: 'x' } },
  ],
];

describe.each(VALID)('%s', (_name, schema, valid) => {
  it('accepts a valid example', () => accepts(schema, valid));
  it('rejects an unknown field', () => rejects(schema, { ...valid, unexpected: true }));
  it('rejects a non-object', () => {
    rejects(schema, null);
    rejects(schema, 'text');
  });
});

describe('field rules', () => {
  it('trims strings before validating', () => {
    const parsed = CreateIncidentInputSchema.parse({
      ...incident,
      title: '  Spam  ',
      description: ' a ',
    });
    expect(parsed.title).toBe('Spam');
    expect(parsed.description).toBe('a');
    expect(LoginInputSchema.parse({ email: '  aime@example.cm ', password: 'x' }).email).toBe(
      'aime@example.cm',
    );
    expect(VerifyTotpInputSchema.parse({ code: ' 123456 ' }).code).toBe('123456');
  });

  it('applies the title, description, location and device limits', () => {
    rejects(CreateIncidentInputSchema, { ...incident, title: 'ab' });
    accepts(CreateIncidentInputSchema, { ...incident, title: 'a'.repeat(150) });
    rejects(CreateIncidentInputSchema, { ...incident, title: 'a'.repeat(151) });
    accepts(CreateIncidentInputSchema, { ...incident, description: 'x' });
    rejects(CreateIncidentInputSchema, { ...incident, description: '   ' });
    rejects(CreateIncidentInputSchema, { ...incident, description: 'a'.repeat(5001) });
    accepts(CreateIncidentInputSchema, {
      ...incident,
      location: 'a'.repeat(200),
      deviceAffected: 'PC',
    });
    rejects(CreateIncidentInputSchema, { ...incident, location: 'a'.repeat(201) });
    rejects(CreateIncidentInputSchema, { ...incident, deviceAffected: 'a'.repeat(201) });
  });

  it('rejects an untrimmed title that is too short only after trimming', () => {
    rejects(CreateIncidentInputSchema, { ...incident, title: '  ab  ' });
  });

  it('defaults isAnonymous to false and rejects client-supplied severity, reporter or organisation', () => {
    expect(CreateIncidentInputSchema.parse(incident).isAnonymous).toBe(false);
    // Only reporterSeverity is accepted; the stored severity is always resolved by the server.
    rejects(CreateIncidentInputSchema, { ...incident, severity: 'LOW' });
    rejects(CreateIncidentInputSchema, { ...incident, reporterId: UUID_V4 });
    rejects(CreateIncidentInputSchema, { ...incident, organizationId: UUID_V4 });
  });

  it('accepts an optional reporterSeverity and rejects invalid ones', () => {
    accepts(CreateIncidentInputSchema, { ...incident, reporterSeverity: 'CRITICAL' });
    expect(CreateIncidentInputSchema.parse(incident).reporterSeverity).toBeUndefined();
    rejects(CreateIncidentInputSchema, { ...incident, reporterSeverity: 'MODERATE' });
    rejects(CreateIncidentInputSchema, { ...incident, reporterSeverity: 'low' });
    rejects(CreateIncidentInputSchema, { ...incident, reporterSeverity: null });
  });

  it('rejects invalid incident values', () => {
    rejects(CreateIncidentInputSchema, { ...incident, categoryCode: 'MOB-05' });
    rejects(CreateIncidentInputSchema, { ...incident, clientRequestId: 'not-a-uuid' });
    // UUID v1 is rejected: the mobile app generates v4 with expo-crypto.
    rejects(CreateIncidentInputSchema, {
      ...incident,
      clientRequestId: '00000000-0000-1000-8000-000000000001',
    });
    rejects(CreateIncidentInputSchema, { ...incident, isAnonymous: 'true' });
    rejects(CreateIncidentInputSchema, { ...incident, answers: { ...answers, moneyLost: true } });
    rejects(CreateIncidentInputSchema, { ...incident, answers: { ...answers, extra: 'no' } });
    rejects(CreateIncidentInputSchema, {
      ...incident,
      answers: { moneyLost: 'no', sharedSecret: 'no' },
    });
  });

  it('requires version and at least one other field on incident update', () => {
    rejects(UpdateIncidentInputSchema, { status: 'CLOSED' });
    rejects(UpdateIncidentInputSchema, { version: 1 });
    rejects(UpdateIncidentInputSchema, { version: 1.5, status: 'CLOSED' });
    rejects(UpdateIncidentInputSchema, { version: -1, status: 'CLOSED' });
    rejects(UpdateIncidentInputSchema, { version: 1, status: 'OPEN' });
    rejects(UpdateIncidentInputSchema, { version: 1, severity: 'MODERATE' });
    accepts(UpdateIncidentInputSchema, { version: 1, assignedTo: null });
    accepts(UpdateIncidentInputSchema, {
      version: 0,
      severity: 'MEDIUM',
      resolutionNotes: 'Fixed',
    });
    rejects(UpdateIncidentInputSchema, { version: 1, resolutionNotes: 'a'.repeat(5001) });
  });

  it('validates incident filters', () => {
    expect(IncidentFiltersSchema.parse({}).limit).toBe(20);
    accepts(IncidentFiltersSchema, { createdFrom: '2026-10-01T00:00:00+01:00', group: 'MOBILE' });
    rejects(IncidentFiltersSchema, { createdFrom: '01/10/2026' });
    rejects(IncidentFiltersSchema, { group: 'PHISHING' });
    rejects(IncidentFiltersSchema, { organizationId: 'abc' });
  });

  it('applies the e-mail rules', () => {
    rejects(LoginInputSchema, { email: 'not-an-email', password: 'x' });
    rejects(LoginInputSchema, { email: `${'a'.repeat(245)}@example.cm`, password: 'x' });
    rejects(LoginInputSchema, { email: 'aime@example.cm', password: '' });
    rejects(ForgotPasswordInputSchema, { email: '' });
  });

  it('requires a 6-digit TOTP code', () => {
    for (const code of ['12345', '1234567', '12345a', '', 123456])
      rejects(VerifyTotpInputSchema, { code });
  });

  it('allows an empty refresh body (web cookie) and rejects a malformed token', () => {
    accepts(RefreshInputSchema, {});
    rejects(RefreshInputSchema, { refreshToken: 'short' });
    rejects(RefreshInputSchema, { refreshToken: `${'a'.repeat(40)}!` });
  });
});

describe('PasswordSchema (L3 M04b, M05a)', () => {
  it('accepts a compliant password', () => {
    accepts(PasswordSchema, PASSWORD);
    accepts(PasswordSchema, `Aa1${'x'.repeat(125)}`);
  });

  it.each([
    ['too short', 'Abcdefg12'],
    ['too long', `Aa1${'x'.repeat(126)}`],
    ['no uppercase', 'abcdefgh12'],
    ['no lowercase', 'ABCDEFGH12'],
    ['no digit', 'Abcdefghij'],
  ])('rejects a password with %s', (_case, value) => rejects(PasswordSchema, value));

  it('does not trim passwords', () => {
    expect(PasswordSchema.parse(` ${PASSWORD} `)).toBe(` ${PASSWORD} `);
  });

  it('is enforced by reset, set-password and change-password', () => {
    rejects(ResetPasswordInputSchema, { token: TOKEN, newPassword: 'weak' });
    rejects(ChangePasswordInputSchema, { currentPassword: 'old', newPassword: 'weak' });
    rejects(ResetPasswordInputSchema, { token: 'bad token', newPassword: PASSWORD });
  });
});

describe('pagination (L2 §4.4)', () => {
  it('defaults to 20 and coerces query strings', () => {
    expect(CursorPaginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(CursorPaginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it.each(['0', '101', '-1', '2.5', 'abc', ''])('rejects limit=%s', (limit) =>
    rejects(CursorPaginationQuerySchema, { limit }),
  );

  it('rejects a cursor with characters outside base64', () => {
    rejects(CursorPaginationQuerySchema, { cursor: "'; DROP TABLE" });
    rejects(CursorPaginationQuerySchema, { cursor: 'a'.repeat(513) });
  });
});

describe('users and organisations', () => {
  const user = {
    organizationId: UUID_V4,
    firstName: 'Aimé',
    lastName: 'Ngono',
    email: 'aime@example.cm',
    role: 'USER',
  };

  it('creates users without a password and defaults the language to French', () => {
    expect(CreateUserInputSchema.parse(user).preferredLanguage).toBe('fr');
    rejects(CreateUserInputSchema, { ...user, password: PASSWORD });
  });

  it('rejects invalid user values', () => {
    rejects(CreateUserInputSchema, { ...user, role: 'SUPERADMIN' });
    rejects(CreateUserInputSchema, { ...user, phone: '699 00 00 00' });
    accepts(CreateUserInputSchema, { ...user, phone: '+237699000000', preferredLanguage: 'en' });
    rejects(CreateUserInputSchema, { ...user, preferredLanguage: 'de' });
    rejects(CreateUserInputSchema, { ...user, firstName: '  ' });
    rejects(UpdateUserInputSchema, {});
    rejects(UpdateUserInputSchema, { email: 'new@example.cm' });
    rejects(UpdateUserInputSchema, { organizationId: UUID_V4 });
    accepts(UpdateUserInputSchema, { phone: null });
  });

  const org = {
    name: 'Banque',
    type: 'NGO',
    sector: 'ONG',
    city: 'Yaoundé',
    contactEmail: 'it@example.cm',
    subscriptionPlan: 'BASIC',
  };

  it('never accepts PROVIDER as an organisation type', () => {
    accepts(CreateOrgInputSchema, org);
    rejects(CreateOrgInputSchema, { ...org, type: 'PROVIDER' });
    rejects(UpdateOrgInputSchema, { type: 'PROVIDER' });
  });

  it('rejects invalid organisation values', () => {
    rejects(CreateOrgInputSchema, { ...org, subscriptionPlan: 'GOLD' });
    rejects(CreateOrgInputSchema, { ...org, name: 'A' });
    rejects(CreateOrgInputSchema, { ...org, contactEmail: 'nope' });
    rejects(UpdateOrgInputSchema, {});
  });
});

describe('messages', () => {
  it('defaults isInternal to false and applies the 1-2000 limit', () => {
    expect(CreateMessageInputSchema.parse({ body: 'ok' }).isInternal).toBe(false);
    accepts(CreateMessageInputSchema, { body: 'a'.repeat(2000), isInternal: true });
    rejects(CreateMessageInputSchema, { body: 'a'.repeat(2001) });
    rejects(CreateMessageInputSchema, { body: '  ' });
  });
});

describe('response envelopes', () => {
  const data = successResponse(UuidParamsSchema);

  it('validates the success envelope', () => {
    accepts(data, { success: true, data: { id: UUID_V4 }, message: 'Created' });
    rejects(data, { success: false, data: { id: UUID_V4 } });
    rejects(data, { success: true, data: { id: 'x' } });
    rejects(data, { success: true });
  });

  it('validates the list envelope with meta.nextCursor', () => {
    const list = listResponse(UuidParamsSchema);
    accepts(list, { success: true, data: [], meta: { nextCursor: 'abc' } });
    rejects(list, { success: true, data: [] });
    rejects(list, { success: true, data: [], meta: { nextCursor: 'abc', total: 3 } });
  });

  it('validates the error envelope', () => {
    const error = errorResponse();
    accepts(error, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'title' }] },
    });
    rejects(error, { success: false, error: { code: 'TEAPOT', message: 'x' } });
    rejects(error, { success: false, error: { code: 'NOT_FOUND', message: 'x', stack: 'at ...' } });
    rejects(error, { success: true, error: { code: 'NOT_FOUND', message: 'x' } });
  });
});
