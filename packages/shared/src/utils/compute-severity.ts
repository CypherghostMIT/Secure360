import { SEVERITIES } from '../constants/severities.js';
import type { Severity, SeverityAnswers } from '../types/index.js';

const HIGH_INDEX = SEVERITIES.indexOf('HIGH');
const MAX_INDEX = SEVERITIES.length - 1;

/**
 * Guided severity, L1 §7.3 (Decision D3).
 * Each "yes" raises one level (capped at CRITICAL); a "yes" to Q1 (money lost) means at least HIGH;
 * "unknown" counts as "no" here and is kept in the answers so the analyst still sees it.
 * The server always recomputes this; the mobile value is a preview only (L2 §8.3).
 */
export function computeSeverity(categoryDefault: Severity, answers: SeverityAnswers): Severity {
  const yesCount = [answers.moneyLost, answers.sharedSecret, answers.othersAffected].filter(
    (answer) => answer === 'yes',
  ).length;
  let index = Math.min(SEVERITIES.indexOf(categoryDefault) + yesCount, MAX_INDEX);
  if (answers.moneyLost === 'yes') index = Math.max(index, HIGH_INDEX);
  // Always in bounds: clamped above, and indexOf of a valid Severity is >= 0.
  return SEVERITIES[index] as Severity;
}

/**
 * Initial severity stored on the incident (L1 D3 with L2 §8.3): the reporter may raise the computed level,
 * never lower it. The server stores both `computed` and this result, so the analyst sees any raise.
 */
export function resolveInitialSeverity(computed: Severity, reporterSeverity?: Severity): Severity {
  if (reporterSeverity === undefined) return computed;
  return SEVERITIES.indexOf(reporterSeverity) > SEVERITIES.indexOf(computed)
    ? reporterSeverity
    : computed;
}
