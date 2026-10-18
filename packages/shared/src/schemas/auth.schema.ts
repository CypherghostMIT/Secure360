import { z } from 'zod';
import {
  EmailSchema,
  ExistingPasswordSchema,
  OpaqueTokenSchema,
  PasswordSchema,
} from './primitives.schema.js';

// Login does not apply the password policy: a wrong password must get UNAUTHENTICATED, not a policy hint.
// It still applies the shared password transformation (NFC, no control characters, 72 bytes), never trimming.
export const LoginInputSchema = z
  .object({
    email: EmailSchema,
    password: ExistingPasswordSchema,
  })
  .strict();

// The 5-minute MFA token travels in the Authorization header (L2 §8.2), so the body holds only the code.
export const VerifyTotpInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

// Mobile sends the refresh token in the body; the web sends it as an HttpOnly cookie with an empty body (L2 §8.2).
export const RefreshInputSchema = z
  .object({
    refreshToken: OpaqueTokenSchema.optional(),
  })
  .strict();

export const ForgotPasswordInputSchema = z.object({ email: EmailSchema }).strict();

// Also used by the single-use set-password link sent to new users (same token mechanism as reset).
export const ResetPasswordInputSchema = z
  .object({
    token: OpaqueTokenSchema,
    newPassword: PasswordSchema,
  })
  .strict();

export const ChangePasswordInputSchema = z
  .object({
    currentPassword: ExistingPasswordSchema,
    newPassword: PasswordSchema,
  })
  .strict();
