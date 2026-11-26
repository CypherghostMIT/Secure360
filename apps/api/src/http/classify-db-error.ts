import type { ErrorCode } from '@secure360/shared';
import type { DbErrorInfo } from '../platform/db/db-error';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DbClassification {
  readonly code: ErrorCode;
  readonly level: LogLevel;
  readonly reason: string;
  /** Logged only when the message is one of our own constants (guard triggers). */
  readonly dbMessage?: string;
}

const INSUFFICIENT_PRIVILEGE = '42501';
// query_canceled: raised by statement_timeout (and by pg_cancel_backend, which only an operator sends). The database
// is up but overloaded or the query is too slow: a retry later may succeed, so 503 — at warn, since one slow query
// is not an outage; a run of them shows up in the logs by route.
const QUERY_CANCELED = '57014';

// Messages of the guard triggers (migration 20261019120100_rls_functions_grants). They also raise 42501, so
// they are told apart from RLS and missing grants by their exact text. If a migration rewords one, the unit test
// listing them and tests/integration/db-errors.test.ts must change with it.
const GUARD_TRIGGER_MESSAGES: ReadonlySet<string> = new Set([
  'users.id cannot change',
  'only an ADMIN may change role, organization_id, is_active or email',
  'session_version cannot decrease',
  'session_version may only be raised by the user or an ADMIN',
  'totp_last_step cannot decrease',
  'TECHNICIAN and ADMIN users must belong to the PROVIDER organization',
  'incidents identity, provenance and confidentiality columns cannot change',
  'incidents.assigned_to must be an active staff user',
]);

// PostgreSQL server messages (lc_messages is English on our image; pinned by the integration test).
const RLS_VIOLATION_PREFIX = 'new row violates row-level security policy';
const PERMISSION_DENIED_PREFIX = 'permission denied for ';

// Database unreachable → 503 (L2 §9.2). Prisma codes, adapter-pg socket error kinds, and SQLSTATEs for a
// connection lost or refused by the server (class 08, 57P01–57P03 shutdown/startup, 53300 too many connections).
const UNAVAILABLE_PRISMA_CODES: ReadonlySet<string> = new Set(['P1001', 'P1017', 'P2024']);
const UNAVAILABLE_ADAPTER_KINDS: ReadonlySet<string> = new Set([
  'DatabaseNotReachable',
  'ConnectionClosed',
  'SocketTimeout',
  'TooManyConnections',
]);
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set(['57P01', '57P02', '57P03', '53300']);
// pg-pool gives this plain Error when no connection frees up within connectionTimeoutMillis.
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

function isUnavailable(db: DbErrorInfo): boolean {
  if (db.prismaCode !== undefined && UNAVAILABLE_PRISMA_CODES.has(db.prismaCode)) return true;
  if (db.adapterKind !== undefined && UNAVAILABLE_ADAPTER_KINDS.has(db.adapterKind)) return true;
  if (db.sqlstate !== undefined) {
    return db.sqlstate.startsWith('08') || UNAVAILABLE_SQLSTATES.has(db.sqlstate);
  }
  return db.prismaCode === undefined && db.message === POOL_TIMEOUT_MESSAGE;
}

function classifyInsufficientPrivilege(message: string): DbClassification {
  // Another tenant's row is indistinguishable from an absent one (L2 §8.3): 404, never 403.
  if (message.startsWith(RLS_VIOLATION_PREFIX)) {
    return { code: 'NOT_FOUND', level: 'warn', reason: 'db.rls_violation' };
  }
  if (GUARD_TRIGGER_MESSAGES.has(message)) {
    return { code: 'FORBIDDEN', level: 'warn', reason: 'db.guard_trigger', dbMessage: message };
  }
  const reason = message.startsWith(PERMISSION_DENIED_PREFIX)
    ? 'db.permission_denied'
    : 'db.insufficient_privilege';
  return { code: 'INTERNAL_ERROR', level: 'error', reason };
}

/**
 * Maps a database error to a shared code. P2003 (foreign key) deliberately stays INTERNAL_ERROR: foreign-key checks
 * bypass RLS, so a client error there could confirm that another tenant's id exists. Services validate referenced
 * ids inside the tenant transaction instead.
 */
export function classifyDbError(db: DbErrorInfo): DbClassification {
  if (isUnavailable(db))
    return { code: 'SERVICE_UNAVAILABLE', level: 'error', reason: 'db.unavailable' };
  if (db.sqlstate === QUERY_CANCELED)
    return { code: 'SERVICE_UNAVAILABLE', level: 'warn', reason: 'db.statement_timeout' };
  if (db.prismaCode === 'P2025')
    return { code: 'NOT_FOUND', level: 'info', reason: 'db.not_found' };
  if (db.prismaCode === 'P2002')
    return { code: 'CONFLICT', level: 'info', reason: 'db.unique_violation' };
  if (db.sqlstate === INSUFFICIENT_PRIVILEGE)
    return classifyInsufficientPrivilege(db.pgMessage ?? '');
  return { code: 'INTERNAL_ERROR', level: 'error', reason: 'db.unexpected' };
}
