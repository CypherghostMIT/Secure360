import { DEFAULT_LANGUAGE, LANGUAGES } from '../constants/languages.js';
import type { Language } from '../types/index.js';

// Long enough for any real header; the cap keeps parsing cheap whatever a client sends.
const MAX_HEADER_LENGTH = 256;
// RFC 4647 basic language range: a primary subtag of 1-8 letters, then subtags of 1-8 alphanumerics.
// Checked one subtag at a time, so no regex has nested quantifiers (no catastrophic backtracking).
const PRIMARY_SUBTAG = /^[a-z]{1,8}$/;
const SUBTAG = /^[a-z0-9]{1,8}$/;

const isSupported = (value: string): value is Language =>
  (LANGUAGES as readonly string[]).includes(value);

/**
 * Language of server-generated text from a raw Accept-Language header (L2 §4.4), e.g. a browser's
 * "fr-FR,fr;q=0.9" → "fr" and "en-US,en" → "en". Only the first range counts; quality values are ignored.
 * Anything empty, malformed, unsupported or not a string falls back to French. Never throws, so a bad header
 * cannot turn a request into an error. AcceptLanguageSchema remains the validator for explicit settings.
 */
export function resolveLanguage(header: string | undefined): Language {
  if (typeof header !== 'string') return DEFAULT_LANGUAGE;
  const capped = header.slice(0, MAX_HEADER_LENGTH);
  const end = capped.search(/[;,]/);
  const range = (end === -1 ? capped : capped.slice(0, end)).trim().toLowerCase();
  const subtags = range.split('-');
  const isWellFormed = subtags.every((tag, i) => (i === 0 ? PRIMARY_SUBTAG : SUBTAG).test(tag));
  if (!isWellFormed) return DEFAULT_LANGUAGE;
  // split() always returns at least one element, and it was just checked.
  const primary = subtags[0] as string;
  return isSupported(primary) ? primary : DEFAULT_LANGUAGE;
}
