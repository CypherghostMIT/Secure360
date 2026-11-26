import { readDbError } from '../db/db-error';

export interface SerializedError {
  readonly type: string;
  readonly code?: string;
  readonly sqlstate?: string;
  readonly kind?: string;
  readonly message?: string;
  readonly stack?: string;
}

// Only the call frames: the first stack line repeats the message.
function framesOnly(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  const firstFrame = stack.indexOf('\n    at ');
  return firstFrame === -1 ? undefined : stack.slice(firstFrame + 1);
}

/**
 * Error fields that are safe to log. A raw error must never reach the logger: Prisma messages quote the call and
 * PostgreSQL messages and DETAIL can contain row values (personal data). For a database error only codes and call
 * frames are kept; err.code-style fields always stay visible.
 */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { type: typeof error };
  // error.name, not constructor.name: some libraries (ioredis) build errors whose constructor is Object.
  const type = error.name;
  const db = readDbError(error);
  if (db) {
    const stack = framesOnly(error.stack);
    return {
      type,
      ...(db.prismaCode !== undefined && { code: db.prismaCode }),
      ...(db.sqlstate !== undefined && { sqlstate: db.sqlstate }),
      ...(db.adapterKind !== undefined && { kind: db.adapterKind }),
      ...(stack !== undefined && { stack }),
    };
  }
  const code = (error as { code?: unknown }).code;
  return {
    type,
    message: error.message,
    ...(typeof code === 'string' && { code }),
    ...(error.stack !== undefined && { stack: error.stack }),
  };
}
