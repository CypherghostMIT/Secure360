import type { ErrorCode, ErrorResponse } from '@secure360/shared';
import { resolveLanguage, sharedMessages } from '@secure360/shared';

/** Builds the shared error envelope with the generic localized message for the code (never internal detail). */
export function toErrorEnvelope(
  code: ErrorCode,
  acceptLanguage: string | undefined,
): ErrorResponse {
  const language = resolveLanguage(acceptLanguage);
  return { success: false, error: { code, message: sharedMessages[language].errors[code] } };
}
