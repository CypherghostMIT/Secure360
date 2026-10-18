import { z } from 'zod';

// Stored values follow the data model (spec §6.2, L1 BF04). "Moderate" is a display label only (i18n).
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const SeveritySchema = z.enum(SEVERITIES);
