import { describe, expect, it } from 'vitest';
import {
  CATEGORY_GROUPS,
  en,
  fr,
  INCIDENT_STATUSES,
  SEVERITIES,
  sharedMessages,
  type SharedMessages,
} from '../src/index.js';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('shared i18n', () => {
  it('has the same key set in fr and en', () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(fr).sort());
  });

  const displayed = (locale: SharedMessages) =>
    keyPaths(locale).map((path) => ({
      path,
      text: path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], locale),
    }));

  it('has no empty string', () => {
    for (const locale of [fr, en]) {
      for (const { path, text } of displayed(locale)) {
        expect(typeof text === 'string' && text.trim().length > 0, path).toBe(true);
      }
    }
  });

  it('uses the typographic apostrophe (U+2019), never a straight one, in displayed strings', () => {
    for (const locale of [fr, en]) {
      for (const { path, text } of displayed(locale)) {
        expect(String(text).includes("'"), `${path}: ${String(text)}`).toBe(false);
      }
    }
    expect(fr.categories['MSG-01']).toBe('E-mail d’hameçonnage reçu');
    expect(en.categories['AVL-02']).toBe('Organisation’s website inaccessible');
  });

  it('has a reporter label and hint for every group, and keeps the formal group labels', () => {
    for (const locale of [fr, en]) {
      expect(Object.keys(locale.groups)).toEqual([...CATEGORY_GROUPS]);
      expect(Object.keys(locale.groupsReporter)).toEqual([...CATEGORY_GROUPS]);
      expect(Object.keys(locale.groupsReporterHint)).toEqual([...CATEGORY_GROUPS]);
    }
    expect(fr.groups.MOBILE).toBe('Incidents mobiles');
    expect(fr.groupsReporter.MOBILE).toBe('Mon téléphone');
    expect(en.groupsReporter.ACCESS_IDENTITY).toBe('My accounts & passwords');
    expect(fr.groupsReporterHint.MOBILE).toBe(
      'Plus de réseau (SIM swap), appli ou appel suspect, QR code',
    );
    expect(en.groupsReporterHint.OTHER).toBe('Describe it in your own words');
  });

  it('displays severities as Low/Moderate/High/Critical and Faible/Modérée/Élevée/Critique', () => {
    expect(Object.keys(en.severities)).toEqual([...SEVERITIES]);
    expect(Object.values(en.severities)).toEqual(['Low', 'Moderate', 'High', 'Critical']);
    expect(Object.values(fr.severities)).toEqual(['Faible', 'Modérée', 'Élevée', 'Critique']);
  });

  it('labels every status for staff and for reporters', () => {
    for (const locale of [fr, en]) {
      expect(Object.keys(locale.statuses)).toEqual([...INCIDENT_STATUSES]);
      expect(Object.keys(locale.statusesReporter)).toEqual([...INCIDENT_STATUSES]);
    }
  });

  it('uses the staff status wording', () => {
    expect(Object.values(en.statuses)).toEqual([
      'New',
      'Assigned',
      'In progress',
      'Resolved',
      'Closed',
    ]);
    expect(Object.values(fr.statuses)).toEqual([
      'Nouveau',
      'Assigné',
      'En cours',
      'Résolu',
      'Clôturé',
    ]);
  });

  it('uses the reporter status wording of L3', () => {
    expect(Object.values(en.statusesReporter)).toEqual([
      'Received',
      'Assigned',
      'In progress',
      'Resolved',
      'Closed',
    ]);
    expect(Object.values(fr.statusesReporter)).toEqual([
      'Reçu',
      'Pris en charge',
      'En cours',
      'Résolu',
      'Clôturé',
    ]);
  });

  it('exposes both locales, French first', () => {
    expect(Object.keys(sharedMessages)).toEqual(['fr', 'en']);
  });

  it('rejects a locale with a missing or extra key at compile time', () => {
    // @ts-expect-error: missing every key except groups
    const missing: SharedMessages = { groups: en.groups };
    // @ts-expect-error: extra top-level key
    const extra: SharedMessages = { ...en, unexpected: 'x' } satisfies SharedMessages;
    expect(missing).toBeDefined();
    expect(extra).toBeDefined();
  });
});
