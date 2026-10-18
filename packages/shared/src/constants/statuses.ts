import { z } from 'zod';

export const INCIDENT_STATUSES = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES);
