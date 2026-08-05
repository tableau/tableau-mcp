import type { ValidationIssue } from '../../validation/types.js';
import {
  candidateIntroducedBlockingIssues,
  targetDashboardInvariantIssues,
} from './dashboardCandidateValidation.js';

describe('candidateIntroducedBlockingIssues', () => {
  it('uses issue counts so one baseline occurrence does not hide a second candidate occurrence', () => {
    const issue: ValidationIssue = {
      ruleId: 'duplicate-example',
      severity: 'error',
      message: 'same issue',
      xpath: '//same',
      suggestion: 'fix it',
    };

    expect(candidateIntroducedBlockingIssues([issue], [issue, { ...issue }])).toEqual([issue]);
  });
});

describe('targetDashboardInvariantIssues', () => {
  it('enforces only the target dashboard worksheet, window, and viewpoint closure', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets>
          <worksheet name='Target Sheet' />
          <worksheet name='Other Sheet' />
        </worksheets>
        <dashboards>
          <dashboard name='Target'>
            <zones><zone name='Target Sheet' /><zone name='Missing Sheet' /></zones>
          </dashboard>
          <dashboard name='Other'><zones><zone name='Other Sheet' /></zones></dashboard>
        </dashboards>
        <windows>
          <window class='dashboard' name='Target' />
          <window class='dashboard' name='Other' />
        </windows>
      </workbook>`,
      'Target',
    );

    expect(issues.map((issue) => issue.ruleId).sort()).toEqual([
      'dashboard-zones-have-viewpoints',
      'dashboard-zones-reference-included-worksheets',
      'worksheet-missing-window',
    ]);
    expect(issues.every((issue) => !issue.message.includes('Other'))).toBe(true);
  });
});
