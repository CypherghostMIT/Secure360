import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { EMAIL, FAKE_BCRYPT_HASH, INCIDENT, MESSAGE, ORG, REPORT_JOB, USER } from './fixtures';

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const hex = (value: string) => sha256(value).toString('hex');

const organizations = [
  { id: ORG.sfc, name: 'Security First Cameroon', type: 'PROVIDER' },
  { id: ORG.a, name: 'Organisation A', type: 'COMPANY' },
  { id: ORG.b, name: 'Organisation B', type: 'NGO' },
] as const;

const users = [
  { id: USER.technician, organizationId: ORG.sfc, role: 'TECHNICIAN', email: 'tech@sfc.test' },
  { id: USER.admin, organizationId: ORG.sfc, role: 'ADMIN', email: 'admin@sfc.test' },
  { id: USER.aUser1, organizationId: ORG.a, role: 'USER', email: EMAIL.aUser1 },
  { id: USER.aUser2, organizationId: ORG.a, role: 'USER', email: 'a.user2@org-a.test' },
  { id: USER.aManager, organizationId: ORG.a, role: 'MANAGER', email: 'a.manager@org-a.test' },
  { id: USER.bUser, organizationId: ORG.b, role: 'USER', email: 'b.user@org-b.test' },
  { id: USER.bManager, organizationId: ORG.b, role: 'MANAGER', email: 'b.manager@org-b.test' },
] as const;

const incidents = [
  { id: INCIDENT.a1, organizationId: ORG.a, reporterId: USER.aUser1, n: 1, isAnonymous: true },
  { id: INCIDENT.a2, organizationId: ORG.a, reporterId: USER.aUser1, n: 2, isAnonymous: false },
  { id: INCIDENT.a3, organizationId: ORG.a, reporterId: USER.aUser2, n: 3, isAnonymous: false },
  { id: INCIDENT.b1, organizationId: ORG.b, reporterId: USER.bUser, n: 4, isAnonymous: false },
] as const;

async function seedTenants(db: PrismaClient): Promise<void> {
  await db.organization.createMany({
    data: organizations.map((org) => ({
      ...org,
      sector: 'Test',
      city: 'Douala',
      contactEmail: `contact@${org.id.slice(-2)}.test`,
      subscriptionPlan: 'STANDARD',
    })),
  });
  await db.user.createMany({
    data: users.map((user) => ({
      ...user,
      firstName: 'Test',
      lastName: user.role,
      passwordHash: FAKE_BCRYPT_HASH,
    })),
  });
  await db.incidentCategory.createMany({
    data: [
      {
        code: 'MSG-01',
        groupCode: 'MESSAGING_PHISHING',
        labelFr: 'Hameçonnage',
        labelEn: 'Phishing',
        defaultSeverity: 'MEDIUM',
        sortOrder: 1,
      },
      {
        code: 'MOB-02',
        groupCode: 'MOBILE',
        labelFr: 'SIM swap',
        labelEn: 'SIM swap',
        defaultSeverity: 'CRITICAL',
        sortOrder: 2,
      },
    ],
  });
}

async function seedIncidents(db: PrismaClient): Promise<void> {
  await db.incident.createMany({
    data: incidents.map((incident) => ({
      id: incident.id,
      organizationId: incident.organizationId,
      reporterId: incident.reporterId,
      isAnonymous: incident.isAnonymous,
      reference: `SFC-2026-${String(incident.n).padStart(6, '0')}`,
      categoryCode: 'MSG-01',
      title: `Incident ${incident.n}`,
      description: 'Suspicious e-mail',
      severity: 'MEDIUM',
      severityInitial: 'MEDIUM',
      severityAnswers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'unknown' },
      clientRequestId: incident.id.replace(/^3/, '5'),
    })),
  });
  await db.incidentStatusHistory.createMany({
    data: incidents.map((incident) => ({
      incidentId: incident.id,
      organizationId: incident.organizationId,
      toStatus: 'NEW',
      changedBy: incident.reporterId,
    })),
  });
}

async function seedChildren(db: PrismaClient): Promise<void> {
  await db.incidentMessage.createMany({
    data: [
      {
        id: MESSAGE.a1Reporter,
        incidentId: INCIDENT.a1,
        organizationId: ORG.a,
        senderId: USER.aUser1,
        body: 'Hello',
      },
      {
        id: MESSAGE.a1Internal,
        incidentId: INCIDENT.a1,
        organizationId: ORG.a,
        senderId: USER.technician,
        body: 'Internal note',
        isInternal: true,
      },
      {
        id: MESSAGE.a1StaffReply,
        incidentId: INCIDENT.a1,
        organizationId: ORG.a,
        senderId: USER.technician,
        body: 'We are on it',
      },
      {
        id: MESSAGE.b1Reporter,
        incidentId: INCIDENT.b1,
        organizationId: ORG.b,
        senderId: USER.bUser,
        body: 'Hello',
      },
    ],
  });
  await db.attachment.createMany({
    data: [INCIDENT.a1, INCIDENT.b1].map((incidentId, i) => {
      const organizationId = incidentId === INCIDENT.a1 ? ORG.a : ORG.b;
      return {
        incidentId,
        organizationId,
        uploadedBy: incidentId === INCIDENT.a1 ? USER.aUser1 : USER.bUser,
        storageKey: `${organizationId}/2026/6000000${i}-0000-4000-8000-000000000000.bin`,
        mime: 'image/jpeg',
        sizeBytes: 1024,
        sha256: hex(incidentId),
        width: 640,
        height: 480,
      };
    }),
  });
  await db.notification.createMany({
    data: [
      {
        userId: USER.aUser1,
        organizationId: ORG.a,
        incidentId: INCIDENT.a1,
        type: 'NEW_MESSAGE',
        titleKey: 'notifications.newMessage.title',
        bodyKey: 'notifications.newMessage.body',
      },
      {
        userId: USER.bUser,
        organizationId: ORG.b,
        incidentId: INCIDENT.b1,
        type: 'NEW_MESSAGE',
        titleKey: 'notifications.newMessage.title',
        bodyKey: 'notifications.newMessage.body',
      },
    ],
  });
  await db.deviceToken.createMany({
    data: [
      {
        userId: USER.aUser1,
        organizationId: ORG.a,
        fcmToken: 'fcm-token-a-user-1',
        platform: 'ANDROID',
      },
      {
        userId: USER.bUser,
        organizationId: ORG.b,
        fcmToken: 'fcm-token-b-user',
        platform: 'ANDROID',
      },
    ],
  });
}

async function seedSystemRows(db: PrismaClient): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.refreshToken.createMany({
    data: [
      {
        userId: USER.aUser1,
        organizationId: ORG.a,
        familyId: INCIDENT.a1,
        tokenHash: sha256('refresh-a'),
        expiresAt,
      },
      {
        userId: USER.bUser,
        organizationId: ORG.b,
        familyId: INCIDENT.b1,
        tokenHash: sha256('refresh-b'),
        expiresAt,
      },
    ],
  });
  await db.outboxEvent.createMany({
    data: [
      {
        eventType: 'incident.created',
        aggregateId: INCIDENT.a1,
        organizationId: ORG.a,
        payload: { incidentId: INCIDENT.a1 },
      },
    ],
  });
  await db.passwordResetToken.createMany({
    data: [{ userId: USER.bUser, organizationId: ORG.b, tokenHash: sha256('reset-b'), expiresAt }],
  });
  await db.idempotencyKey.createMany({
    data: [
      {
        userId: USER.bUser,
        organizationId: ORG.b,
        key: INCIDENT.b1.replace(/^3/, '7'),
        method: 'POST',
        path: '/api/v1/incidents',
        requestHash: sha256('request-b'),
        statusCode: 201,
        response: {},
        expiresAt,
      },
    ],
  });
  await db.reportJob.createMany({
    data: [
      {
        id: REPORT_JOB.aManager,
        requestedBy: USER.aManager,
        organizationId: ORG.a,
        params: { period: '2026-Q3' },
      },
    ],
  });
  await db.auditLog.createMany({
    data: [
      {
        userId: USER.admin,
        organizationId: ORG.sfc,
        action: 'user.login.success',
        entity: 'user',
        entityId: USER.admin,
      },
    ],
  });
}

/** Runs as the bootstrap superuser, which bypasses RLS: the seed is not a test of the policies. */
export async function seed(db: PrismaClient): Promise<void> {
  await seedTenants(db);
  await seedIncidents(db);
  await seedChildren(db);
  await seedSystemRows(db);
}
