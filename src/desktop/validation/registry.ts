import { validationRules } from './rules/rules.js';
import type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
  ValidationRule,
} from './types.js';

const allRules: ValidationRule[] = validationRules;

type ContextAwareValidationRule = ValidationRule & {
  validate(xml: string, context?: ValidationContext): ValidationIssue[];
};

/** Error-severity findings are the only findings allowed to block an apply. */
export function blockingValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
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
