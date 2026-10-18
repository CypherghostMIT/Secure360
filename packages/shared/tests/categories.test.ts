import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_CODES,
  CATEGORY_GROUPS,
  CategoryCodeSchema,
  en,
  fr,
  getDefaultSeverity,
  SEVERITIES,
  type CategoryCode,
} from '../src/index.js';

// L1 Table 12, transcribed independently of src/ so a typo in either copy fails the test.
const L1_TABLE_12: Record<string, string> = {
  'MSG-01': 'MEDIUM',
  'MSG-02': 'HIGH',
  'MSG-03': 'MEDIUM',
  'MSG-04': 'MEDIUM',
  'WKS-01': 'MEDIUM',
  'WKS-02': 'HIGH',
  'WKS-03': 'CRITICAL',
  'WKS-04': 'MEDIUM',
  'WKS-05': 'LOW',
  'ACC-01': 'MEDIUM',
  'ACC-02': 'HIGH',
  'ACC-03': 'HIGH',
  'ACC-04': 'HIGH',
  'ACC-05': 'MEDIUM',
  'NET-01': 'LOW',
  'NET-02': 'LOW',
  'NET-03': 'MEDIUM',
  'NET-04': 'HIGH',
  'FRD-01': 'MEDIUM',
  'FRD-02': 'MEDIUM',
  'FRD-03': 'HIGH',
  'FRD-04': 'HIGH',
  'MOB-01': 'HIGH',
  'MOB-02': 'CRITICAL',
  'MOB-03': 'MEDIUM',
  'MOB-04': 'MEDIUM',
  'PHY-01': 'HIGH',
  'PHY-02': 'HIGH',
  'PHY-03': 'MEDIUM',
  'PHY-04': 'MEDIUM',
  'AVL-01': 'MEDIUM',
  'AVL-02': 'MEDIUM',
  'AVL-03': 'HIGH',
  'OTH-01': 'MEDIUM',
};

const GROUP_PREFIX: Record<string, string> = {
  MESSAGING_PHISHING: 'MSG',
  WORKSTATION: 'WKS',
  ACCESS_IDENTITY: 'ACC',
  NETWORK: 'NET',
  DIGITAL_FRAUD: 'FRD',
  MOBILE: 'MOB',
  PHYSICAL: 'PHY',
  AVAILABILITY: 'AVL',
  OTHER: 'OTH',
};

// English column of L1 Table 12; the only deliberate change is the typographic apostrophe in AVL-02.
const L1_TABLE_12_EN: Record<string, string> = {
  'MSG-01': 'Phishing email received',
  'MSG-02': 'Fraudulent email impersonating SFC',
  'MSG-03': 'Suspicious attachment received by email',
  'MSG-04': 'Fraudulent SMS (smishing)',
  'WKS-01': 'Abnormal computer behaviour',
  'WKS-02': 'Virus / malware detected',
  'WKS-03': 'Ransomware / encrypted files',
  'WKS-04': 'Unknown software installed without authorisation',
  'WKS-05': 'Unusual system slowdown',
  'ACC-01': 'Suspicious login attempt on my account',
  'ACC-02': 'Compromised or stolen password',
  'ACC-03': 'Unauthorised access to my data',
  'ACC-04': 'Blocked or hacked account',
  'ACC-05': 'Suspicious request for my credentials',
  'NET-01': 'Abnormally slow Internet connection',
  'NET-02': 'Access to blocked website',
  'NET-03': 'Suspicious Wi-Fi network detected',
  'NET-04': 'Abnormal network traffic observed',
  'FRD-01': 'Online scam attempt (fraud)',
  'FRD-02': 'Fake website imitating an official service',
  'FRD-03': 'Mobile Money fraud (Orange Money, MTN MoMo)',
  'FRD-04': 'Digital identity theft',
  'MOB-01': 'Suspicious mobile application installed',
  'MOB-02': 'Sudden loss of mobile network / suspected SIM swap',
  'MOB-03': 'Suspicious call asking for information',
  'MOB-04': 'Suspicious QR code scanned',
  'PHY-01': 'Loss or theft of IT equipment',
  'PHY-02': 'Unauthorised physical access to the server room',
  'PHY-03': 'Confidential document found without protection',
  'PHY-04': 'Suspicious behaviour of a third party on the premises',
  'AVL-01': 'Service or application unavailable',
  'AVL-02': 'Organisation’s website inaccessible',
  'AVL-03': 'Server down or inaccessible',
  'OTH-01': 'Other incident not listed (free description)',
};

describe('incident taxonomy (L1 Table 12)', () => {
  it('uses the English labels of L1 Table 12 exactly', () => {
    expect(en.categories).toEqual(L1_TABLE_12_EN);
  });

  it('has exactly 9 groups and 34 categories', () => {
    expect(CATEGORY_GROUPS).toHaveLength(9);
    expect(new Set(CATEGORY_GROUPS).size).toBe(9);
    expect(CATEGORIES).toHaveLength(34);
  });

  it('has unique codes in the XXX-NN format', () => {
    expect(new Set(CATEGORY_CODES).size).toBe(34);
    for (const code of CATEGORY_CODES) expect(code).toMatch(/^[A-Z]{3}-\d{2}$/);
  });

  it('matches every code and default severity of L1 Table 12', () => {
    const actual = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.defaultSeverity]));
    expect(actual).toEqual(L1_TABLE_12);
  });

  it('puts every category in the group of its code prefix, and every group is used', () => {
    for (const c of CATEGORIES) expect(c.code.slice(0, 3)).toBe(GROUP_PREFIX[c.group]);
    expect(new Set(CATEGORIES.map((c) => c.group))).toEqual(new Set(CATEGORY_GROUPS));
  });

  it('uses only valid severities', () => {
    for (const c of CATEGORIES) expect(SEVERITIES).toContain(c.defaultSeverity);
  });

  it('defines MOB-02 as SIM swap, CRITICAL, and has a single SMS category (D2)', () => {
    expect(getDefaultSeverity('MOB-02')).toBe('CRITICAL');
    expect(en.categories['MOB-02']).toBe('Sudden loss of mobile network / suspected SIM swap');
    expect(fr.categories['MOB-02']).toBe('Perte soudaine du réseau mobile / suspicion de SIM swap');
    const smsLabels = Object.values(en.categories).filter((label) => /\bSMS\b/.test(label));
    expect(smsLabels).toEqual(['Fraudulent SMS (smishing)']);
  });

  it('has a non-empty fr and en label for every group and category, and no extra ones', () => {
    for (const locale of [fr, en]) {
      expect(Object.keys(locale.categories).sort()).toEqual([...CATEGORY_CODES].sort());
      expect(Object.keys(locale.groups).sort()).toEqual([...CATEGORY_GROUPS].sort());
      for (const label of [...Object.values(locale.categories), ...Object.values(locale.groups)]) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('validates category codes', () => {
    expect(CategoryCodeSchema.safeParse('OTH-01').success).toBe(true);
    expect(CategoryCodeSchema.safeParse('MOB-05').success).toBe(false);
    expect(CategoryCodeSchema.safeParse('msg-01').success).toBe(false);
  });

  it('rejects an unknown code in getDefaultSeverity', () => {
    expect(() => getDefaultSeverity('XXX-99' as CategoryCode)).toThrow(RangeError);
  });
});
