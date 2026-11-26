// Fictitious development data (L1 §5.2 personas, organisations from the L3 mockups). Every e-mail is on
// example.com and every phone number is +237000000xxx, so nothing here can reach a real person.
// Fixed identifiers are the stable keys that make db:seed:dev idempotent; they are not secrets.
import type {
  CategoryCode,
  IncidentStatus,
  Language,
  OrganizationType,
  SeverityAnswers,
  SubscriptionPlan,
  UserRole,
} from '@secure360/shared';

export type DevOrgKey = 'sfc' | 'kamdem' | 'administration' | 'ong' | 'logistics';
export type DevUserKey =
  'jeanPaul' | 'rodrigue' | 'aime' | 'paul' | 'christelle' | 'mireille' | 'herve';

export interface DevOrganization {
  key: DevOrgKey;
  id: string;
  name: string;
  type: OrganizationType;
  sector: string;
  city: string;
  contactEmail: string;
  subscriptionPlan: SubscriptionPlan;
}

export interface DevUser {
  key: DevUserKey;
  id: string;
  org: DevOrgKey;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  preferredLanguage: Language;
}

// Messages from Jean-Paul (staff), posted when he takes the incident.
export interface DevMessage {
  body: string;
  isInternal: boolean;
}

export interface DevIncident {
  id: string;
  clientRequestId: string;
  reporter: DevUserKey;
  categoryCode: CategoryCode;
  title: string;
  description: string;
  answers: SeverityAnswers;
  isAnonymous: boolean;
  status: IncidentStatus;
  location?: string;
  deviceAffected?: string;
  resolutionNotes?: string;
  staffMessages?: DevMessage[];
}

export const DEV_ORGANIZATIONS: DevOrganization[] = [
  {
    key: 'sfc',
    id: 'd0000000-0000-4000-8000-000000000001',
    name: 'Security First Cameroon',
    type: 'PROVIDER',
    sector: 'Cybersécurité',
    city: 'Douala',
    contactEmail: 'contact.sfc@example.com',
    subscriptionPlan: 'PREMIUM',
  },
  {
    key: 'kamdem',
    id: 'd0000000-0000-4000-8000-000000000002',
    name: 'Kamdem Distribution SARL',
    type: 'COMPANY',
    sector: 'Distribution',
    city: 'Douala',
    contactEmail: 'contact.kamdem@example.com',
    subscriptionPlan: 'STANDARD',
  },
  {
    key: 'administration',
    id: 'd0000000-0000-4000-8000-000000000003',
    name: 'Direction Fictive des Services Numériques',
    type: 'ADMINISTRATION',
    sector: 'Administration publique',
    city: 'Yaoundé',
    contactEmail: 'contact.administration@example.com',
    subscriptionPlan: 'PREMIUM',
  },
  {
    key: 'ong',
    id: 'd0000000-0000-4000-8000-000000000004',
    name: 'ONG Santé Pour Tous',
    type: 'NGO',
    sector: 'Santé',
    city: 'Bafoussam',
    contactEmail: 'contact.ong@example.com',
    subscriptionPlan: 'BASIC',
  },
  {
    key: 'logistics',
    id: 'd0000000-0000-4000-8000-000000000005',
    name: 'Douala Logistics SARL',
    type: 'COMPANY',
    sector: 'Transport et logistique',
    city: 'Douala',
    contactEmail: 'contact.logistics@example.com',
    subscriptionPlan: 'STANDARD',
  },
];

export const DEV_USERS: DevUser[] = [
  {
    key: 'jeanPaul',
    id: 'd1000000-0000-4000-8000-000000000001',
    org: 'sfc',
    firstName: 'Jean-Paul',
    lastName: 'Nguemo',
    email: 'jean-paul.nguemo@example.com',
    phone: '+237000000001',
    role: 'TECHNICIAN',
    preferredLanguage: 'fr',
  },
  {
    key: 'rodrigue',
    id: 'd1000000-0000-4000-8000-000000000002',
    org: 'sfc',
    firstName: 'Rodrigue',
    lastName: 'Essomba',
    email: 'rodrigue.essomba@example.com',
    phone: '+237000000002',
    role: 'ADMIN',
    preferredLanguage: 'fr',
  },
  {
    key: 'aime',
    id: 'd1000000-0000-4000-8000-000000000101',
    org: 'kamdem',
    firstName: 'Aimé',
    lastName: 'Kamga',
    email: 'aime.kamga@example.com',
    phone: '+237000000101',
    role: 'USER',
    preferredLanguage: 'fr',
  },
  {
    key: 'paul',
    id: 'd1000000-0000-4000-8000-000000000102',
    org: 'kamdem',
    firstName: 'Paul',
    lastName: 'Ndoumou',
    email: 'paul.ndoumou@example.com',
    phone: '+237000000102',
    role: 'MANAGER',
    preferredLanguage: 'fr',
  },
  {
    key: 'christelle',
    id: 'd1000000-0000-4000-8000-000000000201',
    org: 'administration',
    firstName: 'Christelle',
    lastName: 'Biya',
    email: 'christelle.biya@example.com',
    phone: '+237000000201',
    role: 'MANAGER',
    preferredLanguage: 'fr',
  },
  {
    key: 'mireille',
    id: 'd1000000-0000-4000-8000-000000000301',
    org: 'ong',
    firstName: 'Mireille',
    lastName: 'Fotso',
    email: 'mireille.fotso@example.com',
    phone: '+237000000301',
    role: 'USER',
    preferredLanguage: 'fr',
  },
  {
    key: 'herve',
    id: 'd1000000-0000-4000-8000-000000000401',
    org: 'logistics',
    firstName: 'Hervé',
    lastName: 'Tchinda',
    email: 'herve.tchinda@example.com',
    phone: '+237000000401',
    role: 'USER',
    // One English speaker, so both languages are exercised.
    preferredLanguage: 'en',
  },
];

// One incident per status, across six category groups. Statuses beyond NEW are reached through Jean-Paul's
// actions, as the API will do it.
export const DEV_INCIDENTS: DevIncident[] = [
  {
    id: 'd2000000-0000-4000-8000-000000000001',
    clientRequestId: 'd3000000-0000-4000-8000-000000000001',
    reporter: 'aime',
    categoryCode: 'FRD-03',
    title: 'Retrait Mobile Money non autorisé',
    description:
      'Un faux agent m’a appelé et m’a demandé le code reçu par SMS. Juste après, 150 000 FCFA ont été retirés de mon compte.',
    answers: { moneyLost: 'yes', sharedSecret: 'yes', othersAffected: 'no' },
    // Confidential report (L1 D1): Paul, his manager, must never see who reported it.
    isAnonymous: true,
    status: 'ASSIGNED',
    deviceAffected: 'Téléphone Android personnel',
    staffMessages: [
      {
        body: 'Merci pour votre signalement. Appelez tout de suite le service client de votre opérateur pour bloquer le compte, puis changez votre code secret.',
        isInternal: false,
      },
      {
        body: 'Schéma connu de faux agent. Vérifier si d’autres employés de Kamdem ont reçu le même appel.',
        isInternal: true,
      },
    ],
  },
  {
    id: 'd2000000-0000-4000-8000-000000000002',
    clientRequestId: 'd3000000-0000-4000-8000-000000000002',
    reporter: 'aime',
    categoryCode: 'MSG-01',
    title: 'E-mail demandant de confirmer mon mot de passe',
    description:
      'J’ai reçu un e-mail qui ressemble à celui de notre messagerie et j’ai cliqué sur le lien.',
    answers: { moneyLost: 'no', sharedSecret: 'yes', othersAffected: 'no' },
    isAnonymous: false,
    status: 'RESOLVED',
    resolutionNotes:
      'Mot de passe réinitialisé, domaine frauduleux bloqué sur la passerelle de messagerie.',
  },
  {
    id: 'd2000000-0000-4000-8000-000000000003',
    clientRequestId: 'd3000000-0000-4000-8000-000000000003',
    reporter: 'paul',
    categoryCode: 'MOB-02',
    title: 'Plus de réseau sur mon téléphone depuis ce matin',
    description: 'Mon téléphone affiche « Aucun service » alors que mes collègues ont du réseau.',
    answers: { moneyLost: 'unknown', sharedSecret: 'no', othersAffected: 'no' },
    isAnonymous: false,
    status: 'IN_PROGRESS',
    location: 'Douala, Akwa',
  },
  {
    id: 'd2000000-0000-4000-8000-000000000004',
    clientRequestId: 'd3000000-0000-4000-8000-000000000004',
    reporter: 'christelle',
    categoryCode: 'WKS-03',
    title: 'Fichiers du service courrier chiffrés',
    description:
      'Les fichiers du partage réseau du service courrier ont une nouvelle extension et ne s’ouvrent plus.',
    answers: { moneyLost: 'no', sharedSecret: 'unknown', othersAffected: 'yes' },
    isAnonymous: false,
    status: 'NEW',
    location: 'Yaoundé, bâtiment B',
  },
  {
    id: 'd2000000-0000-4000-8000-000000000005',
    clientRequestId: 'd3000000-0000-4000-8000-000000000005',
    reporter: 'mireille',
    categoryCode: 'ACC-01',
    title: 'Alerte de connexion depuis un autre pays',
    description: 'J’ai reçu une alerte de connexion à ma messagerie depuis un appareil inconnu.',
    answers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'no' },
    isAnonymous: false,
    status: 'CLOSED',
    resolutionNotes: 'Session révoquée, double authentification activée sur le compte.',
  },
  {
    id: 'd2000000-0000-4000-8000-000000000006',
    clientRequestId: 'd3000000-0000-4000-8000-000000000006',
    reporter: 'herve',
    categoryCode: 'AVL-02',
    title: 'Site web de suivi des colis inaccessible',
    description: 'Les clients ne peuvent plus suivre leurs colis sur notre site depuis 8 h.',
    answers: { moneyLost: 'no', sharedSecret: 'no', othersAffected: 'yes' },
    isAnonymous: false,
    status: 'NEW',
  },
];
