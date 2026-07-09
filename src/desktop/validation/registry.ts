import { validationRules } from './rules/rules.js';
import type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
  ValidationRule,
} from './types.js';

const allRules: ValidationRule[] = validationRules;

export function runValidation(
  xml: string,
  context: ValidationContext,
  rules = allRules,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    if (rule.contexts.includes(context)) {
      try {
        issues.push(...rule.validate(xml));
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
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}
