import { z } from 'zod';
import { CategoryCodeSchema, CategoryGroupSchema } from '../constants/categories.js';
import { SeveritySchema } from '../constants/severities.js';
import { IncidentStatusSchema } from '../constants/statuses.js';
import { paginationShape } from './common.schema.js';
import { text, UuidSchema } from './primitives.schema.js';

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
    title: text({ min: 3, max: 150 }),
    // Non-empty only: non-technical reporters write short texts.
    description: text({ min: 1, max: 5000, multiline: true }),
    answers: SeverityAnswersSchema,
    reporterSeverity: SeveritySchema.optional(),
    isAnonymous: z.boolean().default(false),
    location: text({ max: 200 }).optional(),
    deviceAffected: text({ max: 200 }).optional(),
    // Generated on the device so offline retries map to one server record (L2 §7.3).
    clientRequestId: z.uuidv4(),
  })
  .strict();

// Staff only (route guard). Allowed status transitions are checked in the incidents service, not here.
export const UpdateIncidentInputSchema = z
  .object({
    // Optimistic concurrency (L2 §4.4). Starts at 1; the max keeps the value inside a PostgreSQL integer.
    version: z.number().int().min(1).max(2_147_483_647),
    status: IncidentStatusSchema.optional(),
    severity: SeveritySchema.optional(),
    assignedTo: UuidSchema.nullable().optional(),
    resolutionNotes: text({ min: 1, max: 5000, multiline: true }).optional(),
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
