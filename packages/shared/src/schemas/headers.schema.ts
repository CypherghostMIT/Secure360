import { z } from 'zod';
import { LanguageSchema } from '../constants/languages.js';

// Idempotency-Key on POST requests from the mobile queue (L2 §4.4). The server uses it as a storage key,
// so its size and characters must be fixed before it gets there.
export const IdempotencyKeyHeaderSchema = z.uuidv4();

// Accept-Language selects server-generated text (L2 §4.4). Clients send exactly "fr" or "en"; absent means French.
export const AcceptLanguageSchema = LanguageSchema.default('fr');
