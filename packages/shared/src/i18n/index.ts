import type { Language } from '../types/index.js';
import { en } from './en.js';
import type { SharedMessages } from './fr.js';
import { fr } from './fr.js';

export { en, fr };
export type { SharedMessages };

export const sharedMessages: Record<Language, SharedMessages> = { fr, en };
