import type { UserRole } from '@secure360/shared';

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
      };
    }
  }
}

export {};
