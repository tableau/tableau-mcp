import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import {
  addSheet,
  deleteSheet,
  extractSheetXml,
  listSheets,
  upsertSheetIntoWorkbook,
  worksheetDocumentToFragment,
} from './sheets.js';

// Real-world shape: the <workbook> root declares xmlns:user, and a worksheet's level-members
// filter carries a user:-prefixed attribute (confirmed pattern, see refineWorksheet.test.ts).
// The declaration lives on the ancestor <workbook> element, not on <worksheet> itself.
const WORKBOOK_WITH_USER_NAMESPACE = `<?xml version='1.0' encoding='utf-8' ?>
<workbook original-version='18.1' source-build='0.0.0 (0000.26.0531.2046)' source-platform='mac' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <worksheets>
    <worksheet name='Sales by Region'>
      <table>
        <view>
          <filter class='categorical' column='[none:Region:nk]'>
            <groupfilter function='level-members' level='[none:Region:nk]' user:ui-enumeration='all' />
          </filter>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

describe('extractSheetXml', () => {
  it('finds and extracts an existing worksheet', () => {
    const xml = extractSheetXml(WORKBOOK_WITH_USER_NAMESPACE, 'Sales by Region');
    expect(xml).not.toBeNull();
    expect(xml).toContain('<worksheet');
    expect(xml).toContain('name="Sales by Region"');
  });

  it('returns null for a worksheet that does not exist', () => {
    expect(extractSheetXml(WORKBOOK_WITH_USER_NAMESPACE, 'Does Not Exist')).toBeNull();
  });

  // Live-bug regression (Tableau Desktop, get-worksheet-xml -> unmodified apply-worksheet):
  // extracting a <worksheet> subtree that uses a user:-prefixed attribute, out of a <workbook>
  // that declares xmlns:user only on its own root, must not strip the namespace declaration.
  // An untouched get -> apply round-trip must always pass the same well-formed-xml preflight
  // that apply-worksheet runs — a NamespaceError here is exactly the live failure mode.
  it('carries the xmlns:user declaration from the workbook root onto the extracted worksheet', () => {
    const xml = extractSheetXml(WORKBOOK_WITH_USER_NAMESPACE, 'Sales by Region');
    expect(xml).not.toBeNull();
    expect(xml).toContain('user:ui-enumeration');

    const issues = wellFormedXmlRule.validate(xml!);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('does not overwrite a namespace declaration the worksheet already carries itself', () => {
    const workbookWithConflict = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <worksheets>
    <worksheet name='q' xmlns:user='http://example.com/already-declared'>
      <table></table>
    </worksheet>
  </worksheets>
</workbook>`;
    const xml = extractSheetXml(workbookWithConflict, 'q');
    expect(xml).toContain('http://example.com/already-declared');
    expect(xml).not.toContain('http://www.tableausoftware.com/xml/user');
  });
});

describe('worksheetDocumentToFragment', () => {
  // The live per-sheet /document route returns a whole <workbook> carrying every sheet, not a bare
  // fragment. The helper must slice out only the requested sheet.
  const WORKBOOK_WITH_TWO_SHEETS = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <worksheets>
    <worksheet name='Sales by Region'><table /></worksheet>
    <worksheet name='Profit by Category'><table /></worksheet>
  </worksheets>
</workbook>`;

  it('slices the requested sheet out of a whole-workbook document, excluding siblings', () => {
    const xml = worksheetDocumentToFragment(WORKBOOK_WITH_TWO_SHEETS, 'Sales by Region');
    expect(xml).not.toBeNull();
    expect(xml).toContain('name="Sales by Region"');
    expect(xml).not.toContain('<workbook');
    expect(xml).not.toContain('Profit by Category');
  });

  it('returns a document that is already a bare <worksheet> fragment unchanged', () => {
    const fragment = '<worksheet name="Solo"><table /></worksheet>';
    expect(worksheetDocumentToFragment(fragment, 'Solo')).toBe(fragment);
  });

  it('returns null when the document contains no worksheet', () => {
    expect(
      worksheetDocumentToFragment('<workbook><worksheets /></workbook>', 'Missing'),
    ).toBeNull();
  });
});

describe('upsertSheetIntoWorkbook', () => {
  // The External Client API POST replaces the open workbook wholesale, so the posted doc must carry
  // the entire live workbook with only the target sheet swapped in — siblings and dashboards intact.
  const LIVE_WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>
  <worksheets>
    <worksheet name='Sheet 1'><table><old /></table></worksheet>
    <worksheet name='Sheet 2'><table /></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name='Dashboard 1'><zones /></dashboard>
  </dashboards>
</workbook>`;

  it('replaces the target sheet while preserving siblings and dashboards', () => {
    const edited = "<worksheet name='Sheet 1'><table><new /></table></worksheet>";
    const doc = upsertSheetIntoWorkbook(LIVE_WORKBOOK, 'Sheet 1', edited);

    expect(doc).toContain('<new');
    expect(doc).not.toContain('<old');
    expect(doc).toContain('name="Sheet 2"');
    expect(doc).toContain('name="Dashboard 1"');
    expect(listSheets(doc)).toEqual(['Sheet 1', 'Sheet 2']);
  });

  it('appends a brand-new sheet, keeping the existing ones', () => {
    const edited = "<worksheet name='Sheet 3'><table /></worksheet>";
    const doc = upsertSheetIntoWorkbook(LIVE_WORKBOOK, 'Sheet 3', edited);

    expect(listSheets(doc)).toEqual(['Sheet 1', 'Sheet 2', 'Sheet 3']);
    expect(doc).toContain('name="Dashboard 1"');
  });

  it('throws when the edited XML does not carry a <worksheet> with the given name', () => {
    const edited = "<worksheet name='Wrong'><table /></worksheet>";
    expect(() => upsertSheetIntoWorkbook(LIVE_WORKBOOK, 'Sheet 1', edited)).toThrow();
  });

  it('preserves whitespace-significant run text on an untouched sibling sheet', () => {
    // A single-sheet apply re-serializes the whole workbook. A sibling's formatted <run> text with
    // significant leading/trailing spaces must survive verbatim — trimming corrupts titles/tooltips.
    const workbook = `<?xml version='1.0' encoding='utf-8' ?>
<workbook>
  <worksheets>
    <worksheet name='Edited'><table><old /></table></worksheet>
    <worksheet name='Sibling'><table><formatted-text><run>Sales: </run><run>  $1.2M</run></formatted-text></table></worksheet>
  </worksheets>
</workbook>`;
    const edited = "<worksheet name='Edited'><table><new /></table></worksheet>";
    const doc = upsertSheetIntoWorkbook(workbook, 'Edited', edited);

    expect(doc).toContain('<run>Sales: </run>');
    expect(doc).toContain('<run>  $1.2M</run>');
  });
});

describe('listSheets', () => {
  it('lists worksheet names', () => {
    expect(listSheets(WORKBOOK_WITH_USER_NAMESPACE)).toEqual(['Sales by Region']);
  });
});

describe('addSheet / deleteSheet', () => {
  it('round-trips add then delete', () => {
    const added = addSheet(WORKBOOK_WITH_USER_NAMESPACE, 'New Sheet');
    expect(listSheets(added)).toContain('New Sheet');
    const deleted = deleteSheet(added, 'New Sheet');
    expect(listSheets(deleted)).not.toContain('New Sheet');
  });
});
