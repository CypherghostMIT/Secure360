import { z } from 'zod';

// PROVIDER is SFC's own organisation (L2 Table 12). It exists in the database but is never creatable through the API.
export const ORGANIZATION_TYPES = ['COMPANY', 'ADMINISTRATION', 'NGO', 'PROVIDER'] as const;
export const CLIENT_ORGANIZATION_TYPES = ['COMPANY', 'ADMINISTRATION', 'NGO'] as const;
export const SUBSCRIPTION_PLANS = ['BASIC', 'STANDARD', 'PREMIUM'] as const;

export const OrganizationTypeSchema = z.enum(ORGANIZATION_TYPES);
export const ClientOrganizationTypeSchema = z.enum(CLIENT_ORGANIZATION_TYPES);
export const SubscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
