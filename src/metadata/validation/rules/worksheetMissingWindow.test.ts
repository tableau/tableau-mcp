import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { worksheetMissingWindowRule } from './worksheetMissingWindow.js';

function workbook(worksheetNames: string[], windowNames: string[]): string {
  const worksheets = worksheetNames
    .map((name) => `<worksheet name="${name}"><table><view /></table></worksheet>`)
    .join('\n    ');
  const windows = windowNames
    .map((name) => `<window name="${name}" class="worksheet"><cards /></window>`)
    .join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    ${worksheets}
  </worksheets>
  <windows>
    ${windows}
  </windows>
</workbook>`;
}

describe('worksheet-missing-window rule', () => {
  it('errors when a worksheet has no matching window entry', () => {
    const issues = worksheetMissingWindowRule.validate(workbook(['Sheet 1'], []));

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('worksheet-missing-window');
    expect(issues[0].message).toContain('Sheet 1');
    expect(issues[0].message.toLowerCase()).toContain('silently drop');
  });

  it('emits nothing when every worksheet has a matching window', () => {
    expect(
      worksheetMissingWindowRule.validate(workbook(['Sheet 1', 'Sheet 2'], ['Sheet 1', 'Sheet 2'])),
    ).toHaveLength(0);
  });

  it('errors only for the worksheet whose window is missing', () => {
    const issues = worksheetMissingWindowRule.validate(
      workbook(['Sheet 1', 'Sheet 2'], ['Sheet 1']),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Sheet 2');
  });

  it('does not count a dashboard-class window as a worksheet window', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1"><table><view /></table></worksheet>
  </worksheets>
  <windows>
    <window name="Sheet 1" class="dashboard"><cards /></window>
  </windows>
</workbook>`;

    const issues = worksheetMissingWindowRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Sheet 1');
  });

  it('emits nothing when there are no worksheets', () => {
    expect(
      worksheetMissingWindowRule.validate('<workbook><datasources /></workbook>'),
    ).toHaveLength(0);
  });

  it('blocks validation because a missing worksheet window produces an unreachable sheet', () => {
    const result = runValidation(workbook(['Sheet 1'], []), 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'worksheet-missing-window')).toBe(true);
  });
});
