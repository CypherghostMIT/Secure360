import { z } from 'zod';
import { text } from './primitives.schema.js';

const body = () => text({ min: 1, max: 2000, multiline: true });

// Reporter (and Manager) messages: no isInternal field, so only staff can write internal notes.
export const CreateMessageInputSchema = z.object({ body: body() }).strict();

// Staff (Technician, Admin) only, by route guard. Internal notes are never shown to the reporter (L2 Table 14).
// isInternal is required with no default: a client that forgets it gets VALIDATION_ERROR, so an internal note
// can never be published to the reporter by omission.
export const CreateStaffMessageInputSchema = z
  .object({
    body: body(),
    isInternal: z.boolean(),
  })
  .strict();
