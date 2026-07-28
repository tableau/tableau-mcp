import { accountDashboardViewpoints } from './viewpointAccounting.js';

describe('accountDashboardViewpoints', () => {
  it('skips the second apply only when the dashboard window already has every viewpoint', () => {
    const beforeXml =
      '<workbook><windows><window class="dashboard" name="Sales &amp; Profit"><viewpoints><viewpoint name="Profit"/><viewpoint name="Sales"/></viewpoints></window></windows></workbook>';
    const afterXml =
      '<workbook><windows><window class="dashboard" name="Sales &amp; Profit"><viewpoints><viewpoint name="Sales"/><viewpoint name="Profit"/></viewpoints></window></windows></workbook>';

    expect(
      accountDashboardViewpoints({
        beforeXml,
        afterXml,
        dashboardName: ' Sales & Profit ',
        requested: ['Sales', 'Profit'],
      }),
    ).toEqual({
      state: 'success-already-present',
      requested: ['Sales', 'Profit'],
      landed: ['Sales', 'Profit'],
      failed: [],
    });
  });

  it('does not report already present when the dashboard window is absent', () => {
    const workbookXml = '<workbook><windows/></workbook>';

    expect(
      accountDashboardViewpoints({
        beforeXml: workbookXml,
        afterXml: workbookXml,
        dashboardName: 'Sales Dashboard',
        requested: ['Sales'],
      }),
    ).toEqual({
      state: 'failed',
      requested: ['Sales'],
      landed: [],
      failed: ['Sales'],
    });
  });
});
