import { describe, expect, it, vi } from 'vitest';

import { runValidation } from '../registry.js';
import { categoricalFilterProliferationRule } from './categoricalFilterProliferation.js';

function enable(): void {
  vi.stubEnv('ENABLE_FILTER_GUARDRAIL', 'true');
}

function disable(): void {
  vi.stubEnv('ENABLE_FILTER_GUARDRAIL', undefined);
}

function buildWorkbookWithFilters(n: number, klass = 'categorical'): string {
  const filters = Array.from(
    { length: n },
    (_, i) => `<filter class="${klass}" column="[ds].[none:Dim${i}:nk]"></filter>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table><view>
        ${filters}
      </view></table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('categorical-filter-proliferation rule', () => {
  it('emits nothing for 3 categorical filters even when enabled', () => {
    enable();
    expect(categoricalFilterProliferationRule.validate(buildWorkbookWithFilters(3))).toHaveLength(
      0,
    );
  });

  it('emits an error for 7 categorical filters when ENABLE_FILTER_GUARDRAIL is true', () => {
    enable();
    const issues = categoricalFilterProliferationRule.validate(buildWorkbookWithFilters(7));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('7 categorical filter controls');
    expect(issues[0].message).toContain('dashboard-performance-efficient-workbooks');
  });

  it('blocks validation for 7 categorical filters when enabled', () => {
    enable();
    const result = runValidation(buildWorkbookWithFilters(7), 'workbook', [
      categoricalFilterProliferationRule,
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.ruleId === 'categorical-filter-proliferation' && i.severity === 'error',
      ),
    ).toBe(true);
  });

  it('is inert when the flag is off even with 7 filters', () => {
    disable();
    expect(categoricalFilterProliferationRule.validate(buildWorkbookWithFilters(7))).toHaveLength(
      0,
    );
    const result = runValidation(buildWorkbookWithFilters(7), 'workbook', [
      categoricalFilterProliferationRule,
    ]);
    expect(result.issues.some((i) => i.ruleId === 'categorical-filter-proliferation')).toBe(false);
  });

  it('does not trigger on 7 non-categorical filters when enabled', () => {
    enable();
    expect(
      categoricalFilterProliferationRule.validate(buildWorkbookWithFilters(7, 'relational')),
    ).toHaveLength(0);
  });

  it.each([
    ['unset', undefined],
    ['false', 'false'],
    ['0', '0'],
    ['1', '1'],
  ])('is inert with 7 filters when ENABLE_FILTER_GUARDRAIL is %s', (_label, value) => {
    vi.stubEnv('ENABLE_FILTER_GUARDRAIL', value);
    expect(categoricalFilterProliferationRule.validate(buildWorkbookWithFilters(7))).toHaveLength(
      0,
    );
  });
});
