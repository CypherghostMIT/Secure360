import { z } from 'zod';
import { trimmed } from './primitives.schema.js';

// isInternal is reserved to staff (service rule); internal notes are never shown to the reporter (L2 Table 14).
export const CreateMessageInputSchema = z
  .object({
    body: trimmed(1, 2000),
    isInternal: z.boolean().default(false),
  })
  .strict();
