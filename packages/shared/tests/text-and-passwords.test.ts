import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ChangePasswordInputSchema,
  CreateIncidentInputSchema,
  CreateMessageInputSchema,
  CreateOrgInputSchema,
  CreateStaffMessageInputSchema,
  CreateUserInputSchema,
  ExistingPasswordSchema,
  ForgotPasswordInputSchema,
  LoginInputSchema,
  PasswordSchema,
  ResetPasswordInputSchema,
  text,
  UpdateIncidentInputSchema,
  UpdateMeInputSchema,
  UpdateOrgInputSchema,
  UpdateUserInputSchema,
} from '../src/index.js';

const UUID_V4 = '00000000-0000-4000-8000-000000000001';
// Deliberately low-entropy: test fixture, not a secret (gitleaks)
const TOKEN = 'A'.repeat(43);

const ok = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(true);
const ko = (schema: z.ZodType, value: unknown) =>
  expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);

const BIDI = [
  '\u202A',
  '\u202B',
  '\u202C',
  '\u202D',
  '\u202E',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
];
// C0 controls (NUL, BEL, ESC, DEL) and C1 controls (NEL, CSI) are all \p{Cc}.
const CONTROLS = ['\u0000', '\u0007', '\u001B', '\u007F', '\u0085', '\u009B'];
const ZERO_WIDTH = ['\u200B', '\u200C', '\u200D', '\uFEFF'];

describe('text() helper (security review M4)', () => {
  const singleLine = text({ min: 3, max: 20 });
  const multiline = text({ min: 1, max: 20, multiline: true });

  it('normalises to NFC', () => {
    // "é" typed as e + combining acute (2 code units) is stored as one composed character.
    expect(singleLine.parse('Cafe\u0301')).toBe('Café');
    expect(multiline.parse('e\u0301')).toHaveLength(1);
  });

  it('rejects every control character in single-line text, including \\r, \\n and \\t', () => {
    for (const c of [...CONTROLS, '\r', '\n', '\t']) ko(singleLine, `abc${c}def`);
  });

  it('allows \\n and \\t in multiline text, turns CRLF into LF, and rejects other controls', () => {
    expect(multiline.parse('a\nb\tc')).toBe('a\nb\tc');
    expect(multiline.parse('a\r\nb\rc')).toBe('a\nb\nc');
    for (const c of CONTROLS) ko(multiline, `a${c}b`);
  });

  it('rejects bidi override and isolate characters in both kinds of text', () => {
    for (const c of BIDI) {
      ko(singleLine, `Facture ${c}fdp.exe`);
      ko(multiline, `Facture ${c}fdp.exe`);
    }
  });

  it('counts the minimum without zero-width characters', () => {
    for (const zw of ZERO_WIDTH) {
      ko(singleLine, zw.repeat(3));
      ko(singleLine, `ab${zw}`);
      ok(singleLine, `abc${zw}`);
      ko(multiline, zw);
    }
  });

  it('still trims and applies the maximum', () => {
    expect(singleLine.parse('  abc  ')).toBe('abc');
    ko(singleLine, 'a'.repeat(21));
    ok(text({ max: 5 }), '');
  });
});

describe('text rules on every text field', () => {
  const incident = {
    categoryCode: 'MSG-01',
    title: 'Faux e-mail',
    description: 'Lien cliqué',
    answers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'no' },
    clientRequestId: UUID_V4,
  };
  const user = {
    organizationId: UUID_V4,
    firstName: 'Aimé',
    lastName: 'Ngono',
    email: 'aime@example.com',
    role: 'USER',
  };
  const org = {
    name: 'Banque',
    type: 'NGO',
    sector: 'ONG',
    city: 'Yaoundé',
    contactEmail: 'it@example.com',
    subscriptionPlan: 'BASIC',
  };

  // [label, schema, valid base, field]
  const singleLineFields: [string, z.ZodType, Record<string, unknown>, string][] = [
    ['incident.title', CreateIncidentInputSchema, incident, 'title'],
    ['incident.location', CreateIncidentInputSchema, incident, 'location'],
    ['incident.deviceAffected', CreateIncidentInputSchema, incident, 'deviceAffected'],
    ['user.firstName', CreateUserInputSchema, user, 'firstName'],
    ['user.lastName', CreateUserInputSchema, user, 'lastName'],
    ['updateUser.firstName', UpdateUserInputSchema, {}, 'firstName'],
    ['updateMe.lastName', UpdateMeInputSchema, {}, 'lastName'],
    ['org.name', CreateOrgInputSchema, org, 'name'],
    ['org.sector', CreateOrgInputSchema, org, 'sector'],
    ['org.city', CreateOrgInputSchema, org, 'city'],
    ['updateOrg.city', UpdateOrgInputSchema, {}, 'city'],
  ];

  it.each(singleLineFields)('%s is single-line and safe', (_label, schema, base, field) => {
    ok(schema, { ...base, [field]: 'Douala centre' });
    for (const bad of ['Douala\ncentre', 'Douala\rcentre', 'Dou\u0000ala', 'Dou\u202Eala']) {
      ko(schema, { ...base, [field]: bad });
    }
  });

  const multilineFields: [string, z.ZodType, Record<string, unknown>, string][] = [
    ['incident.description', CreateIncidentInputSchema, incident, 'description'],
    [
      'updateIncident.resolutionNotes',
      UpdateIncidentInputSchema,
      { version: 1 },
      'resolutionNotes',
    ],
    ['message.body', CreateMessageInputSchema, {}, 'body'],
    ['staffMessage.body', CreateStaffMessageInputSchema, { isInternal: true }, 'body'],
  ];

  it.each(multilineFields)('%s keeps line breaks but is safe', (_label, schema, base, field) => {
    ok(schema, { ...base, [field]: 'Ligne 1\nLigne 2\tfin' });
    for (const bad of ['Dou\u0000ala', 'Dou\u001Bala', 'Dou\u2066ala', '\u200B']) {
      ko(schema, { ...base, [field]: bad });
    }
  });
});

describe('EmailSchema (security review M2)', () => {
  it('lowercases e-mails so case variants share one rate-limit key', () => {
    expect(LoginInputSchema.parse({ email: ' Aime@Example.COM ', password: 'x' }).email).toBe(
      'aime@example.com',
    );
    expect(ForgotPasswordInputSchema.parse({ email: 'AIME@EXAMPLE.COM' }).email).toBe(
      'aime@example.com',
    );
    const user = {
      organizationId: UUID_V4,
      firstName: 'A',
      lastName: 'B',
      email: 'Aime.Ngono@Example.com',
      role: 'USER',
    };
    expect(CreateUserInputSchema.parse(user).email).toBe('aime.ngono@example.com');
  });

  it('still validates the format and the 254 limit', () => {
    ko(ForgotPasswordInputSchema, { email: 'NOT-AN-EMAIL' });
    ko(ForgotPasswordInputSchema, { email: `${'A'.repeat(243)}@example.com` });
  });
});

describe('password transformation (all password fields)', () => {
  // 3 ASCII characters satisfy the composition rules; the rest sets the byte count.
  const prefix = 'Aa1';

  it('normalises to NFC identically at login, reset/set-password and change-password', () => {
    const decomposed = `${prefix}Cafe\u0301-pass`;
    const composed = decomposed.normalize('NFC');
    expect(composed).not.toBe(decomposed);
    expect(LoginInputSchema.parse({ email: 'a@example.com', password: decomposed }).password).toBe(
      composed,
    );
    expect(
      ResetPasswordInputSchema.parse({ token: TOKEN, newPassword: decomposed }).newPassword,
    ).toBe(composed);
    const change = ChangePasswordInputSchema.parse({
      currentPassword: decomposed,
      newPassword: decomposed,
    });
    expect([change.currentPassword, change.newPassword]).toEqual([composed, composed]);
  });

  it('rejects NUL and other control characters in every password field', () => {
    for (const c of [...CONTROLS, '\n', '\r', '\t']) {
      const value = `${prefix}secret${c}word`;
      ko(PasswordSchema, value);
      ko(ExistingPasswordSchema, value);
      ko(LoginInputSchema, { email: 'a@example.com', password: value });
      ko(ChangePasswordInputSchema, { currentPassword: value, newPassword: `${prefix}abcdefgh` });
    }
  });

  it('keeps spaces and never trims', () => {
    expect(PasswordSchema.parse(` ${prefix}abcdefgh `)).toBe(` ${prefix}abcdefgh `);
    expect(ExistingPasswordSchema.parse(' x ')).toBe(' x ');
  });

  it('accepts exactly 72 UTF-8 bytes and rejects 73 (ASCII)', () => {
    ok(PasswordSchema, prefix + 'x'.repeat(69));
    ko(PasswordSchema, prefix + 'x'.repeat(70));
  });

  it('counts bytes, not characters, for multi-byte passwords', () => {
    // "é" is 2 bytes: 3 + 34 × 2 + 1 = 72 bytes, accepted; 3 + 35 × 2 = 73 bytes (38 characters), rejected.
    ok(PasswordSchema, `${prefix}${'é'.repeat(34)}x`);
    const justOver = `${prefix}${'é'.repeat(35)}`;
    expect(justOver.length).toBe(38);
    ko(PasswordSchema, justOver);
    ko(LoginInputSchema, { email: 'a@example.com', password: justOver });
    // "€" is 3 bytes: 3 + 23 × 3 = 72 accepted, 3 + 24 × 3 = 75 rejected.
    ok(PasswordSchema, `${prefix}${'€'.repeat(23)}`);
    ko(PasswordSchema, `${prefix}${'€'.repeat(24)}`);
    // Emoji are 4 bytes: 3 + 17 × 4 = 71 accepted, 3 + 18 × 4 = 75 rejected.
    ok(PasswordSchema, `${prefix}${'\u{1F600}'.repeat(17)}`);
    ko(PasswordSchema, `${prefix}${'\u{1F600}'.repeat(18)}`);
  });

  it('measures bytes after NFC', () => {
    // Decomposed "é" is 3 bytes, composed 2: 3 + 34 × 3 + 1 = 106 bytes typed, 72 bytes once normalised.
    ok(PasswordSchema, `${prefix}${'e\u0301'.repeat(34)}x`);
  });

  it('keeps the composition rules', () => {
    ko(PasswordSchema, 'é'.repeat(12));
    ko(PasswordSchema, `${prefix}abcdef`);
  });
});
