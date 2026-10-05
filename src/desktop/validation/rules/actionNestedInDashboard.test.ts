import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { actionNestedInDashboardRule } from './actionNestedInDashboard.js';

const nested = `<workbook><worksheets><worksheet name="Period Selector"/></worksheets>
  <dashboards><dashboard name="Placeholder"><zones/>
    <actions><edit-parameter-action name="[Action_SetPeriod]">
      <source worksheet="Period Selector"/><params><param name="target-parameter" value="[Parameters].[Period]"/></params>
    </edit-parameter-action></actions>
  </dashboard></dashboards></workbook>`;

const topLevel = `<workbook><worksheets><worksheet name="Period Selector"/></worksheets>
  <dashboards><dashboard name="Placeholder"><zones/></dashboard></dashboards>
  <actions><edit-parameter-action name="[Action_SetPeriod]">
    <source worksheet="Period Selector"/><params><param name="target-parameter" value="[Parameters].[Period]"/></params>
  </edit-parameter-action></actions></workbook>`;

describe('action-nested-in-dashboard rule', () => {
  it('errors when a parameter action is nested inside a dashboard', () => {
    const issues = actionNestedInDashboardRule.validate(nested);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('action-nested-in-dashboard');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toMatch(/WORKBOOK ROOT|top-level <actions>|sibling/);
  });

  it('does not fire when the action is a top-level actions sibling of dashboards', () => {
    expect(actionNestedInDashboardRule.validate(topLevel)).toHaveLength(0);
  });

  it('also catches a dashboard-nested action and change-parameter', () => {
    const nestedAction =
      '<workbook><dashboards><dashboard name="D"><zones/><actions><action name="[A1]" caption="Highlight"/></actions></dashboard></dashboards></workbook>';
    const nestedChange =
      '<workbook><dashboards><dashboard name="D"><zones/><change-parameter name="[C1]"/></dashboard></dashboards></workbook>';

    expect(actionNestedInDashboardRule.validate(nestedAction)).toHaveLength(1);
    expect(actionNestedInDashboardRule.validate(nestedChange)).toHaveLength(1);
  });

  it('does not fire when there are no actions', () => {
    expect(
      actionNestedInDashboardRule.validate(
        '<workbook><dashboards><dashboard name="D"><zones/></dashboard></dashboards></workbook>',
      ),
    ).toHaveLength(0);
  });

  it('does not fire on a dashboard fragment whose action is correctly outside the dashboard', () => {
    const fragment =
      '<workbook><dashboards><dashboard name="D"><zones/></dashboard></dashboards><actions><edit-parameter-action name="[a]"/></actions></workbook>';

    expect(actionNestedInDashboardRule.validate(fragment)).toHaveLength(0);
  });

  it('fails open on malformed or empty XML', () => {
    expect(actionNestedInDashboardRule.validate('')).toHaveLength(0);
    expect(actionNestedInDashboardRule.validate('<not-xml')).toHaveLength(0);
  });

  it('blocks dashboard validation when registered', () => {
    const result = runValidation(nested, 'dashboard');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'action-nested-in-dashboard')).toBe(true);
  });
});
