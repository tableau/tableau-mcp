import { parseXmlResult, unparseableXmlIssue } from './rules/parseXml.js';
import { validationRules } from './rules/rules.js';
import { wellFormedXmlRule } from './rules/wellFormedXml.js';
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
  // Fail closed on a document that will not parse. Every parse-based rule reads an
  // unparseable document as "nothing to report", so without this a single unclosed tag
  // turned the whole rule set off and returned valid:true.
  const parsed = parseXmlResult(xml);
  if (!parsed.ok) {
    const issues = wellFormedXmlRule.validate(xml);
    return {
      valid: false,
      issues:
        issues.length > 0 ? issues : [unparseableXmlIssue(wellFormedXmlRule.id, parsed.message)],
    };
  }

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
