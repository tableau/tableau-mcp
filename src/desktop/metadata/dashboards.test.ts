import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import {
  dashboardDocumentToFragment,
  extractDashboardXml,
  listWorkbookDashboards,
  upsertDashboardIntoWorkbook,
} from './dashboards.js';

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

describe('dashboardDocumentToFragment', () => {
  // The live per-dashboard /document route returns a whole <workbook>, not a bare fragment.
  const WORKBOOK_WITH_DASHBOARD = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <dashboards>
    <dashboard name='Executive Dashboard'><zones /></dashboard>
  </dashboards>
</workbook>`;

  it('slices the requested dashboard out of a whole-workbook document', () => {
    const xml = dashboardDocumentToFragment(WORKBOOK_WITH_DASHBOARD, 'Executive Dashboard');
    expect(xml).not.toBeNull();
    expect(xml).toContain('name="Executive Dashboard"');
    expect(xml).not.toContain('<workbook');
  });

  it('returns a document that is already a bare <dashboard> fragment unchanged', () => {
    const fragment = '<dashboard name="Solo"><zones /></dashboard>';
    expect(dashboardDocumentToFragment(fragment, 'Solo')).toBe(fragment);
  });

  it('returns null when the document contains no dashboard', () => {
    expect(
      dashboardDocumentToFragment('<workbook><dashboards /></workbook>', 'Missing'),
    ).toBeNull();
  });
});

describe('upsertDashboardIntoWorkbook', () => {
  // The POST replaces the open workbook wholesale, so the posted doc must carry the entire live
  // workbook — worksheets included (the dashboard's zones reference them by name) — with only the
  // target dashboard swapped in.
  const LIVE_WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <worksheets>
    <worksheet name='Sheet 1'><table /></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name='Dashboard 1'><zones><old /></zones></dashboard>
    <dashboard name='Dashboard 2'><zones /></dashboard>
  </dashboards>
</workbook>`;

  it('replaces the target dashboard while preserving siblings and worksheets', () => {
    const edited = "<dashboard name='Dashboard 1'><zones><new /></zones></dashboard>";
    const doc = upsertDashboardIntoWorkbook(LIVE_WORKBOOK, 'Dashboard 1', edited);

    expect(doc).toContain('<new');
    expect(doc).not.toContain('<old');
    expect(doc).toContain('name="Dashboard 2"');
    expect(doc).toContain('name="Sheet 1"');
    expect(listWorkbookDashboards(doc)).toEqual(['Dashboard 1', 'Dashboard 2']);
  });

  it('appends a brand-new dashboard, keeping the existing ones and worksheets', () => {
    const edited = "<dashboard name='Dashboard 3'><zones /></dashboard>";
    const doc = upsertDashboardIntoWorkbook(LIVE_WORKBOOK, 'Dashboard 3', edited);

    expect(listWorkbookDashboards(doc)).toEqual(['Dashboard 1', 'Dashboard 2', 'Dashboard 3']);
    expect(doc).toContain('name="Sheet 1"');
  });

  it('throws when the edited XML does not carry a <dashboard> with the given name', () => {
    const edited = "<dashboard name='Wrong'><zones /></dashboard>";
    expect(() => upsertDashboardIntoWorkbook(LIVE_WORKBOOK, 'Dashboard 1', edited)).toThrow();
  });
});

describe('listWorkbookDashboards', () => {
  it('lists dashboard names', () => {
    expect(listWorkbookDashboards(WORKBOOK_WITH_USER_NAMESPACE)).toEqual(['Overview']);
  });
});
