import type { z } from 'zod';
import type { listResponse, successResponse } from '@secure360/shared';

// Typed from the shared schemas, so a change to the envelope in packages/shared breaks the build here.
type Success<T extends z.ZodType> = z.infer<ReturnType<typeof successResponse<T>>>;
type List<T extends z.ZodType> = z.infer<ReturnType<typeof listResponse<T>>>;

/** `{ success: true, data, message? }`; `data` is a DTO from a mapper, never a raw row (AGENTS rule 5). */
export function toSuccessEnvelope<T extends z.ZodType>(
  data: z.infer<T>,
  message?: string,
): Success<T> {
  return { success: true, data, ...(message !== undefined && { message }) } as Success<T>;
}

/** `{ success: true, data: [...], meta: { nextCursor } }` — the only list shape (L2 §4.4). */
export function toListEnvelope<T extends z.ZodType>(
  items: z.infer<T>[],
  nextCursor: string | null,
  message?: string,
): List<T> {
  return {
    success: true,
    data: items,
    meta: { nextCursor },
    ...(message !== undefined && { message }),
  };
}
