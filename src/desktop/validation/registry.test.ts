import {
  alwaysBlockingValidationIssues,
  introducedBlockingValidationIssues,
  runAlwaysBlockingValidation,
  runValidation,
} from './registry.js';
import type { ValidationIssue, ValidationRule } from './types.js';

describe('validation framework', () => {
  describe('introducedBlockingValidationIssues', () => {
    const issue = (overrides: Partial<ValidationIssue> = {}): ValidationIssue => ({
      ruleId: 'test-rule',
      severity: 'error',
      message: 'existing problem',
      xpath: '//worksheet[@name="Existing"]',
      ...overrides,
    });

    it('ignores an unchanged blocking issue from the baseline workbook', () => {
      expect(introducedBlockingValidationIssues([issue()], [issue()], 'workbook')).toEqual([]);
    });

    it.each(['dashboard', 'workbook'] as const)(
      'never grandfathers the worksheet-zone crash hazard in %s context, including a reduced occurrence count',
      (context) => {
        const crash = issue({ ruleId: 'dashboard-worksheet-zone-type' });
        expect(introducedBlockingValidationIssues([crash], [crash], context)).toEqual([crash]);
        expect(introducedBlockingValidationIssues([crash, crash], [crash], context)).toEqual([
          crash,
        ]);
      },
    );

    it('permits a repair that removes the worksheet-zone crash hazard', () => {
      const crash = issue({ ruleId: 'dashboard-worksheet-zone-type' });
      expect(introducedBlockingValidationIssues([crash, issue()], [issue()], 'workbook')).toEqual(
        [],
      );
    });

    it('never grandfathers a nameless card zone in dashboard context, including a reduced count', () => {
      const card = issue({ ruleId: 'dashboard-card-zone-name' });
      expect(introducedBlockingValidationIssues([card], [card], 'dashboard')).toEqual([card]);
      expect(introducedBlockingValidationIssues([card, card], [card], 'dashboard')).toEqual([card]);
      expect(
        introducedBlockingValidationIssues(
          [issue({ ruleId: 'dashboard-card-zone-name', occurrenceCount: 3 })],
          [issue({ ruleId: 'dashboard-card-zone-name', occurrenceCount: 1 })],
          'dashboard',
        ),
      ).toHaveLength(1);
    });

    it('waives an unchanged nameless card zone in workbook context but returns an introduced one', () => {
      const card = issue({ ruleId: 'dashboard-card-zone-name' });
      expect(introducedBlockingValidationIssues([card], [card], 'workbook')).toEqual([]);
      expect(introducedBlockingValidationIssues([card], [card, card], 'workbook')).toEqual([card]);
      expect(introducedBlockingValidationIssues([], [card], 'workbook')).toEqual([card]);
    });

    it('never grandfathers a non-numeric zone id in dashboard context', () => {
      const bad = issue({ ruleId: 'dashboard-zone-id-number' });
      expect(introducedBlockingValidationIssues([bad], [bad], 'dashboard')).toEqual([bad]);
    });

    it('waives an unchanged non-numeric zone id in workbook context but returns an introduced one', () => {
      const bad = issue({ ruleId: 'dashboard-zone-id-number' });
      expect(introducedBlockingValidationIssues([bad], [bad], 'workbook')).toEqual([]);
      expect(introducedBlockingValidationIssues([], [bad], 'workbook')).toEqual([bad]);
    });

    it('returns a newly introduced blocking issue', () => {
      const introduced = issue({ xpath: '//worksheet[@name="New"]' });

      expect(
        introducedBlockingValidationIssues([issue()], [issue(), introduced], 'workbook'),
      ).toEqual([introduced]);
    });

    it('returns an extra duplicate of a baseline blocking issue', () => {
      const duplicate = issue();

      expect(
        introducedBlockingValidationIssues([issue()], [issue(), duplicate], 'workbook'),
      ).toEqual([duplicate]);
    });

    it('returns an aggregated issue whose occurrence count increased', () => {
      const baseline = issue({ occurrenceCount: 1 });
      const candidate = issue({ occurrenceCount: 2 });

      expect(introducedBlockingValidationIssues([baseline], [candidate], 'workbook')).toEqual([
        candidate,
      ]);
    });

    it('ignores warning-only differences', () => {
      const warning = issue({ severity: 'warning', message: 'new warning' });

      expect(introducedBlockingValidationIssues([], [warning], 'workbook')).toEqual([]);
    });
  });

  describe('always-blocking contexts', () => {
    const cardXml =
      '<dashboard name="D"><zones><zone id="8" type-v2="filter" param="[ds].[none:p:nk]"/></zones></dashboard>';
    const zoneXml =
      '<dashboard name="D"><zones><zone id="1" name="A" type-v2="worksheet"/></zones></dashboard>';

    it('runs the card rule for dashboard context only', () => {
      expect(runAlwaysBlockingValidation(cardXml, 'dashboard').issues).toEqual([
        expect.objectContaining({ ruleId: 'dashboard-card-zone-name' }),
      ]);
      expect(runAlwaysBlockingValidation(cardXml, 'workbook').issues).toEqual([]);
    });

    it('runs the worksheet-zone rule in dashboard and workbook contexts', () => {
      for (const context of ['dashboard', 'workbook'] as const) {
        expect(runAlwaysBlockingValidation(zoneXml, context).issues).toEqual([
          expect.objectContaining({ ruleId: 'dashboard-worksheet-zone-type' }),
        ]);
      }
    });

    it('runs the zone id rule for dashboard context only', () => {
      const idXml = '<dashboard name="D"><zones><zone id="05" name="A"/></zones></dashboard>';
      expect(runAlwaysBlockingValidation(idXml, 'dashboard').issues).toEqual([
        expect.objectContaining({ ruleId: 'dashboard-zone-id-number' }),
      ]);
      expect(runAlwaysBlockingValidation(idXml, 'workbook').issues).toEqual([]);
    });

    it('filters always-blocking issues by context', () => {
      const card = { ruleId: 'dashboard-card-zone-name', severity: 'error' as const, message: 'm' };
      expect(alwaysBlockingValidationIssues([card], 'dashboard')).toEqual([card]);
      expect(alwaysBlockingValidationIssues([card], 'workbook')).toEqual([]);
    });
  });

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

    const workbookResult = runValidation('<workbook/>', 'workbook', [workbookOnlyRule]);
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
