import { z } from 'zod';
import { LanguageSchema } from '../constants/languages.js';
import { UserRoleSchema } from '../constants/roles.js';
import { EmailSchema, PhoneSchema, trimmed, UuidSchema } from './primitives.schema.js';

// No password: the server e-mails a single-use set-password link and sets must_change_password.
// Role rules are business rules enforced by the users service, not by this schema: TECHNICIAN and ADMIN
// exist only in the PROVIDER organisation, and a Manager never creates staff roles or users of another organisation.
export const CreateUserInputSchema = z
  .object({
    organizationId: UuidSchema,
    firstName: trimmed(1, 100),
    lastName: trimmed(1, 100),
    email: EmailSchema,
    phone: PhoneSchema.optional(),
    role: UserRoleSchema,
    preferredLanguage: LanguageSchema.default('fr'),
  })
  .strict();

// Same service-side role rules as above. E-mail and organisation cannot be changed here.
export const UpdateUserInputSchema = z
  .object({
    firstName: trimmed(1, 100).optional(),
    lastName: trimmed(1, 100).optional(),
    phone: PhoneSchema.nullable().optional(),
    role: UserRoleSchema.optional(),
    preferredLanguage: LanguageSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'update.no_fields' });
