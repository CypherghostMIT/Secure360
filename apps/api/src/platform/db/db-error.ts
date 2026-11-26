/**
 * What the API needs from a database error, read from the shapes Prisma 7 + @prisma/adapter-pg actually produce
 * (pinned by tests/integration/db-errors.test.ts):
 *  - PrismaClientKnownRequestError { code: 'P2025' | 'P2002' | 'P2039' (ORM call) | 'P2010' (raw query) | … }
 *    with meta.driverAdapterError.cause = { originalCode: SQLSTATE, originalMessage } for a PostgreSQL error,
 *    or { kind: 'DatabaseNotReachable' | 'ConnectionClosed' | … } for a socket error (no SQLSTATE).
 *  - A pool timeout from pg-pool: a plain Error('timeout exceeded when trying to connect') that Prisma tags with
 *    clientVersion.
 * Every Prisma error carries clientVersion; that is how a database error is told apart from anything else.
 */
export interface DbErrorInfo {
  readonly prismaCode?: string;
  readonly sqlstate?: string;
  readonly adapterKind?: string;
  /** PostgreSQL's own message. May contain values (e.g. invalid input syntax): never send or log it raw. */
  readonly pgMessage?: string;
  readonly message: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function readDbError(error: unknown): DbErrorInfo | undefined {
  if (!(error instanceof Error)) return undefined;
  const record = asRecord(error);
  if (readString(record, 'clientVersion') === undefined) return undefined;
  const meta = asRecord(record?.['meta']);
  const cause = asRecord(asRecord(meta?.['driverAdapterError'])?.['cause']);
  const prismaCode = readString(record, 'code');
  const sqlstate = readString(cause, 'originalCode');
  const adapterKind = readString(cause, 'kind');
  const pgMessage = readString(cause, 'originalMessage');
  return {
    message: error.message,
    ...(prismaCode !== undefined && { prismaCode }),
    ...(sqlstate !== undefined && { sqlstate }),
    ...(adapterKind !== undefined && { adapterKind }),
    ...(pgMessage !== undefined && { pgMessage }),
  };
}
