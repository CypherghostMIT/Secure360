import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  computeSeverity,
  getDefaultSeverity,
  resolveInitialSeverity,
  SEVERITIES,
  type GuidedAnswer,
  type Severity,
  type SeverityAnswers,
} from '../src/index.js';

const answers = (
  moneyLost: GuidedAnswer,
  sharedSecret: GuidedAnswer,
  othersAffected: GuidedAnswer,
): SeverityAnswers => ({ moneyLost, sharedSecret, othersAffected });

const NONE = answers('no', 'no', 'no');

describe('computeSeverity (L1 §7.3)', () => {
  it('returns the category default when every answer is "no"', () => {
    for (const s of SEVERITIES) expect(computeSeverity(s, NONE)).toBe(s);
  });

  it('treats "unknown" as "no"', () => {
    const allUnknown = answers('unknown', 'unknown', 'unknown');
    for (const s of SEVERITIES) expect(computeSeverity(s, allUnknown)).toBe(s);
    expect(computeSeverity('LOW', answers('unknown', 'yes', 'unknown'))).toBe('MEDIUM');
  });

  it.each<[Severity, Severity]>([
    ['LOW', 'MEDIUM'],
    ['MEDIUM', 'HIGH'],
    ['HIGH', 'CRITICAL'],
    ['CRITICAL', 'CRITICAL'],
  ])('one "yes" (Q2 or Q3) raises %s to %s', (from, to) => {
    expect(computeSeverity(from, answers('no', 'yes', 'no'))).toBe(to);
    expect(computeSeverity(from, answers('no', 'no', 'yes'))).toBe(to);
  });

  it('raises one level per "yes"', () => {
    expect(computeSeverity('LOW', answers('no', 'yes', 'yes'))).toBe('HIGH');
    expect(computeSeverity('LOW', answers('yes', 'yes', 'yes'))).toBe('CRITICAL');
  });

  it('caps at CRITICAL', () => {
    expect(computeSeverity('MEDIUM', answers('yes', 'yes', 'yes'))).toBe('CRITICAL');
    expect(computeSeverity('HIGH', answers('no', 'yes', 'yes'))).toBe('CRITICAL');
    expect(computeSeverity('CRITICAL', answers('yes', 'yes', 'yes'))).toBe('CRITICAL');
  });

  it('makes Q1 "yes" at least HIGH', () => {
    expect(computeSeverity('LOW', answers('yes', 'no', 'no'))).toBe('HIGH');
    expect(computeSeverity('MEDIUM', answers('yes', 'no', 'no'))).toBe('HIGH');
    expect(computeSeverity('HIGH', answers('yes', 'no', 'no'))).toBe('CRITICAL');
    // Floor and step combine: LOW + 2 steps = HIGH, which already meets the floor.
    expect(computeSeverity('LOW', answers('yes', 'yes', 'no'))).toBe('HIGH');
  });

  it('does not apply the HIGH floor when Q1 is "unknown"', () => {
    expect(computeSeverity('LOW', answers('unknown', 'no', 'no'))).toBe('LOW');
  });

  it('reproduces the two worked examples of L1 §7.3', () => {
    // Phishing e-mail (MEDIUM) where the user clicked the link becomes HIGH.
    expect(computeSeverity(getDefaultSeverity('MSG-01'), answers('no', 'yes', 'no'))).toBe('HIGH');
    // Mobile Money fraud (HIGH) with money lost becomes CRITICAL.
    expect(computeSeverity(getDefaultSeverity('FRD-03'), answers('yes', 'no', 'no'))).toBe(
      'CRITICAL',
    );
  });

  it('never returns a level below the category default, for every category and answer combination', () => {
    const values: GuidedAnswer[] = ['yes', 'no', 'unknown'];
    for (const c of CATEGORIES) {
      for (const q1 of values)
        for (const q2 of values)
          for (const q3 of values) {
            const result = computeSeverity(c.defaultSeverity, answers(q1, q2, q3));
            expect(SEVERITIES.indexOf(result)).toBeGreaterThanOrEqual(
              SEVERITIES.indexOf(c.defaultSeverity),
            );
          }
    }
  });
});

describe('resolveInitialSeverity (L1 D3 with L2 §8.3)', () => {
  it('returns the computed value when the reporter gives none', () => {
    for (const s of SEVERITIES) expect(resolveInitialSeverity(s)).toBe(s);
  });

  it('lets the reporter raise the level', () => {
    expect(resolveInitialSeverity('LOW', 'MEDIUM')).toBe('MEDIUM');
    expect(resolveInitialSeverity('MEDIUM', 'CRITICAL')).toBe('CRITICAL');
    expect(resolveInitialSeverity('HIGH', 'CRITICAL')).toBe('CRITICAL');
  });

  it('never lets the reporter lower the level, for every pair', () => {
    for (const computed of SEVERITIES) {
      for (const reporter of SEVERITIES) {
        const result = resolveInitialSeverity(computed, reporter);
        const expected =
          SEVERITIES.indexOf(reporter) > SEVERITIES.indexOf(computed) ? reporter : computed;
        expect(result).toBe(expected);
        expect(SEVERITIES.indexOf(result)).toBeGreaterThanOrEqual(SEVERITIES.indexOf(computed));
      }
    }
    expect(resolveInitialSeverity('CRITICAL', 'LOW')).toBe('CRITICAL');
    expect(resolveInitialSeverity('HIGH', 'HIGH')).toBe('HIGH');
  });

  it('combines with computeSeverity: a phishing click (HIGH) cannot be lowered to LOW', () => {
    const computed = computeSeverity(getDefaultSeverity('MSG-01'), answers('no', 'yes', 'no'));
    expect(resolveInitialSeverity(computed, 'LOW')).toBe('HIGH');
  });
});
