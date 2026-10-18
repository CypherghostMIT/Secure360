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

export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

// Function form for symmetry with successResponse/listResponse; the error envelope has no type parameter.
export function errorResponse() {
  return ErrorResponseSchema;
}
