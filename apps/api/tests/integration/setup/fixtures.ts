// Fixed identifiers of the seed data, shared by the seed and the tests. Fictitious data only.

export const ORG = {
  sfc: '10000000-0000-4000-8000-000000000001',
  a: '10000000-0000-4000-8000-00000000000a',
  b: '10000000-0000-4000-8000-00000000000b',
} as const;

export const USER = {
  technician: '20000000-0000-4000-8000-000000000001',
  admin: '20000000-0000-4000-8000-000000000002',
  aUser1: '20000000-0000-4000-8000-0000000000a1',
  aUser2: '20000000-0000-4000-8000-0000000000a2',
  aManager: '20000000-0000-4000-8000-0000000000a3',
  bUser: '20000000-0000-4000-8000-0000000000b1',
  bManager: '20000000-0000-4000-8000-0000000000b2',
} as const;

export const INCIDENT = {
  a1: '30000000-0000-4000-8000-0000000000a1',
  a2: '30000000-0000-4000-8000-0000000000a2',
  a3: '30000000-0000-4000-8000-0000000000a3',
  b1: '30000000-0000-4000-8000-0000000000b1',
} as const;

export const MESSAGE = {
  a1Reporter: '40000000-0000-4000-8000-0000000000a1',
  a1Internal: '40000000-0000-4000-8000-0000000000a2',
  a1StaffReply: '40000000-0000-4000-8000-0000000000a3',
  b1Reporter: '40000000-0000-4000-8000-0000000000b1',
} as const;

export const EMAIL = {
  aUser1: 'a.user1@org-a.test',
} as const;

// Shape of a bcrypt cost-12 hash (chk_users_password_hash); not the hash of any password.
export const FAKE_BCRYPT_HASH = `$2b$12$${'a'.repeat(53)}`;

export type Role = 'USER' | 'MANAGER' | 'TECHNICIAN' | 'ADMIN';

export interface TenantContext {
  orgId: string;
  userId: string;
  role: Role;
}

// What the authentication middleware would derive from each user's verified JWT.
export const CONTEXT = {
  technician: { orgId: ORG.sfc, userId: USER.technician, role: 'TECHNICIAN' },
  admin: { orgId: ORG.sfc, userId: USER.admin, role: 'ADMIN' },
  aUser1: { orgId: ORG.a, userId: USER.aUser1, role: 'USER' },
  aUser2: { orgId: ORG.a, userId: USER.aUser2, role: 'USER' },
  aManager: { orgId: ORG.a, userId: USER.aManager, role: 'MANAGER' },
  bUser: { orgId: ORG.b, userId: USER.bUser, role: 'USER' },
  bManager: { orgId: ORG.b, userId: USER.bManager, role: 'MANAGER' },
} as const satisfies Record<string, TenantContext>;
