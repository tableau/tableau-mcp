import { introducedBlockingValidationIssues, runValidation } from '../registry.js';
import { dashboardWorksheetZoneTypeRule } from './dashboardWorksheetZoneType.js';

describe('dashboard-worksheet-zone-type', () => {
  const malformed = '<zone id="3" name="Pipeline Trend" type-v2="worksheet" />';
  const dashboard = (zones: string): string =>
    `<dashboard name="Pipeline"><zones>${zones}</zones></dashboard>`;

  it('rejects the malformed worksheet type at any nesting depth, including device layouts', () => {
    const xml = `<dashboard name="Pipeline">
      <zones><zone type-v2="layout-basic"><zone-pane>${malformed}</zone-pane></zone></zones>
      <devicelayouts><devicelayout name="Phone"><zones>
        <zone name="Pipeline by Region" type-v2="worksheet" />
      </zones></devicelayout></devicelayouts>
    </dashboard>`;

    const issues = dashboardWorksheetZoneTypeRule.validate(xml);

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
    expect(issues[0].message).toContain('Pipeline Trend');
    expect(issues[1].message).toContain('Pipeline by Region');
    expect(issues[0].suggestion).toContain('missing visual representation');
  });

  it('leaves canonical worksheet, visual, layout, and object zones alone', () => {
    expect(
      dashboardWorksheetZoneTypeRule.validate(
        dashboard(`<zone type-v2="layout-basic">
          <zone name="Pipeline Trend" />
          <zone name="Pipeline by Region" type-v2="visual" />
          <zone name="worksheet" type-v2="text" />
          <zone type-v2="title" /><zone type-v2="blank" />
          <zone type-v2="layout-flow" /><zone type-v2="filter" />
        </zone>`),
      ),
    ).toEqual([]);
  });

  it('also rejects unnamed worksheet zones', () => {
    expect(
      dashboardWorksheetZoneTypeRule.validate(dashboard('<zone type-v2="worksheet" />')),
    ).toEqual([expect.objectContaining({ severity: 'error' })]);
  });

  it('does not match text, comments, or zones outside a dashboard', () => {
    expect(
      dashboardWorksheetZoneTypeRule.validate(`<workbook>
        <zone type-v2="worksheet" />
        ${dashboard(`<!-- ${malformed} --><zone type-v2="text">
          <formatted-text><run>type-v2="worksheet"</run></formatted-text>
        </zone>`)}
      </workbook>`),
    ).toEqual([]);
  });

  it('leaves malformed XML to the well-formed XML rule', () => {
    expect(dashboardWorksheetZoneTypeRule.validate('<dashboard><zone')).toEqual([]);
  });

  it.each(['dashboard', 'workbook'] as const)('is registered for %s applies', (context) => {
    const xml =
      context === 'workbook'
        ? `<workbook><dashboards>${dashboard(malformed)}</dashboards></workbook>`
        : dashboard(malformed);

    expect(runValidation(xml, context).issues).toContainEqual(
      expect.objectContaining({ ruleId: 'dashboard-worksheet-zone-type', severity: 'error' }),
    );
  });

  it('blocks every malformed zone even when an equivalent issue exists in the baseline', () => {
    const baseline = dashboardWorksheetZoneTypeRule.validate(dashboard(malformed));
    const candidate = dashboardWorksheetZoneTypeRule.validate(dashboard(malformed + malformed));

    expect(introducedBlockingValidationIssues(baseline, candidate)).toEqual(candidate);
  });
});
