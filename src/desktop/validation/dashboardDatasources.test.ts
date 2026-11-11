import {
  dashboardDatasourceMismatches,
  dashboardDatasourceRefusal,
  hasDashboardDatasources,
} from './dashboardDatasources.js';

const workbook = `<?xml version="1.0" encoding="utf-8" ?>
<workbook><datasources>
  <datasource caption="Sales" name="federated.a" version="18.1" />
  <datasource name="Parameters" />
</datasources>
<worksheets><worksheet name="W"><table><view><datasources><datasource caption="Other" name="federated.a" /></datasources></view></table></worksheet></worksheets>
</workbook>`;

const dashboard = (inner: string): string =>
  `<dashboard name='D'><zones />${inner}<datasource-dependencies datasource='federated.a' /></dashboard>`;

describe('dashboardDatasources', () => {
  it('detects only a top-level <datasources> block', () => {
    expect(hasDashboardDatasources(dashboard(''))).toBe(false);
    expect(hasDashboardDatasources(dashboard('<datasources />'))).toBe(true);
    expect(hasDashboardDatasources('<dashboard name="D"><zones><zone/></zones></dashboard>')).toBe(
      false,
    );
    expect(hasDashboardDatasources('<not-xml')).toBe(false);
  });

  it('returns nothing for matching entries, an empty block or no block', () => {
    const matching = dashboard(
      "<datasources><datasource caption='Sales' name='federated.a' /><datasource name='Parameters' /></datasources>",
    );
    expect(dashboardDatasourceMismatches(matching, workbook)).toEqual([]);
    expect(dashboardDatasourceMismatches(dashboard('<datasources />'), workbook)).toEqual([]);
    expect(dashboardDatasourceMismatches(dashboard(''), workbook)).toEqual([]);
    expect(dashboardDatasourceRefusal(matching, workbook)).toBeUndefined();
  });

  it('compares against the workbook top-level entry, not worksheet view entries', () => {
    const sentOther = dashboard(
      "<datasources><datasource caption='Other' name='federated.a' /></datasources>",
    );
    expect(dashboardDatasourceMismatches(sentOther, workbook)).toEqual([
      {
        sent: { name: 'federated.a', caption: 'Other' },
        workbook: { name: 'federated.a', caption: 'Sales' },
      },
    ]);
  });

  it('reports a name the workbook lacks without a workbook entry', () => {
    const [mismatch] = dashboardDatasourceMismatches(
      dashboard("<datasources><datasource name='federated.zzz' /></datasources>"),
      workbook,
    );
    expect(mismatch).toEqual({ sent: { name: 'federated.zzz' }, workbook: undefined });
  });

  it('tells a workbook with no datasources to remove the entry', () => {
    const message = dashboardDatasourceRefusal(
      dashboard("<datasources><datasource name='x' /></datasources>"),
      '<workbook><worksheets /></workbook>',
    );
    expect(message).toContain('remove the unknown entry (the workbook has no datasources)');
  });

  it('checks every <datasources> block under the dashboard', () => {
    const two = dashboard(
      "<datasources><datasource caption='Sales' name='federated.a' /></datasources><datasources><datasource name='federated.a' /></datasources>",
    );
    expect(hasDashboardDatasources(two)).toBe(true);
    expect(dashboardDatasourceMismatches(two, workbook)).toEqual([
      {
        sent: { name: 'federated.a' },
        workbook: { name: 'federated.a', caption: 'Sales' },
      },
    ]);
  });
});
