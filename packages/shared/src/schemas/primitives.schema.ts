import { z } from 'zod';

// Trim first, then validate: "  " must fail a non-empty rule, and stray spaces must not reach the database.
export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();

// Format schemas such as z.email() validate before a chained .trim(), so trim first and pipe into the format.
export const EmailSchema = z.string().trim().max(254).pipe(z.email());

export const UuidSchema = z.uuid();

/**
 * Password policy from the L3 mockups (M04b, M05a), reused by reset, set-password (first login) and change-password.
 * Not trimmed, unlike every other string: a password is a secret and is hashed exactly as typed. Trimming would
 * silently change it (a deliberate leading or trailing space would be lost), and any client or future endpoint
 * that did not trim the same way would then fail to log in with the password the user actually chose.
 * "Different from the previous password" needs the stored hash, so the server checks it.
 */
export const PasswordSchema = z
  .string()
  .min(10)
  .max(128)
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
