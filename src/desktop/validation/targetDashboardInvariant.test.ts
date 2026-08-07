import { targetDashboardInvariantIssues } from './targetDashboardInvariant.js';

describe('targetDashboardInvariantIssues', () => {
  it('verifies the target dashboard structural closure', () => {
    expect(
      targetDashboardInvariantIssues(
        `<workbook>
          <worksheets><worksheet name='Sales' /><worksheet name='Profit' /></worksheets>
          <dashboards><dashboard name='Executive'><zones>
            <zone name='Sales' /><zone name='Profit' />
          </zones></dashboard></dashboards>
          <windows>
            <window class='worksheet' name='Sales' />
            <window class='worksheet' name='Profit' />
            <window class='dashboard' name='Executive'><viewpoints>
              <viewpoint name='Sales' /><viewpoint name='Profit' />
            </viewpoints></window>
          </windows>
        </workbook>`,
        'Executive',
        ['Sales', 'Profit'],
      ),
    ).toEqual([]);
  });

  it('reports every missing target structure without inspecting unrelated dashboards', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets><worksheet name='Sales' /><worksheet name='Broken Other Sheet' /></worksheets>
        <dashboards>
          <dashboard name='Executive'><zones><zone name='Sales' /></zones></dashboard>
          <dashboard name='Broken Other'><zones><zone name='Missing Elsewhere' /></zones></dashboard>
        </dashboards>
        <windows>
          <window class='dashboard' name='Executive'><viewpoints /></window>
          <window class='dashboard' name='Broken Other' />
        </windows>
      </workbook>`,
      'Executive',
      ['Sales', 'Profit'],
    );

    expect(issues.map((issue) => issue.code).sort()).toEqual([
      'direct-viewpoint-missing',
      'direct-viewpoint-missing',
      'worksheet-missing',
      'worksheet-window-missing',
      'worksheet-window-missing',
      'worksheet-zone-missing',
    ]);
    expect(issues.every((issue) => !issue.message.includes('Broken Other'))).toBe(true);
    expect(issues.every((issue) => !issue.message.includes('Missing Elsewhere'))).toBe(true);
  });

  it('uses NFC-aware matching for dashboard, worksheet, window, zone, and viewpoint names', () => {
    expect(
      targetDashboardInvariantIssues(
        `<workbook>
          <worksheets><worksheet name='Cafe\u0301' /></worksheets>
          <dashboards><dashboard name='Re\u0301sume\u0301'><zones><zone name='Cafe\u0301' /></zones></dashboard></dashboards>
          <windows>
            <window class='worksheet' name='Cafe\u0301' />
            <window class='dashboard' name='Re\u0301sume\u0301'><viewpoints><viewpoint name='Cafe\u0301' /></viewpoints></window>
          </windows>
        </workbook>`,
        'R\u00e9sum\u00e9',
        ['Caf\u00e9'],
      ),
    ).toEqual([]);
  });

  it('rejects target viewpoints placed after Tableau metadata children', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets><worksheet name='Sales' /></worksheets>
        <dashboards><dashboard name='Executive'><zones><zone name='Sales' /></zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='Sales' />
          <window class='dashboard' name='Executive'>
            <active id='-1' />
            <viewpoints><viewpoint name='Sales' /></viewpoints>
            <simple-id uuid='{dashboard-window}' />
          </window>
        </windows>
      </workbook>`,
      'Executive',
      ['Sales'],
    );

    expect(issues.map((issue) => issue.code)).toEqual(['direct-viewpoints-order-invalid']);
  });

  it('rejects ambiguous canonically equivalent dashboard nodes and windows', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <dashboards>
          <dashboard name='Re\u0301sume\u0301'><zones /></dashboard>
          <dashboard name='R\u00e9sum\u00e9'><zones /></dashboard>
        </dashboards>
        <windows>
          <window class='dashboard' name='Re\u0301sume\u0301'><viewpoints /></window>
          <window class='dashboard' name='R\u00e9sum\u00e9'><viewpoints /></window>
        </windows>
      </workbook>`,
      'R\u00e9sum\u00e9',
      [],
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'target-dashboard-count',
      'dashboard-window-count',
    ]);
  });

  it('requires exact zone and viewpoint closure when expected worksheets are supplied', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets><worksheet name='Sales' /></worksheets>
        <dashboards><dashboard name='Executive'><zones>
          <zone name='Sales' /><zone name='Sales' /><zone name='Extra' />
        </zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='Sales' />
          <window class='dashboard' name='Executive'><viewpoints>
            <viewpoint name='Sales' /><viewpoint name='Sales' /><viewpoint name='Extra' />
          </viewpoints></window>
        </windows>
      </workbook>`,
      'Executive',
      ['Sales'],
    );

    expect(issues.map((issue) => issue.code).sort()).toEqual([
      'direct-viewpoint-duplicate',
      'direct-viewpoint-unexpected',
      'worksheet-zone-duplicate',
      'worksheet-zone-unexpected',
    ]);
  });

  it('allows an inert retained viewpoint for an existing rendered worksheet', () => {
    expect(
      targetDashboardInvariantIssues(
        `<workbook>
          <worksheets>
            <worksheet name='bars' />
            <worksheet name='simple scatterplot' />
            <worksheet name='PR729 Live Smoke' />
          </worksheets>
          <dashboards><dashboard name='Live Dashboard'><zones>
            <zone name='bars' /><zone name='simple scatterplot' />
          </zones></dashboard></dashboards>
          <windows>
            <window class='worksheet' name='bars' />
            <window class='worksheet' name='simple scatterplot' />
            <window class='worksheet' name='PR729 Live Smoke' />
            <window class='dashboard' name='Live Dashboard'><viewpoints>
              <viewpoint name='bars' />
              <viewpoint name='simple scatterplot' />
              <viewpoint name='PR729 Live Smoke' />
            </viewpoints></window>
          </windows>
        </workbook>`,
        'Live Dashboard',
        ['bars', 'simple scatterplot'],
      ),
    ).toEqual([]);
  });

  it('still rejects duplicated or unresolved retained viewpoints', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets>
          <worksheet name='Sales' />
          <worksheet name='Rendered Old Sheet' />
          <worksheet name='Unrendered Old Sheet' />
        </worksheets>
        <dashboards><dashboard name='Executive'><zones>
          <zone name='Sales' />
        </zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='Sales' />
          <window class='worksheet' name='Rendered Old Sheet' />
          <window class='worksheet' name='Missing Old Sheet' />
          <window class='dashboard' name='Executive'><viewpoints>
            <viewpoint name='Sales' />
            <viewpoint name='Rendered Old Sheet' />
            <viewpoint name='Rendered Old Sheet' />
            <viewpoint name='Unrendered Old Sheet' />
            <viewpoint name='Missing Old Sheet' />
          </viewpoints></window>
        </windows>
      </workbook>`,
      'Executive',
      ['Sales'],
    );

    expect(issues.map((issue) => issue.code).sort()).toEqual([
      'direct-viewpoint-duplicate',
      'direct-viewpoint-unexpected',
      'direct-viewpoint-unexpected',
    ]);
  });

  it('requires viewpoints to be the first direct dashboard-window element', () => {
    const issues = targetDashboardInvariantIssues(
      `<workbook>
        <worksheets><worksheet name='Sales' /></worksheets>
        <dashboards><dashboard name='Executive'><zones><zone name='Sales' /></zones></dashboard></dashboards>
        <windows>
          <window class='worksheet' name='Sales' />
          <window class='dashboard' name='Executive'>
            <cards />
            <viewpoints><viewpoint name='Sales' /></viewpoints>
          </window>
        </windows>
      </workbook>`,
      'Executive',
      ['Sales'],
    );

    expect(issues.map((issue) => issue.code)).toEqual(['direct-viewpoints-order-invalid']);
  });
});
