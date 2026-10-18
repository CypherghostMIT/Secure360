import { z } from 'zod';
import { CategoryCodeSchema, CategoryGroupSchema } from '../constants/categories.js';
import { SeveritySchema } from '../constants/severities.js';
import { IncidentStatusSchema } from '../constants/statuses.js';
import { paginationShape } from './common.schema.js';
import { optionalTrimmed, trimmed, UuidSchema } from './primitives.schema.js';

export const GuidedAnswerSchema = z.enum(['yes', 'no', 'unknown']);

// L1 Table 13: Q1 money lost, Q2 secret shared / link clicked, Q3 unable to work or colleagues affected.
export const SeverityAnswersSchema = z
  .object({
    moneyLost: GuidedAnswerSchema,
    sharedSecret: GuidedAnswerSchema,
    othersAffected: GuidedAnswerSchema,
  })
  .strict();

// No severity: the server computes it from the category and the answers (L2 §8.3). The reporter may only
// propose a higher level (L1 D3) through reporterSeverity, combined with resolveInitialSeverity().
// No organizationId or reporterId: both come from the verified JWT.
export const CreateIncidentInputSchema = z
  .object({
    categoryCode: CategoryCodeSchema,
    title: trimmed(3, 150),
    // Non-empty only: non-technical reporters write short texts.
    description: trimmed(1, 5000),
    answers: SeverityAnswersSchema,
    reporterSeverity: SeveritySchema.optional(),
    isAnonymous: z.boolean().default(false),
    location: optionalTrimmed(200),
    deviceAffected: optionalTrimmed(200),
    // Generated on the device so offline retries map to one server record (L2 §7.3).
    clientRequestId: z.uuidv4(),
  })
  .strict();

// Staff only (route guard). Allowed status transitions are checked in the incidents service, not here.
export const UpdateIncidentInputSchema = z
  .object({
    version: z.number().int().min(0),
    status: IncidentStatusSchema.optional(),
    severity: SeveritySchema.optional(),
    assignedTo: UuidSchema.nullable().optional(),
    resolutionNotes: trimmed(1, 5000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'version'), {
    message: 'update.no_fields',
  });

export const IncidentFiltersSchema = z
  .object({
    ...paginationShape,
    status: IncidentStatusSchema.optional(),
    severity: SeveritySchema.optional(),
    categoryCode: CategoryCodeSchema.optional(),
    group: CategoryGroupSchema.optional(),
    assignedTo: UuidSchema.optional(),
    // Only meaningful for staff; RLS already limits other roles to their own organisation.
    organizationId: UuidSchema.optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdTo: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
