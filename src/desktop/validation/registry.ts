import { validationRules } from './rules/rules.js';
import type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
  ValidationRule,
} from './types.js';

const allRules: ValidationRule[] = validationRules;

// Known crash-producing XML must be repaired before any write, even when the same
// defect exists in the live baseline or a deterministic caller skips ordinary checks.
const alwaysBlockingRuleIds = new Set(['dashboard-worksheet-zone-type']);

type ContextAwareValidationRule = ValidationRule & {
  validate(xml: string, context?: ValidationContext): ValidationIssue[];
};

/** Error-severity findings are the only findings allowed to block an apply. */
export function blockingValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

export function alwaysBlockingValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return blockingValidationIssues(issues).filter((issue) =>
    alwaysBlockingRuleIds.has(issue.ruleId),
  );
}

export function runAlwaysBlockingValidation(
  xml: string,
  context: ValidationContext,
): ValidationResult {
  return runValidation(
    xml,
    context,
    allRules.filter((rule) => alwaysBlockingRuleIds.has(rule.id)),
  );
}

/** Baseline comparison never waives the known crash hazards selected above. */
export function introducedBlockingValidationIssues(
  baselineIssues: ValidationIssue[],
  candidateIssues: ValidationIssue[],
): ValidationIssue[] {
  const baselineCounts = new Map<string, number>();
  for (const issue of blockingValidationIssues(baselineIssues)) {
    const key = validationIssueKey(issue);
    baselineCounts.set(key, (baselineCounts.get(key) ?? 0) + (issue.occurrenceCount ?? 1));
  }

  return blockingValidationIssues(candidateIssues).filter((issue) => {
    if (alwaysBlockingRuleIds.has(issue.ruleId)) return true;
    const key = validationIssueKey(issue);
    const remaining = baselineCounts.get(key) ?? 0;
    const candidateCount = issue.occurrenceCount ?? 1;
    if (remaining < candidateCount) return true;
    baselineCounts.set(key, remaining - candidateCount);
    return false;
  });
}

function validationIssueKey(issue: ValidationIssue): string {
  return JSON.stringify([issue.ruleId, issue.message, issue.xpath ?? null]);
}

export function runValidation(
  xml: string,
  context: ValidationContext,
  rules = allRules,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    if (rule.contexts.includes(context)) {
      try {
        issues.push(...(rule as ContextAwareValidationRule).validate(xml, context));
      } catch (err) {
        // A broken rule must not crash the apply path.
        issues.push({
          ruleId: rule.id,
          severity: 'warning',
          message: `Rule '${rule.id}' threw an unexpected error: ${String(err)}`,
        });
      }
    }
  }
  return {
    valid: blockingValidationIssues(issues).length === 0,
    issues,
  };
}
