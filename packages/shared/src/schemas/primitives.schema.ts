import { z } from 'zod';

// Non-global regexes for .test(): a /g regex keeps lastIndex between calls and would skip matches.
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/;
const ANY_CONTROL = /\p{Cc}/u;
const CONTROL_EXCEPT_TAB_LF = /(?![\t\n])\p{Cc}/u;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

interface TextOptions {
  min?: number;
  max: number;
  // Description and message bodies may contain line breaks and tabs; every other field is single-line.
  multiline?: boolean;
}

/**
 * The one helper for user-entered text. NFC so the same visible text is stored once; NUL and other control
 * characters break PostgreSQL text (500) and log/CSV/e-mail output; bidi overrides spoof what an analyst reads
 * (security review M4). The minimum ignores zero-width characters, which String.trim() keeps.
 */
export function text({ min = 0, max, multiline = false }: TextOptions) {
  const forbiddenControl = multiline ? CONTROL_EXCEPT_TAB_LF : ANY_CONTROL;
  return z
    .string()
    .normalize('NFC')
    .overwrite((value) => (multiline ? value.replace(/\r\n?/g, '\n') : value))
    .trim()
    .refine((value) => !forbiddenControl.test(value), { message: 'text.control_character' })
    .refine((value) => !BIDI_CONTROL.test(value), { message: 'text.bidi_control' })
    .refine((value) => value.replace(ZERO_WIDTH, '').length >= min, { message: 'text.too_short' })
    .max(max);
}

// Format schemas such as z.email() validate before a chained .trim(), so normalise first and pipe into the format.
// Lowercase because users.email is citext: case variants must map to one rate-limit key (security review M2).
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const UuidSchema = z.uuid();

// bcrypt ignores everything after 72 bytes, so a longer password would silently lose its tail.
const BCRYPT_MAX_BYTES = 72;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    // for...of yields one non-empty code point per iteration, so codePointAt(0) is always defined.
    const codePoint = char.codePointAt(0) as number;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Rules every password field shares, including login and the current password, so the value hashed at
 * registration and the value compared at login go through the same transformation.
 * Not trimmed, unlike every other string: a password is a secret and is hashed exactly as typed. Trimming would
 * silently change it (a deliberate leading or trailing space would be lost), and any client or future endpoint
 * that did not trim the same way would then fail to log in with the password the user actually chose.
 * NFC because keyboards may produce composed or decomposed accents for the same visible password.
 * Control characters (NUL included) are rejected: some bcrypt implementations stop at NUL.
 */
const passwordInput = () =>
  z
    .string()
    .normalize('NFC')
    .refine((value) => !ANY_CONTROL.test(value), { message: 'password.control_character' })
    .refine((value) => utf8ByteLength(value) <= BCRYPT_MAX_BYTES, {
      message: 'password.too_long',
    });

// Login and current password: no policy, so a wrong password gets UNAUTHENTICATED rather than a policy hint.
// The upper bound is the 72-byte limit of passwordInput(); a character limit would never be reached first.
export const ExistingPasswordSchema = passwordInput().min(1);

/**
 * Password policy from the L3 mockups (M04b, M05a), reused by reset, set-password (first login) and change-password.
 * "Different from the previous password" needs the stored hash, so the server checks it.
 */
export const PasswordSchema = passwordInput()
  .min(10)
  .regex(/[A-Z]/, { message: 'password.uppercase_required' })
  .regex(/[a-z]/, { message: 'password.lowercase_required' })
  .regex(/[0-9]/, { message: 'password.digit_required' });

// Opaque random tokens (refresh, reset, set-password): base64url of 256 bits is 43 characters.
export const OpaqueTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

// E.164 without spaces, e.g. +2376XXXXXXXX.
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/);
