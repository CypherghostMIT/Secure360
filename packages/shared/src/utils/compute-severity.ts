import { SEVERITIES } from '../constants/severities.js';
import type { Severity, SeverityAnswers } from '../types/index.js';

const HIGH_INDEX = SEVERITIES.indexOf('HIGH');
const MAX_INDEX = SEVERITIES.length - 1;

// Category defaults come from the database at runtime, where the type system cannot vouch for them.
// An unknown value must stop the request, never silently become LOW or undefined (security review M1).
function severityIndex(value: unknown, name: string): number {
  const index = SEVERITIES.indexOf(value as Severity);
  if (index < 0) throw new RangeError(`Invalid ${name}: ${String(value)}`);
  return index;
}

/**
 * Guided severity, L1 §7.3 (Decision D3).
 * Each "yes" raises one level (capped at CRITICAL); a "yes" to Q1 (money lost) means at least HIGH;
 * "unknown" counts as "no" here and is kept in the answers so the analyst still sees it.
 * The server always recomputes this; the mobile value is a preview only (L2 §8.3).
 * @throws RangeError if categoryDefault is not a severity.
 */
export function computeSeverity(categoryDefault: Severity, answers: SeverityAnswers): Severity {
  const yesCount = [answers.moneyLost, answers.sharedSecret, answers.othersAffected].filter(
    (answer) => answer === 'yes',
  ).length;
  let index = Math.min(severityIndex(categoryDefault, 'categoryDefault') + yesCount, MAX_INDEX);
  if (answers.moneyLost === 'yes') index = Math.max(index, HIGH_INDEX);
  // In bounds: severityIndex is >= 0 and the sum is clamped to MAX_INDEX.
  return SEVERITIES[index] as Severity;
}

/**
 * Initial severity stored on the incident (L1 D3 with L2 §8.3): the reporter may raise the computed level,
 * never lower it. The server stores both `computed` and this result, so the analyst sees any raise.
 * @throws RangeError if computed, or a supplied reporterSeverity, is not a severity.
 */
export function resolveInitialSeverity(computed: Severity, reporterSeverity?: Severity): Severity {
  const computedIndex = severityIndex(computed, 'computed');
  if (reporterSeverity === undefined) return computed;
  return severityIndex(reporterSeverity, 'reporterSeverity') > computedIndex
    ? reporterSeverity
    : computed;
}
