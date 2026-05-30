import { runValidation } from './registry.js';
import type { ValidationRule } from './types.js';

describe('validation framework', () => {
  it('returns valid=true when no issues are emitted', () => {
    const passRule: ValidationRule = {
      id: 'test-pass-rule',
      description: 'Always passes',
      contexts: ['datasource'],
      validate() {
        return [];
      },
    };
    const result = runValidation('<workbook/>', 'datasource', [passRule]);
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('returns valid=false when any issue has severity=error', () => {
    const errorRule: ValidationRule = {
      id: 'test-error-rule',
      description: 'Always emits an error',
      contexts: ['datasource'],
      validate() {
        return [{ ruleId: 'test-error-rule', severity: 'error', message: 'forced error' }];
      },
    };
    const result = runValidation('<workbook/>', 'datasource', [errorRule]);
    expect(result.valid).toBe(false);
    const errors = result.issues.filter(
      (i) => i.severity === 'error' && i.ruleId === 'test-error-rule',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns valid=true when all issues have severity=warning', () => {
    // Register in 'workbook' context so this rule runs in isolation.
    const warnRule: ValidationRule = {
      id: 'test-warn-rule',
      description: 'Always emits a warning',
      contexts: ['workbook'],
      validate() {
        return [{ ruleId: 'test-warn-rule', severity: 'warning', message: 'just a warning' }];
      },
    };
    const result = runValidation('<workbook/>', 'workbook', [warnRule]);
    const warnIssues = result.issues.filter((i) => i.ruleId === 'test-warn-rule');
    expect(warnIssues.length).toBeGreaterThan(0);
    expect(warnIssues.every((i) => i.severity === 'warning')).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('rules only run in their declared contexts', () => {
    const workbookOnlyRule: ValidationRule = {
      id: 'test-workbook-only-rule',
      description: 'Only runs in workbook context',
      contexts: ['workbook'],
      validate() {
        return [
          { ruleId: 'test-workbook-only-rule', severity: 'info', message: 'ran in workbook' },
        ];
      },
    };

    const worksheetResult = runValidation('<workbook/>', 'worksheet', [workbookOnlyRule]);
    expect(
      worksheetResult.issues.filter((i) => i.ruleId === 'test-workbook-only-rule').length,
    ).toBe(0);

    const workbookResult = runValidation('<workbook/>', 'workbook');
    expect(
      workbookResult.issues.filter((i) => i.ruleId === 'test-workbook-only-rule').length,
    ).toBeGreaterThan(0);
  });

  it('degrades a broken rule to a warning without crashing', () => {
    const brokenRule: ValidationRule = {
      id: 'test-broken-rule',
      description: 'Always throws',
      contexts: ['datasource'],
      validate() {
        throw new Error('simulated rule crash');
      },
    };

    const result = runValidation('<workbook/>', 'datasource', [brokenRule]);
    const brokenIssue = result.issues.find((i) => i.ruleId === 'test-broken-rule');
    expect(brokenIssue).toBeDefined();
    expect(brokenIssue!.severity).toBe('warning');
  });

  it('includes issues returned by a rule in the result', () => {
    const detailRule: ValidationRule = {
      id: 'test-detail-rule',
      description: 'Returns issue with all fields',
      contexts: ['datasource'],
      validate() {
        return [
          {
            ruleId: 'test-detail-rule',
            severity: 'warning',
            message: 'test message',
            xpath: '//column',
            suggestion: 'fix it like this',
          },
        ];
      },
    };

    const result = runValidation('<workbook/>', 'datasource', [detailRule]);
    const issue = result.issues.find((i) => i.ruleId === 'test-detail-rule');
    expect(issue).toBeDefined();
    expect(issue!.message).toBe('test message');
    expect(issue!.xpath).toBe('//column');
    expect(issue!.suggestion).toBe('fix it like this');
  });
});
