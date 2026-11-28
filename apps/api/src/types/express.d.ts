import type { UserRole } from '@secure360/shared';
import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      // Set only by server middleware (request id, then authentication and tenant resolution), never from
      // client input: a header or body field must never be copied in here.
      context?: {
        requestId: string;
        userId?: string;
        orgId?: string;
        role?: UserRole;
        // Access token id (jti) and session version (sv), set by authenticate: logout deny-lists the jti.
        tokenId?: string;
        sessionVersion?: number;
        // Set by rateLimit() for policies that must not answer 429 (password.forgot, client.errors): the route
        // still sends its usual generic response but skips the work.
        rateLimited?: boolean;
      };
      // Child logger bound to the request id, set by the request logger.
      log?: Logger;
    }
  }
}

export {};
