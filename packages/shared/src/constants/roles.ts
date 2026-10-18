import { z } from 'zod';

export const USER_ROLES = ['USER', 'MANAGER', 'TECHNICIAN', 'ADMIN'] as const;

export const UserRoleSchema = z.enum(USER_ROLES);
