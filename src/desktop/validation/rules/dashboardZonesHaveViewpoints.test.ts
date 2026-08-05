import { runValidation } from '../registry.js';

const RULE_ID = 'dashboard-zones-have-viewpoints';

describe('dashboard-zones-have-viewpoints rule', () => {
  it('blocks a live dashboard window when a worksheet zone has no direct matching viewpoint', () => {
    const result = runValidation(
      workbook({
        dashboardWindow: `<window class='dashboard' name='Executive'>
          <viewpoints><viewpoint name='Sales by State' /></viewpoints>
        </window>`,
      }),
      'workbook',
    );

    const issues = result.issues.filter((issue) => issue.ruleId === RULE_ID);
    expect(result.valid).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error' });
    expect(issues[0].message).toContain('Profit vs Sales');
  });

  it('blocks empty viewpoints for a dashboard with worksheet zones', () => {
    const result = runValidation(
      workbook({
        dashboardWindow: "<window class='dashboard' name='Executive'><viewpoints /></window>",
      }),
      'workbook',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toHaveLength(2);
  });

  it('treats type-v2 visual zones as worksheet zones that require viewpoints', () => {
    const result = runValidation(
      workbook({
        dashboardWindow: `<window class='dashboard' name='Executive'>
          <viewpoints><viewpoint name='Sales by State' /></viewpoints>
        </window>`,
        profitZoneType: 'visual',
      }),
      'workbook',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Profit vs Sales'),
      }),
    ]);
  });

  it('allows the first apply of a net-new dashboard that has no matching window yet', () => {
    const result = runValidation(workbook({ dashboardWindow: '' }), 'workbook');

    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toEqual([]);
  });

  it('allows a dashboard when every worksheet zone has a direct matching viewpoint', () => {
    const result = runValidation(
      workbook({
        dashboardWindow: `<window class='dashboard' name='Executive'><viewpoints>
          <viewpoint name='Sales by State' />
          <viewpoint name='Profit vs Sales' />
        </viewpoints></window>`,
      }),
      'workbook',
    );

    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toEqual([]);
  });

  it('matches normalized dashboard window names before checking viewpoints', () => {
    const dashboardName = 'Año';
    const result = runValidation(
      `<workbook>
        <worksheets><worksheet name='Sales'><table /></worksheet></worksheets>
        <dashboards><dashboard name='${dashboardName}'><zones><zone name='Sales' /></zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='Sales' />
          <window class='dashboard' name='${dashboardName.normalize('NFD')}'><viewpoints /></window>
        </windows>
      </workbook>`,
      'workbook',
    );

    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toHaveLength(1);
  });

  it('accepts a normalized viewpoint name for the worksheet zone', () => {
    const worksheetName = 'Café';
    const result = runValidation(
      `<workbook>
        <worksheets><worksheet name='${worksheetName}'><table /></worksheet></worksheets>
        <dashboards><dashboard name='Executive'><zones><zone name='${worksheetName}' type-v2='visual' /></zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='${worksheetName}' />
          <window class='dashboard' name='Executive'><viewpoints>
            <viewpoint name='${worksheetName.normalize('NFD')}' />
          </viewpoints></window>
        </windows>
      </workbook>`,
      'workbook',
    );

    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toEqual([]);
  });

  it('does not run in dashboard-fragment validation', () => {
    const result = runValidation(workbook({ dashboardWindow: '' }), 'dashboard');

    expect(result.issues.filter((issue) => issue.ruleId === RULE_ID)).toEqual([]);
  });
});

function workbook({
  dashboardWindow,
  profitZoneType,
}: {
  dashboardWindow: string;
  profitZoneType?: string;
}): string {
  const profitType = profitZoneType ? ` type-v2='${profitZoneType}'` : '';
  return `<workbook>
    <worksheets>
      <worksheet name='Sales by State'><table /></worksheet>
      <worksheet name='Profit vs Sales'><table /></worksheet>
    </worksheets>
    <dashboards><dashboard name='Executive'><zones>
      <zone type-v2='layout-basic'>
        <zone name='Sales by State' />
        <zone name='Profit vs Sales'${profitType} />
      </zone>
    </zones></dashboard></dashboards>
    <windows>
      <window class='worksheet' name='Sales by State' />
      <window class='worksheet' name='Profit vs Sales' />
      ${dashboardWindow}
    </windows>
  </workbook>`;
}
