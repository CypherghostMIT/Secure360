import { z } from 'zod';
import {
  ClientOrganizationTypeSchema,
  SubscriptionPlanSchema,
} from '../constants/organizations.js';
import { EmailSchema, trimmed } from './primitives.schema.js';

// Client types only: PROVIDER (SFC) is seeded, never created or assigned through the API.
export const CreateOrgInputSchema = z
  .object({
    name: trimmed(2, 150),
    type: ClientOrganizationTypeSchema,
    sector: trimmed(1, 100),
    city: trimmed(1, 100),
    contactEmail: EmailSchema,
    subscriptionPlan: SubscriptionPlanSchema,
  })
  .strict();

export const UpdateOrgInputSchema = z
  .object({
    name: trimmed(2, 150).optional(),
    type: ClientOrganizationTypeSchema.optional(),
    sector: trimmed(1, 100).optional(),
    city: trimmed(1, 100).optional(),
    contactEmail: EmailSchema.optional(),
    subscriptionPlan: SubscriptionPlanSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'update.no_fields' });
