import { z } from 'zod';
import type { SEVERITIES } from './severities.js';

type Severity = (typeof SEVERITIES)[number];

// L1 Table 12 (9 groups, 34 categories, correction D2). Codes are stable database identifiers (L1 §7.2);
// labels live in i18n under groups.<GROUP> and categories.<CODE>.
export const CATEGORY_GROUPS = [
  'MESSAGING_PHISHING',
  'WORKSTATION',
  'ACCESS_IDENTITY',
  'NETWORK',
  'DIGITAL_FRAUD',
  'MOBILE',
  'PHYSICAL',
  'AVAILABILITY',
  'OTHER',
] as const;

type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORIES = [
  { code: 'MSG-01', group: 'MESSAGING_PHISHING', defaultSeverity: 'MEDIUM' },
  { code: 'MSG-02', group: 'MESSAGING_PHISHING', defaultSeverity: 'HIGH' },
  { code: 'MSG-03', group: 'MESSAGING_PHISHING', defaultSeverity: 'MEDIUM' },
  { code: 'MSG-04', group: 'MESSAGING_PHISHING', defaultSeverity: 'MEDIUM' },
  { code: 'WKS-01', group: 'WORKSTATION', defaultSeverity: 'MEDIUM' },
  { code: 'WKS-02', group: 'WORKSTATION', defaultSeverity: 'HIGH' },
  { code: 'WKS-03', group: 'WORKSTATION', defaultSeverity: 'CRITICAL' },
  { code: 'WKS-04', group: 'WORKSTATION', defaultSeverity: 'MEDIUM' },
  { code: 'WKS-05', group: 'WORKSTATION', defaultSeverity: 'LOW' },
  { code: 'ACC-01', group: 'ACCESS_IDENTITY', defaultSeverity: 'MEDIUM' },
  { code: 'ACC-02', group: 'ACCESS_IDENTITY', defaultSeverity: 'HIGH' },
  { code: 'ACC-03', group: 'ACCESS_IDENTITY', defaultSeverity: 'HIGH' },
  { code: 'ACC-04', group: 'ACCESS_IDENTITY', defaultSeverity: 'HIGH' },
  { code: 'ACC-05', group: 'ACCESS_IDENTITY', defaultSeverity: 'MEDIUM' },
  { code: 'NET-01', group: 'NETWORK', defaultSeverity: 'LOW' },
  { code: 'NET-02', group: 'NETWORK', defaultSeverity: 'LOW' },
  { code: 'NET-03', group: 'NETWORK', defaultSeverity: 'MEDIUM' },
  { code: 'NET-04', group: 'NETWORK', defaultSeverity: 'HIGH' },
  { code: 'FRD-01', group: 'DIGITAL_FRAUD', defaultSeverity: 'MEDIUM' },
  { code: 'FRD-02', group: 'DIGITAL_FRAUD', defaultSeverity: 'MEDIUM' },
  { code: 'FRD-03', group: 'DIGITAL_FRAUD', defaultSeverity: 'HIGH' },
  { code: 'FRD-04', group: 'DIGITAL_FRAUD', defaultSeverity: 'HIGH' },
  { code: 'MOB-01', group: 'MOBILE', defaultSeverity: 'HIGH' },
  // D2: SIM swap takes the code freed by the duplicate SMS category; CRITICAL because the damage window is minutes.
  { code: 'MOB-02', group: 'MOBILE', defaultSeverity: 'CRITICAL' },
  { code: 'MOB-03', group: 'MOBILE', defaultSeverity: 'MEDIUM' },
  { code: 'MOB-04', group: 'MOBILE', defaultSeverity: 'MEDIUM' },
  { code: 'PHY-01', group: 'PHYSICAL', defaultSeverity: 'HIGH' },
  { code: 'PHY-02', group: 'PHYSICAL', defaultSeverity: 'HIGH' },
  { code: 'PHY-03', group: 'PHYSICAL', defaultSeverity: 'MEDIUM' },
  { code: 'PHY-04', group: 'PHYSICAL', defaultSeverity: 'MEDIUM' },
  { code: 'AVL-01', group: 'AVAILABILITY', defaultSeverity: 'MEDIUM' },
  { code: 'AVL-02', group: 'AVAILABILITY', defaultSeverity: 'MEDIUM' },
  { code: 'AVL-03', group: 'AVAILABILITY', defaultSeverity: 'HIGH' },
  { code: 'OTH-01', group: 'OTHER', defaultSeverity: 'MEDIUM' },
] as const satisfies readonly { code: string; group: CategoryGroup; defaultSeverity: Severity }[];

type CategoryCode = (typeof CATEGORIES)[number]['code'];

export const CATEGORY_CODES = CATEGORIES.map((c) => c.code) as [CategoryCode, ...CategoryCode[]];

export const CategoryCodeSchema = z.enum(CATEGORY_CODES);
export const CategoryGroupSchema = z.enum(CATEGORY_GROUPS);

// Built-in defaults. At runtime the API reads incident_categories, where SFC can tune them (L1 §7).
export function getDefaultSeverity(code: CategoryCode): Severity {
  const category = CATEGORIES.find((c) => c.code === code);
  if (!category) throw new RangeError(`Unknown category code: ${String(code)}`);
  return category.defaultSeverity;
}
