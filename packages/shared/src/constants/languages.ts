import { z } from 'zod';

// French first: it is the default language (BNF07).
export const LANGUAGES = ['fr', 'en'] as const;
export const DEFAULT_LANGUAGE = 'fr';

export const LanguageSchema = z.enum(LANGUAGES);
