import type { ErrorCode, ErrorResponse, ValidationIssue } from '@secure360/shared';
import { resolveLanguage, sharedMessages } from '@secure360/shared';

export interface ErrorEnvelopeExtras {
  readonly requestId?: string | undefined;
  readonly details?: readonly ValidationIssue[] | undefined;
}

/** Builds the shared error envelope with the generic localized message for the code (never internal detail). */
export function toErrorEnvelope(
  code: ErrorCode,
  acceptLanguage: string | undefined,
  extras: ErrorEnvelopeExtras = {},
): ErrorResponse {
  const language = resolveLanguage(acceptLanguage);
  return {
    success: false,
    error: {
      code,
      message: sharedMessages[language].errors[code],
      ...(extras.details !== undefined && { details: [...extras.details] }),
      ...(extras.requestId !== undefined && { requestId: extras.requestId }),
    },
  };
}
