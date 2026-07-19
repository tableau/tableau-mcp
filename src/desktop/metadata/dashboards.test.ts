import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { extractDashboardXml, listWorkbookDashboards } from './dashboards.js';

// Same shape as the worksheet regression (sheets.test.ts): the <workbook> root declares
// xmlns:user, and a zone's filter carries a user:-prefixed attribute. The declaration lives on
// the ancestor <workbook> element, not on <dashboard> itself.
const WORKBOOK_WITH_USER_NAMESPACE = `<?xml version='1.0' encoding='utf-8' ?>
<workbook original-version='18.1' source-build='0.0.0 (0000.26.0531.2046)' source-platform='mac' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <dashboards>
    <dashboard name='Overview'>
      <zones>
        <zone type-v2='layout-basic'>
          <groupfilter function='level-members' level='[none:Region:nk]' user:ui-enumeration='all' />
        </zone>
      </zones>
    </dashboard>
  </dashboards>
</workbook>`;

describe('extractDashboardXml', () => {
  it('finds and extracts an existing dashboard', () => {
    const xml = extractDashboardXml(WORKBOOK_WITH_USER_NAMESPACE, 'Overview');
    expect(xml).not.toBeNull();
    expect(xml).toContain('<dashboard');
    expect(xml).toContain('name="Overview"');
  });

  it('returns null for a dashboard that does not exist', () => {
    expect(extractDashboardXml(WORKBOOK_WITH_USER_NAMESPACE, 'Does Not Exist')).toBeNull();
  });

  // Same live-bug shape as extractSheetXml (sheets.test.ts): an untouched get-dashboard-xml ->
  // apply-dashboard round-trip must pass the same well-formed-xml preflight apply-dashboard runs.
  it('carries the xmlns:user declaration from the workbook root onto the extracted dashboard', () => {
    const xml = extractDashboardXml(WORKBOOK_WITH_USER_NAMESPACE, 'Overview');
    expect(xml).not.toBeNull();
    expect(xml).toContain('user:ui-enumeration');

    const issues = wellFormedXmlRule.validate(xml!);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('does not overwrite a namespace declaration the dashboard already carries itself', () => {
    const workbookWithConflict = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <dashboards>
    <dashboard name='q' xmlns:user='http://example.com/already-declared'>
      <zones></zones>
    </dashboard>
  </dashboards>
</workbook>`;
    const xml = extractDashboardXml(workbookWithConflict, 'q');
    expect(xml).toContain('http://example.com/already-declared');
    expect(xml).not.toContain('http://www.tableausoftware.com/xml/user');
  });
});

describe('listWorkbookDashboards', () => {
  it('lists dashboard names', () => {
    expect(listWorkbookDashboards(WORKBOOK_WITH_USER_NAMESPACE)).toEqual(['Overview']);
  });
});
