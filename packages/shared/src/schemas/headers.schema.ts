import { z } from 'zod';
import { LanguageSchema } from '../constants/languages.js';
import { UuidV4Schema } from './primitives.schema.js';

// Idempotency-Key on POST requests from the mobile queue (L2 §4.4). The server uses it as a storage key,
// so its size and characters must be fixed before it gets there, and its case normalised.
export const IdempotencyKeyHeaderSchema = UuidV4Schema;

// Accept-Language selects server-generated text (L2 §4.4). Clients send exactly "fr" or "en"; absent means French.
export const AcceptLanguageSchema = LanguageSchema.default('fr');

// X-Request-Id (L2 §11.1): Nginx sends its $request_id (32 lowercase hex characters); a direct client may send a
// UUID. Anything else is replaced by a server-generated id, so a forged header cannot inject text into the logs.
// No trimming: a value that needs cleaning is not one Nginx or our clients produce.
const NGINX_REQUEST_ID = /^[0-9a-f]{32}$/;

export const RequestIdHeaderSchema = z.union([
  z.string().regex(NGINX_REQUEST_ID),
  z.uuid().transform((value) => value.toLowerCase()),
]);
