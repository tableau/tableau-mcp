import {
  extractWorkbookOptimizerResult,
  isWorkbookOptimizerToolName,
  parseExpectedRules,
  readManifestRuleIds,
  validateDesktopRouteLog,
  validateWorkbookOptimizerResult,
} from './workbookOptimizerSmokeValidation.js';

const result = {
  suggestions: [
    {
      ruleId: 5,
      title: 'Unused fields',
      description: 'Remove unused fields.',
      status: 'FAIL' as const,
      affected: { count: 2, items: [{ name: 'Data', items: [{ name: 'Unused' }] }] },
    },
    {
      ruleId: 6,
      title: 'Visible sheets',
      description: 'Reduce visible sheets.',
      status: 'NEEDS_REVIEW' as const,
      affected: { count: 20, items: [{ name: 'numTotalVisibleWindows', value: 20 }] },
    },
    {
      ruleId: 20,
      title: 'Conditional filters',
      description: 'Review conditional filters.',
      status: 'NEEDS_REVIEW' as const,
      affected: { count: 3, items: [{ name: 'Sheet' }] },
    },
  ],
};

describe('workbookOptimizerSmokeValidation', () => {
  it('parses a strict rule oracle', () => {
    expect(parseExpectedRules('5:FAIL,6:NEEDS_REVIEW')).toEqual([
      { ruleId: 5, status: 'FAIL', minimumAffected: 1 },
      { ruleId: 6, status: 'NEEDS_REVIEW', minimumAffected: 1 },
    ]);
    expect(() => parseExpectedRules('5:FAIL,5:FAIL')).toThrow('Duplicate');
    expect(() => parseExpectedRules('5:UNKNOWN')).toThrow('Invalid rule expectation');
  });

  it('reads unique rule IDs from the package manifest', () => {
    expect(
      readManifestRuleIds({ schemaVersion: 1, rules: [{ ruleId: 20 }, { ruleId: 5 }] }),
    ).toEqual([5, 20]);
    expect(() => readManifestRuleIds({ rules: [{ ruleId: 5 }, { ruleId: 5 }] })).toThrow(
      'duplicate rule IDs',
    );
  });

  it('recognizes direct and SDK-prefixed optimizer tool names', () => {
    expect(isWorkbookOptimizerToolName('run-workbook-optimizer')).toBe(true);
    expect(isWorkbookOptimizerToolName('mcp__tableau-desktop__run-workbook-optimizer')).toBe(true);
    expect(isWorkbookOptimizerToolName('execute-tableau-command')).toBe(false);
  });

  it('extracts the result from MCP and agent tool-result wrappers', () => {
    expect(extractWorkbookOptimizerResult(result)).toEqual(result);
    expect(
      extractWorkbookOptimizerResult({
        type: 'tool_result',
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }),
    ).toEqual(result);
    expect(extractWorkbookOptimizerResult({ content: 'not optimizer JSON' })).toBeNull();
  });

  it('matches the manifest and representative workbook triggers', () => {
    expect(
      validateWorkbookOptimizerResult({
        result,
        manifestRuleIds: [5, 6, 20],
        expectedRules: parseExpectedRules('5:FAIL,6:NEEDS_REVIEW,20:NEEDS_REVIEW'),
      }),
    ).toMatchObject({
      ruleCount: 3,
      failedRuleIds: [5],
      needsReviewRuleIds: [6, 20],
    });
  });

  it('rejects package/native rule drift and fixture-oracle drift', () => {
    expect(() =>
      validateWorkbookOptimizerResult({
        result,
        manifestRuleIds: [5, 6, 19, 20],
        expectedRules: parseExpectedRules('5:FAIL'),
      }),
    ).toThrow('differs from the npm manifest');

    expect(() =>
      validateWorkbookOptimizerResult({
        result,
        manifestRuleIds: [5, 6, 20],
        expectedRules: parseExpectedRules('5:NEEDS_REVIEW'),
      }),
    ).toThrow('returned FAIL; expected NEEDS_REVIEW');
  });

  it('requires received and successful completed Desktop route log lines', () => {
    const log = [
      'External API request received: POST /v0/workbook:runWorkbookOptimizer',
      'External API request completed: POST /v0/workbook:runWorkbookOptimizer -> 200',
    ].join('\n');
    expect(() => validateDesktopRouteLog(log)).not.toThrow();
    expect(() => validateDesktopRouteLog('unrelated')).toThrow('no received entry');
  });
});
