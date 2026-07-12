import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { dashboardZoneWorksheetReferencesRule } from './dashboardZoneWorksheetReferences.js';

function buildWorkbook(zoneName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table><view /></table>
    </worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Dashboard 1">
      <zones>
        <zone name="${zoneName}" h="800" w="1000" x="0" y="0" />
      </zones>
    </dashboard>
  </dashboards>
</workbook>`;
}

describe('dashboard-zone-worksheet-references rule', () => {
  it('emits nothing when dashboard zone names reference existing worksheets', () => {
    expect(dashboardZoneWorksheetReferencesRule.validate(buildWorkbook('Sheet 1'))).toHaveLength(0);
  });

  it('emits an error when a dashboard zone references a missing worksheet', () => {
    const issues = dashboardZoneWorksheetReferencesRule.validate(buildWorkbook('Missing Sheet'));

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('dashboard-zone-worksheet-references');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('Missing Sheet');
    expect(issues[0].message).toContain('Dashboard 1');
  });

  it('does not treat layout, text, filter, empty, or image zones as worksheet references', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1"><table><view /></table></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Dashboard 1">
      <zones>
        <zone type-v2="layout-basic" h="100000" w="100000" x="0" y="0">
          <zone type-v2="text"><formatted-text><run>Title</run></formatted-text></zone>
          <zone type-v2="filter" name="Sheet 1" param="[ds].[none:Region:nk]" />
          <zone type-v2="empty" />
          <zone type-v2="bitmap" />
          <zone name="Sheet 1" />
        </zone>
      </zones>
    </dashboard>
  </dashboards>
</workbook>`;

    expect(dashboardZoneWorksheetReferencesRule.validate(xml)).toHaveLength(0);
  });

  it('blocks validation when registered and a dashboard zone references a missing worksheet', () => {
    const result = runValidation(buildWorkbook('Missing Sheet'), 'workbook');

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.ruleId === 'dashboard-zone-worksheet-references' && i.severity === 'error',
      ),
    ).toBe(true);
  });
});
