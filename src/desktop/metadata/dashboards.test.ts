import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import {
  deleteDashboard,
  extractDashboardXml,
  listDashboardRefs,
  listWorkbookDashboards,
  resolveDashboardRef,
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

// A story serializes as a `<dashboard type='storyboard'>` sharing the <dashboards> container with a
// real dashboard; the dashboard resolvers must ignore the story.
const WORKBOOK_WITH_STORYBOARD = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <dashboards>
    <dashboard name='Overview'><zones /><simple-id uuid='{DB-0001}' /></dashboard>
    <dashboard name='QBR Story' type='storyboard'><zones /><simple-id uuid='{ST-0001}' /></dashboard>
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

  it('returns null for a storyboard — a story is not a dashboard', () => {
    expect(extractDashboardXml(WORKBOOK_WITH_STORYBOARD, 'QBR Story')).toBeNull();
    // The real dashboard sharing the container still extracts.
    expect(extractDashboardXml(WORKBOOK_WITH_STORYBOARD, 'Overview')).toContain('name="Overview"');
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

  it('preserves whitespace-significant run text on an untouched sibling worksheet', () => {
    // A dashboard apply re-serializes the whole workbook, worksheets included. A worksheet's
    // formatted <run> text with significant spaces must survive verbatim.
    const workbook = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <worksheets>
    <worksheet name='Sheet 1'><table><formatted-text><run>Sales: </run><run>  $1.2M</run></formatted-text></table></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name='Dashboard 1'><zones><old /></zones></dashboard>
  </dashboards>
</workbook>`;
    const edited = "<dashboard name='Dashboard 1'><zones><new /></zones></dashboard>";
    const doc = upsertDashboardIntoWorkbook(workbook, 'Dashboard 1', edited);

    expect(doc).toContain('<run>Sales: </run>');
    expect(doc).toContain('<run>  $1.2M</run>');
  });
});

describe('listWorkbookDashboards', () => {
  it('lists dashboard names', () => {
    expect(listWorkbookDashboards(WORKBOOK_WITH_USER_NAMESPACE)).toEqual(['Overview']);
  });
});

describe('listDashboardRefs / resolveDashboardRef', () => {
  const WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <dashboards>
    <dashboard name='Overview'><zones /><simple-id uuid='{DB-0001}' /></dashboard>
    <dashboard name='P&amp;L'><zones /><simple-id uuid='{DB-0002}' /></dashboard>
  </dashboards>
</workbook>`;

  it('pairs each dashboard id with its name', () => {
    expect(listDashboardRefs(WORKBOOK)).toEqual([
      { id: '{DB-0001}', name: 'Overview' },
      { id: '{DB-0002}', name: 'P&L' },
    ]);
  });

  it('drops a dashboard that carries no simple-id — a Desktop document always has one', () => {
    expect(listDashboardRefs(WORKBOOK_WITH_USER_NAMESPACE)).toEqual([]);
  });

  it('resolves by simple-id first (id identifies across a rename)', () => {
    expect(resolveDashboardRef(WORKBOOK, '{DB-0002}')).toEqual({ id: '{DB-0002}', name: 'P&L' });
  });

  it('falls back to the display name, decoding XML entities', () => {
    expect(resolveDashboardRef(WORKBOOK, 'P&L')).toEqual({ id: '{DB-0002}', name: 'P&L' });
  });

  it('returns null when neither an id nor a name matches', () => {
    expect(resolveDashboardRef(WORKBOOK, 'No Such Dashboard')).toBeNull();
  });

  it('excludes storyboards: a story is neither listed nor resolvable as a dashboard', () => {
    expect(listDashboardRefs(WORKBOOK_WITH_STORYBOARD)).toEqual([
      { id: '{DB-0001}', name: 'Overview' },
    ]);
    expect(resolveDashboardRef(WORKBOOK_WITH_STORYBOARD, 'QBR Story')).toBeNull();
    expect(resolveDashboardRef(WORKBOOK_WITH_STORYBOARD, '{ST-0001}')).toBeNull();
    // The real dashboard sharing the container still resolves.
    expect(resolveDashboardRef(WORKBOOK_WITH_STORYBOARD, 'Overview')).toEqual({
      id: '{DB-0001}',
      name: 'Overview',
    });
  });
});

describe('deleteDashboard', () => {
  it('removes every canonically equivalent dashboard and dashboard window', () => {
    const workbook = `<workbook>
      <dashboards>
        <dashboard name='Re\u0301sume\u0301'><zones /></dashboard>
        <dashboard name='R\u00e9sum\u00e9'><zones /></dashboard>
        <dashboard name='Keep'><zones /></dashboard>
      </dashboards>
      <windows>
        <window class='dashboard' name='Re\u0301sume\u0301' />
        <window class='dashboard' name='R\u00e9sum\u00e9' />
        <window class='worksheet' name='R\u00e9sum\u00e9' />
        <window class='dashboard' name='Keep' />
      </windows>
    </workbook>`;

    const result = deleteDashboard(workbook, 'R\u00e9sum\u00e9');

    expect(listWorkbookDashboards(result)).toEqual(['Keep']);
    expect(result).not.toContain('class="dashboard" name="Re\u0301sume\u0301"');
    expect(result).not.toContain('class="dashboard" name="R\u00e9sum\u00e9"');
    expect(result).toContain('class="worksheet" name="R\u00e9sum\u00e9"');
    expect(result).toContain('class="dashboard" name="Keep"');
  });
});
