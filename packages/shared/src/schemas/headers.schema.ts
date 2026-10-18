import { LanguageSchema } from '../constants/languages.js';
import { UuidV4Schema } from './primitives.schema.js';

// Idempotency-Key on POST requests from the mobile queue (L2 §4.4). The server uses it as a storage key,
// so its size and characters must be fixed before it gets there, and its case normalised.
export const IdempotencyKeyHeaderSchema = UuidV4Schema;

// Accept-Language selects server-generated text (L2 §4.4). Clients send exactly "fr" or "en"; absent means French.
export const AcceptLanguageSchema = LanguageSchema.default('fr');
