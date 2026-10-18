import { z } from 'zod';
import { ErrorCodeSchema } from '../constants/error-codes.js';
import { UuidSchema } from './primitives.schema.js';

export const UuidParamsSchema = z.object({ id: UuidSchema }).strict();

// L2 §4.4: opaque base64/base64url cursor on (created_at, id).
export const CursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_\-+/]+={0,2}$/);

// Query strings arrive as text, hence the coercion. Default 20, maximum 100 (L2 §4.4).
export const paginationShape = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CursorSchema.optional(),
};

export const CursorPaginationQuerySchema = z.object(paginationShape).strict();

export function successResponse<T extends z.ZodType>(dataSchema: T) {
  return z
    .object({
      success: z.literal(true),
      data: dataSchema,
      message: z.string().optional(),
    })
    .strict();
}

export function listResponse<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      success: z.literal(true),
      data: z.array(itemSchema),
      meta: z.object({ nextCursor: z.string().nullable() }).strict(),
      message: z.string().optional(),
    })
    .strict();
}

// Only the location and kind of each validation failure: never the rejected value, a stack or a database
// error, so 5xx responses expose no internal detail (L2 Table 7).
export const ValidationIssueSchema = z
  .object({
    path: z.string(),
    code: z.string(),
  })
  .strict();

export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
        details: z.array(ValidationIssueSchema).optional(),
      })
      .strict()
      .refine((error) => error.details === undefined || error.code === 'VALIDATION_ERROR', {
        message: 'error.details_only_for_validation',
        path: ['details'],
      }),
  })
  .strict();

// Function form for symmetry with successResponse/listResponse; the error envelope has no type parameter.
export function errorResponse() {
  return ErrorResponseSchema;
}
