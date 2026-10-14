import invariant from '../../../../utils/invariant.js';
import {
  appliedDocumentXml,
  buildWorkbookXml,
  DATASOURCE_CAPTION,
  DATASOURCE_NAME,
  getToolResult,
  withActions,
} from './authorActionTestFixtures.js';

// The workbooks the filter tests act on
const WORKSHEETS_ONLY = buildWorkbookXml({ worksheets: ['Profit', 'Details'] });
const DASHBOARD_WITHOUT_ZONES = buildWorkbookXml({
  worksheets: ['Profit', 'Details'],
  dashboards: [{ name: 'Overview' }],
});
const DASHBOARD_WITH_BOTH_SHEETS = buildWorkbookXml({
  worksheets: ['Profit', 'Details'],
  dashboards: [{ name: 'Overview', zones: ['Profit', 'Details'] }],
});
const DASHBOARD_WITH_TARGET_SHEET_ONLY = buildWorkbookXml({
  worksheets: ['Profit', 'Details'],
  dashboards: [{ name: 'Overview', zones: ['Details'] }],
});
const WORKSHEETS_WITH_FILTER_FIELDS = buildWorkbookXml({
  worksheets: ['Profit', 'Details'],
  fields: ['Profit', 'Category', 'Sub-Category'],
});
const DASHBOARD_WITH_FILTER_FIELDS = buildWorkbookXml({
  worksheets: ['Profit', 'Details'],
  dashboards: [{ name: 'Overview', zones: ['Profit', 'Details'] }],
  fields: ['Profit', 'Category', 'Sub-Category'],
});

const FILTER_DS_NAME = DATASOURCE_NAME;
const FILTER_DS_CAPTION = DATASOURCE_CAPTION;

// Builders for the action XML the tool is expected to emit (assertion targets, not workbook inputs).
const filterLink = (caption: string, expression: string): string =>
  `<link caption='${caption}' delimiter=',' escape='\\' expression='${expression}' include-null='true' multi-select='true' url-escape='true' />`;
const dependencyColumn = (field: string): string =>
  `<column datatype='string' name='[${field}]' role='dimension' type='nominal' />`;
const filterDependencyBlocks = (fields: string[]): string =>
  `<datasources><datasource caption='${FILTER_DS_CAPTION}' name='${FILTER_DS_NAME}' /></datasources>` +
  `<datasource-dependencies datasource='${FILTER_DS_NAME}'>${fields.map(dependencyColumn).join('')}</datasource-dependencies>`;

describe('authorActionTool (filter mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a byte-faithful all-fields filter action and verifies readback', async () => {
    const expectedAction =
      "<action caption='Filter to Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter to Details',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe('filter');
    expect(parsed.actionName).toBe('[Action1]');
    expect(parsed.target).toBe('Details');
    expect(parsed.targetSheet).toBe('Details');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).not.toContain('<edit-parameter-action');
    expect(loaded).not.toContain('<edit-group-action');
  });

  it.each([
    ['do-nothing', "<activation type='on-select' />", ''],
    ['show-all', "<activation auto-clear='true' type='on-select' />", ''],
    [
      'exclude-all',
      "<activation auto-clear='true' type='on-select' />",
      "<param name='on-empty' value='none' />",
    ],
  ] as const)(
    'maps clearSelection %s to the Desktop dialog activation/on-empty pair',
    async (clearSelection, expectedActivation, expectedOnEmpty) => {
      const expectedAction =
        "<action caption='Cross Filter' name='[Action1]'>" +
        expectedActivation +
        "<source type='sheet' worksheet='Profit' />" +
        "<command command='tsc:tsl-filter'>" +
        expectedOnEmpty +
        "<param name='special-fields' value='all' />" +
        "<param name='target' value='Details' /></command>" +
        '</action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'filter',
          caption: 'Cross Filter',
          sourceWorksheet: 'Profit',
          targetSheet: 'Details',
          clearSelection,
        },
        initialXml: WORKSHEETS_ONLY,
        readbackXml: withActions(WORKSHEETS_ONLY, expectedAction),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).clearSelection).toBe(clearSelection);
      expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
    },
  );

  it.each([
    ['on-hover', "<activation type='on-hover' />"],
    ['on-menu', '<activation />'],
  ] as const)(
    'honors the %s activation ("Action" setting) for filter actions',
    async (activation, activationXml) => {
      const expectedAction =
        "<action caption='Cross Filter' name='[Action1]'>" +
        activationXml +
        "<source type='sheet' worksheet='Profit' />" +
        "<command command='tsc:tsl-filter'>" +
        "<param name='special-fields' value='all' />" +
        "<param name='target' value='Details' /></command>" +
        '</action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'filter',
          caption: 'Cross Filter',
          sourceWorksheet: 'Profit',
          targetSheet: 'Details',
          activation,
        },
        initialXml: WORKSHEETS_ONLY,
        readbackXml: withActions(WORKSHEETS_ONLY, expectedAction),
      });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).activation).toBe(activation);
      expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
    },
  );

  it('emits single-select as a presence-only command param in alphabetical order and echoes it', async () => {
    const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='on-empty' value='none' />" +
      "<param name='single-select' value='' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceDashboard: 'Overview',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit'],
        clearSelection: 'exclude-all',
        singleSelect: true,
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).singleSelect).toBe(true);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('omits the single-select param for a multi-select (default) filter action', async () => {
    const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        singleSelect: false,
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).singleSelect).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).not.toContain('single-select');
    expect(loaded).toContain(expectedAction);
  });

  it('emits a tsl: <link> plus datasource-dependencies for a specific-field filter, never field-captions', async () => {
    const expectedAction =
      "<action caption='Filter Selected' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Filter Selected',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter Selected',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: WORKSHEETS_WITH_FILTER_FIELDS,
      readbackXml: withActions(WORKSHEETS_WITH_FILTER_FIELDS, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('fails readback when the specific-field datasource-dependencies are dropped', async () => {
    const survivingAction =
      "<action caption='Filter Selected' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Filter Selected',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter Selected',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: WORKSHEETS_WITH_FILTER_FIELDS,
      // <datasources>/<datasource-dependencies> for the filterFields are missing
      readbackXml: withActions(WORKSHEETS_WITH_FILTER_FIELDS, survivingAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails readback when a resolved dependency column is dropped', async () => {
    const survivingAction =
      "<action caption='Filter Selected' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Filter Selected',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter Selected',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: WORKSHEETS_WITH_FILTER_FIELDS,
      // Only the [Category] datasource dependency survives; [Sub-Category] is missing.
      readbackXml: withActions(
        WORKSHEETS_WITH_FILTER_FIELDS,
        survivingAction + filterDependencyBlocks(['Category']),
      ),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects a specific-field filter naming a field absent from the datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Bad Field',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Nonexistent'],
      },
      initialXml: WORKSHEETS_WITH_FILTER_FIELDS,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found in datasource');
    expect(result.content[0].text).toContain('Available fields:');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('escapes a field whose internal name has <, > and & like the SheetLink serializer', async () => {
    // '~s0' side is URL-escaped ([ ] < > & % -> %XX); the '~na' side doubles < -> << and > -> >> and
    // leaves & raw; then the whole tsl string is XML-escaped into the expression attribute.
    const expression =
      'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BA%20%3C%20B%20%3E%20C%20%26%20D%5D~s0=' +
      '&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[A &lt;&lt; B &gt;&gt; C &amp; D]~na&gt;';
    const ampColumn =
      "<column datatype='string' name='[A &lt; B &gt; C &amp; D]' role='dimension' type='nominal' />";
    const expectedBlocks =
      `<datasources><datasource caption='${FILTER_DS_CAPTION}' name='${FILTER_DS_NAME}' /></datasources>` +
      `<datasource-dependencies datasource='${FILTER_DS_NAME}'>${ampColumn}</datasource-dependencies>`;
    const expectedAction =
      "<action caption='Special Characters Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink('Special Characters Filter', expression) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const initialXml = buildWorkbookXml({
      worksheets: ['Profit', 'Details'],
      fields: ['Profit', 'Special Characters Field'],
    });
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Special Characters Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Special Characters Field'],
      },
      initialXml,
      readbackXml: withActions(initialXml, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
  });

  it('emits an exclude param and a dashboard-scoped source', async () => {
    const expectedAction =
      "<action caption='Dash Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Dash Filter',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('rejects exclusions against a dashboard that declares no worksheet zones', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'No Zones Exclude',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit'],
      },
      initialXml: DASHBOARD_WITHOUT_ZONES,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'dashboard "Overview" has no worksheet zones, so there are no sheets to exclude',
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('does not auto-scope or self-exclude a dashboard target that hosts the source', async () => {
    const expectedAction =
      "<action caption='External' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'External',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).not.toContain("<param name='exclude'");
    expect(loaded).not.toContain("dashboard='Overview'");
  });

  it('keeps a worksheet target as a worksheet action even when both sheets sit on a dashboard', async () => {
    const expectedAction =
      "<action caption='Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('Details');
    expect(parsed.targetSheet).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('keeps a self-filtering worksheet action on the worksheet, not its dashboard', async () => {
    const expectedAction =
      "<action caption='Self Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Self Filter',
        'tsl:Profit?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Profit' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Self Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Profit',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: DASHBOARD_WITH_FILTER_FIELDS,
      readbackXml: withActions(DASHBOARD_WITH_FILTER_FIELDS, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.target).toBe('Profit');
    expect(parsed.targetSheet).toBe('Profit');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
  });

  it('keeps field clauses for a dashboard self-filter (source dashboard equals the target)', async () => {
    const expectedAction =
      "<action caption='Category Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview' />" +
      filterLink(
        'Category Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Category Filter',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        filterFields: ['Category'],
      },
      initialXml: DASHBOARD_WITH_FILTER_FIELDS,
      readbackXml: withActions(DASHBOARD_WITH_FILTER_FIELDS, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('keeps field clauses when a viz-within-a-dashboard filters its own dashboard', async () => {
    const expectedAction =
      "<action caption='Region Cross Filter' name='[Action1]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      filterLink(
        'Region Cross Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='on-empty' value='none' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Region Cross Filter',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        filterFields: ['Category', 'Sub-Category'],
        excludeTargetSheets: ['Profit'],
        clearSelection: 'exclude-all',
      },
      initialXml: DASHBOARD_WITH_FILTER_FIELDS,
      readbackXml: withActions(DASHBOARD_WITH_FILTER_FIELDS, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('keeps the requested field list when a worksheet filters a dashboard target', async () => {
    const expectedAction =
      "<action caption='Dash Cross Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Dash Cross Filter',
        'tsl:Overview?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;&amp;%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category', 'Sub-Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Dash Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Overview',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: DASHBOARD_WITH_FILTER_FIELDS,
      readbackXml: withActions(DASHBOARD_WITH_FILTER_FIELDS, expectedAction + expectedBlocks),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    expect(loaded).not.toContain('field-captions');
    expect(loaded).not.toContain('special-fields');
  });

  it('honors a worksheet target even when sourceDashboard names the source dashboard', async () => {
    const expectedAction =
      "<action caption='Scoped Source' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Scoped Source',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).target).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('keeps a plain sheet-to-sheet filter a worksheet action', async () => {
    const expectedAction =
      "<action caption='Plain Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Plain Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_TARGET_SHEET_ONLY,
      readbackXml: withActions(DASHBOARD_WITH_TARGET_SHEET_ONLY, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).target).toBe('Details');
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  // twb_2026.2.0.xsd fixes the child order of <actions>: legacy <action> ->
  // <datasources>/<datasource-dependencies> -> <nav-action> -> <edit-group-action> (set)
  // -> <edit-parameter-action> (parameter). Adding a filter action to an
  // already-interactive workbook must slot the new legacy <action> ahead of any later
  // family rather than appending it before </actions>.
  it('inserts an all-fields filter ahead of existing set and parameter actions (XSD family order)', async () => {
    const existing =
      "<edit-group-action caption='Existing Set' name='[Action1]'></edit-group-action>" +
      "<edit-parameter-action caption='Existing Param' name='[Action2]'></edit-parameter-action>";
    const initialXml = withActions(WORKSHEETS_ONLY, existing);
    const added =
      "<action caption='Cross Filter' name='[Action3]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml,
      readbackXml: withActions(WORKSHEETS_ONLY, added + existing),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action3]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
    expect(loaded).toContain(added);
    const legacyAt = loaded.indexOf("<action caption='Cross Filter'");
    const groupAt = loaded.indexOf('<edit-group-action');
    const paramAt = loaded.indexOf('<edit-parameter-action');
    expect(legacyAt).toBeGreaterThanOrEqual(0);
    expect(legacyAt).toBeLessThan(groupAt);
    expect(groupAt).toBeLessThan(paramAt);
  });

  it('inserts a specific-field filter and its datasource metadata ahead of a parameter action (XSD family order)', async () => {
    const existingParam =
      "<edit-parameter-action caption='Existing Param' name='[Action1]'></edit-parameter-action>";
    const initialXml = withActions(WORKSHEETS_WITH_FILTER_FIELDS, existingParam);
    const expectedAction =
      "<action caption='Specific Cross Filter' name='[Action2]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Specific Cross Filter',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const expectedBlocks = filterDependencyBlocks(['Category']);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Specific Cross Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category'],
      },
      initialXml,
      readbackXml: withActions(
        WORKSHEETS_WITH_FILTER_FIELDS,
        expectedAction + expectedBlocks + existingParam,
      ),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
    expect(loaded).toContain(expectedAction);
    expect(loaded).toContain(expectedBlocks);
    // Search the datasource metadata from the in-<actions> legacy action so the top-level
    // <datasources> block does not satisfy the ordering check.
    const legacyAt = loaded.indexOf("<action caption='Specific Cross Filter'");
    const datasourcesAt = loaded.indexOf('<datasources>', legacyAt);
    const depsAt = loaded.indexOf('<datasource-dependencies', legacyAt);
    const paramAt = loaded.indexOf('<edit-parameter-action');
    expect(legacyAt).toBeGreaterThanOrEqual(0);
    expect(legacyAt).toBeLessThan(datasourcesAt);
    expect(datasourcesAt).toBeLessThan(depsAt);
    expect(depsAt).toBeLessThan(paramAt);
  });

  it('requires targetSheet in filter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'No Target',
        sourceWorksheet: 'Profit',
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetSheet is required in filter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a parameter target in filter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Mixed',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed in filter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a filter action with no source', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'No Source',
        sourceWorksheet: '',
        targetSheet: 'Details',
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('filter mode requires a source');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a targetSheet that is not a real sheet or dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Typo Target',
        sourceWorksheet: 'Profit',
        targetSheet: 'Detials',
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found');
    expect(result.content[0].text).toContain('Details');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a source worksheet that is not a real sheet', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Typo Source',
        sourceWorksheet: 'Proft',
        targetSheet: 'Details',
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceWorksheet "Proft" was not found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a source dashboard that is not a real dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Typo Source Dashboard',
        sourceWorksheet: '',
        sourceDashboard: 'Overvew',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceDashboard "Overvew" was not found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a worksheet that is not on the supplied source dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Unrelated Pair',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_TARGET_SHEET_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not on dashboard "Overview"');
    expect(result.content[0].text).toContain('Details');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a combined source when the source dashboard declares no zones', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Unverifiable Source',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITHOUT_ZONES,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'sourceDashboard "Overview" has no zones but sourceWorksheet "Profit" was passed.',
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('fails filter readback when the tsl-filter target is absent', async () => {
    const incompleteAction =
      "<action caption='Filter to Details' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'><param name='special-fields' value='all' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter to Details',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain("value='Details'");
  });

  it('fails readback when a specific-field filter is rewritten to all-fields (link dropped)', async () => {
    const rewritten =
      "<action caption='Filter Selected' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter Selected',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category', 'Sub-Category'],
      },
      initialXml: WORKSHEETS_WITH_FILTER_FIELDS,
      readbackXml: withActions(WORKSHEETS_WITH_FILTER_FIELDS, rewritten),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails readback when the source dashboard scope is dropped', async () => {
    const scopeDropped =
      "<action caption='Scoped' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Scoped',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, scopeDropped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails readback when the activation trigger is rewritten', async () => {
    const triggerRewritten =
      "<action caption='Hover Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Hover Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        activation: 'on-hover',
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, triggerRewritten),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails readback when the clearing behavior (auto-clear/on-empty) is dropped', async () => {
    const clearingDropped =
      "<action caption='Clear Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Clear Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        clearSelection: 'exclude-all',
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, clearingDropped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('fails readback when the target-sheet exclude opt-out is dropped', async () => {
    const excludeDropped =
      "<action caption='Excluded' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Excluded',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, excludeDropped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('emits <exclude-sheet> children in the source for a dashboard-scoped filter source', async () => {
    const expectedAction =
      "<action caption='Source Excludes' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview'>" +
      "<exclude-sheet name='Details' />" +
      '</source>' +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Source Excludes',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
        excludeSourceSheets: ['Details'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.excludeSourceSheets).toEqual(['Details']);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('emits independent source and target exclusions for a dashboard-to-dashboard cross filter', async () => {
    // Clicking marks on the source sheets (dashboard minus the target sheets) filters the target
    // sheets (dashboard minus the source sheets): source <exclude-sheet> children narrow the source,
    // the command `exclude` param narrows the target.
    const expectedAction =
      "<action caption='Filter by Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview'>" +
      "<exclude-sheet name='Details' />" +
      '</source>' +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Filter by Category',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeSourceSheets: ['Details'],
        excludeTargetSheets: ['Profit'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.excludeSourceSheets).toEqual(['Details']);
    expect(parsed.excludeTargetSheets).toEqual(['Profit']);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('passes readback when the target exclude list survives in a different order', async () => {
    // Authored as 'Profit,Details'; Tableau re-orders the comma list to 'Details,Profit' on save.
    // The exclude param is compared as a set, so the reordered readback still matches.
    const appliedAction =
      "<action caption='Reordered Excludes' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='exclude' value='Profit,Details' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Overview' /></command>" +
      '</action>';
    const reorderedReadback = appliedAction.replace(
      "<param name='exclude' value='Profit,Details' />",
      "<param name='exclude' value='Details,Profit' />",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Reordered Excludes',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit', 'Details'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, reorderedReadback),
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(appliedAction);
  });

  it('fails readback when the source-sheet exclude opt-out is dropped', async () => {
    const sourceExcludeDropped =
      "<action caption='Source Excludes' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' dashboard='Overview' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Source Excludes',
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
        excludeSourceSheets: ['Details'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
      readbackXml: withActions(DASHBOARD_WITH_BOTH_SHEETS, sourceExcludeDropped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects excludeSourceSheets when a worksheet source is present in filter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Bad Source Exclude',
        sourceWorksheet: 'Profit',
        sourceDashboard: 'Overview',
        targetSheet: 'Details',
        excludeSourceSheets: ['Details'],
      },
      initialXml: DASHBOARD_WITH_BOTH_SHEETS,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('excludeSourceSheets is only allowed');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an excludeTargetSheets entry that is not on the target dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Bad Target Exclude',
        sourceWorksheet: 'Details',
        targetSheet: 'Overview',
        excludeTargetSheets: ['Profit'],
      },
      initialXml: DASHBOARD_WITH_TARGET_SHEET_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'excluded sheet Profit is not on dashboard "Overview"',
    );
    expect(result.content[0].text).toContain(
      'Target must be a dashboard when there are excluded target sheets',
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects excludeTargetSheets when the target is a worksheet, not a dashboard', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Worksheet Target Exclude',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        excludeTargetSheets: ['Profit'],
      },
      initialXml: WORKSHEETS_ONLY,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      "'Details' is a worksheet, not a dashboard. Target must be a dashboard when there are excluded target sheets",
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('fails readback when single-select is dropped', async () => {
    const singleSelectDropped =
      "<action caption='Single Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Single Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        singleSelect: true,
      },
      initialXml: WORKSHEETS_ONLY,
      readbackXml: withActions(WORKSHEETS_ONLY, singleSelectDropped),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate filter action with the same source and target', async () => {
    const existing =
      "<action caption='Existing Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: withActions(WORKSHEETS_ONLY, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical filter action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('allows a second filter on the same source and target with different fields', async () => {
    const existing =
      "<action caption='Category Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Category Filter',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const initialXml = withActions(WORKSHEETS_WITH_FILTER_FIELDS, existing);
    const added =
      "<action caption='Sub-Category Filter' name='[Action2]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Sub-Category Filter',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BSub-Category%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Sub-Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'Sub-Category Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Sub-Category'],
      },
      initialXml,
      readbackXml: initialXml.replace(
        '</actions>',
        `${added}${filterDependencyBlocks(['Sub-Category'])}</actions>`,
      ),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate specific-field filter with the same fields', async () => {
    const existing =
      "<action caption='Category Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      filterLink(
        'Category Filter',
        'tsl:Details?%5Bfederated.1syzfv90anwuu119p4zra1ga299n%5D.%5BCategory%5D~s0=&lt;[federated.1syzfv90anwuu119p4zra1ga299n].[Category]~na&gt;',
      ) +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Category Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        filterFields: ['Category'],
      },
      initialXml: withActions(WORKSHEETS_WITH_FILTER_FIELDS, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical filter action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a duplicate filter action regardless of the stored attribute order', async () => {
    const existing =
      "<action name='[Action1]' caption='Existing Filter'>" +
      "<activation type='on-select' />" +
      "<source worksheet='Profit' type='sheet' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='target' value='Details' />" +
      "<param name='special-fields' value='all' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
      },
      initialXml: withActions(WORKSHEETS_ONLY, existing),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('identical filter action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('allows a filter that differs from an existing one only by activation trigger', async () => {
    const existing =
      "<action caption='Existing Filter' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const initialXml = withActions(WORKSHEETS_ONLY, existing);
    const added =
      "<action caption='New Filter' name='[Action2]'>" +
      "<activation type='on-hover' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        activation: 'on-hover',
      },
      initialXml,
      readbackXml: initialXml.replace('</actions>', `${added}</actions>`),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('allows a filter that differs from an existing one only by clearing behavior', async () => {
    const existing =
      "<action caption='Existing Filter' name='[Action1]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const initialXml = withActions(WORKSHEETS_ONLY, existing);
    const added =
      "<action caption='New Filter' name='[Action2]'>" +
      "<activation auto-clear='true' type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<command command='tsc:tsl-filter'>" +
      "<param name='on-empty' value='none' />" +
      "<param name='special-fields' value='all' />" +
      "<param name='target' value='Details' /></command>" +
      '</action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'filter',
        caption: 'New Filter',
        sourceWorksheet: 'Profit',
        targetSheet: 'Details',
        clearSelection: 'exclude-all',
      },
      initialXml,
      readbackXml: initialXml.replace('</actions>', `${added}</actions>`),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});
