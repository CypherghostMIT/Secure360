import { UserRoleSchema } from '@secure360/shared';
import { z } from 'zod';

// L2 §8.2 and BNF05. Server-only: clients treat tokens as opaque and never decode them, so these schemas are not
// in packages/shared.
export const TOKEN_ISSUER = 'secure360-api';
export const ACCESS_TOKEN_AUDIENCE = 'secure360-api';
export const MFA_TOKEN_AUDIENCE = 'secure360-mfa';
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const MFA_TOKEN_TTL_SECONDS = 5 * 60;

// A real access token is about 450 bytes. The cap bounds the work done on hostile input before any parsing.
export const MAX_TOKEN_BYTES = 4096;

// Tokens are signed and verified by API replicas on the same host clock, so real skew is ~0. 5 s keeps verification
// correct after a scale-out to hosts with independently NTP-synced clocks (L2 F15) and extends a token's life by at
// most 5 s.
export const CLOCK_TOLERANCE_SECONDS = 5;

// Same grammar as keyring ids (platform/crypto/keyring.ts): decimal 1..65535, no sign, space or leading zero.
const KEY_ID_TEXT = /^[1-9][0-9]{0,4}$/;

// Ids come from the database in canonical lower case and are used in Redis keys: any other spelling is refused
// rather than normalised.
const CanonicalUuid = z.uuid().regex(/^[0-9a-f-]{36}$/);
const NumericDate = z.int().nonnegative();

/** Every token header this API signs: jsonwebtoken writes exactly these three parameters. */
export const TokenHeaderSchema = z
  .object({
    alg: z.literal('HS256'),
    typ: z.literal('JWT'),
    kid: z.string().regex(KEY_ID_TEXT),
  })
  .strict();

const commonClaims = {
  sub: CanonicalUuid,
  jti: CanonicalUuid,
  iss: z.literal(TOKEN_ISSUER),
  iat: NumericDate,
  exp: NumericDate,
};

export const AccessTokenClaimsSchema = z
  .object({
    ...commonClaims,
    aud: z.literal(ACCESS_TOKEN_AUDIENCE),
    org: CanonicalUuid,
    role: UserRoleSchema,
    // users.session_version starts at 1 (CHECK chk_users_session_version).
    sv: z.int().min(1),
  })
  .strict();

// No org, role or sv: an MFA token proves only that the password was right, so it must grant nothing else.
export const MfaTokenClaimsSchema = z
  .object({
    ...commonClaims,
    aud: z.literal(MFA_TOKEN_AUDIENCE),
    typ: z.literal('mfa'),
  })
  .strict();

export type TokenHeader = z.infer<typeof TokenHeaderSchema>;
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;
export type MfaTokenClaims = z.infer<typeof MfaTokenClaimsSchema>;
