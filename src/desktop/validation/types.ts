/**
 * Shared types for the semantic XML validation framework.
 *
 * Rules are pure functions: XML string in, ValidationIssue[] out.
 * The runner aggregates issues from all registered rules into a
 * single ValidationResult consumed by apply paths and failure capture.
 */

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  /** XPath-like location hint within the XML, if available */
  xpath?: string;
  /** Suggested remediation shown in logs / error messages */
  suggestion?: string;
}

export interface ValidationResult {
  /** true when no error-severity issues exist (warnings and info don't block) */
  valid: boolean;
  issues: ValidationIssue[];
}

/** Which apply context the rule should run in */
export type ValidationContext = 'workbook' | 'worksheet' | 'datasource' | 'dashboard';

export interface ValidationRule {
  id: string;
  description: string;
  /** Rule runs only when the apply context matches one of these values */
  contexts: ValidationContext[];
  validate(xml: string): ValidationIssue[];
}
