import { z } from 'zod';
import {
  ClientOrganizationTypeSchema,
  SubscriptionPlanSchema,
} from '../constants/organizations.js';
import { EmailSchema, text } from './primitives.schema.js';

// Admin only (L1 Table 10). Client types only: PROVIDER (SFC) is seeded, never created or assigned through the API.
export const CreateOrgInputSchema = z
  .object({
    name: text({ min: 2, max: 150 }),
    type: ClientOrganizationTypeSchema,
    sector: text({ min: 1, max: 100 }),
    city: text({ min: 1, max: 100 }),
    contactEmail: EmailSchema,
    subscriptionPlan: SubscriptionPlanSchema,
  })
  .strict();

export const UpdateOrgInputSchema = z
  .object({
    name: text({ min: 2, max: 150 }).optional(),
    type: ClientOrganizationTypeSchema.optional(),
    sector: text({ min: 1, max: 100 }).optional(),
    city: text({ min: 1, max: 100 }).optional(),
    contactEmail: EmailSchema.optional(),
    subscriptionPlan: SubscriptionPlanSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'update.no_fields' });
