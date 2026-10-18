import { z } from 'zod';
import { LanguageSchema } from '../constants/languages.js';
import { UserRoleSchema } from '../constants/roles.js';
import { EmailSchema, PhoneSchema, text, UuidSchema } from './primitives.schema.js';

const name = () => text({ min: 1, max: 100 });

// Admin only (L1 Table 10: only the Admin manages organisations and users; there is no Manager variant).
// No password: the server e-mails a single-use set-password link and sets must_change_password.
// Role rules are business rules enforced by the users service, not by this schema: TECHNICIAN and ADMIN
// exist only in the PROVIDER organisation.
export const CreateUserInputSchema = z
  .object({
    organizationId: UuidSchema,
    firstName: name(),
    lastName: name(),
    email: EmailSchema,
    phone: PhoneSchema.optional(),
    role: UserRoleSchema,
    preferredLanguage: LanguageSchema.default('fr'),
  })
  .strict();

// Admin only, same service-side role rules as above. E-mail and organisation cannot be changed here.
export const UpdateUserInputSchema = z
  .object({
    firstName: name().optional(),
    lastName: name().optional(),
    phone: PhoneSchema.nullable().optional(),
    role: UserRoleSchema.optional(),
    preferredLanguage: LanguageSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'update.no_fields' });

// PATCH /users/me, any role. Only profile fields: role, organisation, activation and e-mail are not
// self-service, and .strict() is what blocks their mass assignment (L2 §8.4, security review M3).
export const UpdateMeInputSchema = z
  .object({
    firstName: name().optional(),
    lastName: name().optional(),
    phone: PhoneSchema.nullable().optional(),
    preferredLanguage: LanguageSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'update.no_fields' });
