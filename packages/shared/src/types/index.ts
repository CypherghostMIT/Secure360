import type { z } from 'zod';
import type { CategoryCodeSchema, CategoryGroupSchema } from '../constants/categories.js';
import type { LanguageSchema } from '../constants/languages.js';
import type {
  ClientOrganizationTypeSchema,
  OrganizationTypeSchema,
  SubscriptionPlanSchema,
} from '../constants/organizations.js';
import type { UserRoleSchema } from '../constants/roles.js';
import type { SeveritySchema } from '../constants/severities.js';
import type { IncidentStatusSchema } from '../constants/statuses.js';
import type {
  ChangePasswordInputSchema,
  ForgotPasswordInputSchema,
  LoginInputSchema,
  RefreshInputSchema,
  ResetPasswordInputSchema,
  VerifyTotpInputSchema,
} from '../schemas/auth.schema.js';
import type {
  CursorPaginationQuerySchema,
  ErrorResponseSchema,
  UuidParamsSchema,
} from '../schemas/common.schema.js';
import type {
  CreateIncidentInputSchema,
  GuidedAnswerSchema,
  IncidentFiltersSchema,
  SeverityAnswersSchema,
  UpdateIncidentInputSchema,
} from '../schemas/incident.schema.js';
import type { CreateMessageInputSchema } from '../schemas/message.schema.js';
import type { CreateOrgInputSchema, UpdateOrgInputSchema } from '../schemas/organization.schema.js';
import type { CreateUserInputSchema, UpdateUserInputSchema } from '../schemas/user.schema.js';

// Every type is inferred from a schema; none is written by hand.
// `z.infer` is the parsed value the server works with. `*Payload` (z.input) is what a client may send
// when the schema fills defaults or coerces query strings.

export type Severity = z.infer<typeof SeveritySchema>;
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type OrganizationType = z.infer<typeof OrganizationTypeSchema>;
export type ClientOrganizationType = z.infer<typeof ClientOrganizationTypeSchema>;
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;
export type CategoryCode = z.infer<typeof CategoryCodeSchema>;
export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;

export type LoginInput = z.infer<typeof LoginInputSchema>;
export type VerifyTotpInput = z.infer<typeof VerifyTotpInputSchema>;
export type RefreshInput = z.infer<typeof RefreshInputSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

export type UuidParams = z.infer<typeof UuidParamsSchema>;
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;
export type CursorPaginationQueryPayload = z.input<typeof CursorPaginationQuerySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export type GuidedAnswer = z.infer<typeof GuidedAnswerSchema>;
export type SeverityAnswers = z.infer<typeof SeverityAnswersSchema>;
export type CreateIncidentInput = z.infer<typeof CreateIncidentInputSchema>;
export type CreateIncidentPayload = z.input<typeof CreateIncidentInputSchema>;
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentInputSchema>;
export type IncidentFilters = z.infer<typeof IncidentFiltersSchema>;
export type IncidentFiltersPayload = z.input<typeof IncidentFiltersSchema>;

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;
export type CreateUserPayload = z.input<typeof CreateUserInputSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgInputSchema>;

export type CreateMessageInput = z.infer<typeof CreateMessageInputSchema>;
export type CreateMessagePayload = z.input<typeof CreateMessageInputSchema>;
