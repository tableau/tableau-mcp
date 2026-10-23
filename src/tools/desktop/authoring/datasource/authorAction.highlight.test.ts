import invariant from '../../../../utils/invariant.js';
import {
  appliedDocumentXml,
  AuthorActionArgs,
  buildWorkbookXml,
  getToolResult,
  withActions,
} from './authorActionTestFixtures.js';

const WORKBOOK = buildWorkbookXml({
  worksheets: ['Profit', 'Details', 'Other'],
  dashboards: [{ name: 'Overview', zones: ['Profit', 'Details'] }],
  fields: ['Profit', 'Category', 'Sub-Category', 'Special Characters Field'],
});
const ARGS: AuthorActionArgs = {
  mode: 'highlight',
  caption: 'Highlight Details',
  sourceWorksheet: 'Profit',
  targetSheet: 'Details',
};
const ALL_FIELDS =
  "<action caption='Highlight Details' name='[Action1]'>" +
  "<activation auto-clear='true' type='on-select' /><source type='sheet' worksheet='Profit' />" +
  "<command command='tsc:brush'><param name='special-fields' value='all' />" +
  "<param name='target' value='Details' /></command></action>";
const SPECIFIC_FIELDS = ALL_FIELDS.replace(
  "<param name='special-fields' value='all' />",
  "<param name='field-captions' value='Category,Sub-Category' />",
);
const DASHBOARD_ACTION = ALL_FIELDS.replace(
  "<source type='sheet' worksheet='Profit' />",
  "<source type='sheet' dashboard='Overview'><exclude-sheet name='Profit' /></source>",
)
  .replace(
    "<param name='special-fields'",
    "<param name='exclude' value='Details' /><param name='special-fields'",
  )
  .replace("value='Details' /></command>", "value='Overview' /></command>");

function receipt(
  result: Awaited<ReturnType<typeof getToolResult>>['result'],
): Record<string, unknown> {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('author-action highlight mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authors an all-fields brush action and verifies its receipt', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: ARGS,
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, ALL_FIELDS),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(ALL_FIELDS);
    expect(receipt(result)).toMatchObject({
      mode: 'highlight',
      targetSheet: 'Details',
      sourceWorksheet: 'Profit',
      sourceDashboard: '',
      highlightBy: 'all-fields',
      highlightFields: [],
      clearSelection: 'show-all',
      activation: 'on-select',
    });
    expect(appliedDocumentXml(applyWorkbookDocument)).not.toContain('tsc:tsl-filter');
    expect(receipt(result).hint).toContain('This targets the standalone worksheet');
    expect(receipt(result).hint).toContain('target the dashboard and exclude the other sheets');
  });

  it.each([
    ['on-hover', "<activation auto-clear='true' type='on-hover' />"],
    ['on-menu', "<activation auto-clear='true' />"],
  ] as const)('supports %s activation', async (activation, xml) => {
    const action = ALL_FIELDS.replace("<activation auto-clear='true' type='on-select' />", xml);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, activation },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
    expect(receipt(result).activation).toBe(activation);
  });

  it('rejects missing auto-clear behavior for a tooltip-menu action', async () => {
    const { result } = await getToolResult({
      args: { ...ARGS, activation: 'on-menu' },
      initialXml: WORKBOOK,
      readbackXml: withActions(
        WORKBOOK,
        ALL_FIELDS.replace("<activation auto-clear='true' type='on-select' />", ''),
      ),
    });
    expect(result.isError).toBe(true);
  });

  it('restores all marks on clearing selection when requested', async () => {
    const action = ALL_FIELDS;
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, clearSelection: 'show-all' },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
    expect(receipt(result).clearSelection).toBe('show-all');
  });

  it('supports Dates and Times through special-fields=date-time', async () => {
    const action = ALL_FIELDS.replace("value='all'", "value='date-time'");
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, highlightBy: 'dates-and-times' },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
    expect(receipt(result).highlightBy).toBe('dates-and-times');
  });

  it('resolves bracketed names and emits captions without filter dependencies', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, highlightFields: ['[Category]', ' Sub-Category ', 'Category'] },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, SPECIFIC_FIELDS),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(SPECIFIC_FIELDS);
    expect(appliedDocumentXml(applyWorkbookDocument)).not.toContain('<datasource-dependencies');
    expect(receipt(result)).toMatchObject({
      highlightBy: 'selected-fields',
      highlightFields: ['Category', 'Sub-Category'],
    });
  });

  it('uses a field caption when its internal name differs and escapes XML', async () => {
    const action = ALL_FIELDS.replace(
      "name='special-fields' value='all'",
      "name='field-captions' value='Special Characters Field'",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, highlightFields: ['[A < B > C & D]'] },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
  });

  it.each([
    ['Details, West', 'Details, West'],
    ['Details\\West', 'Details\\West'],
    ['Details, A\\B & C', 'Details, A\\B &amp; C'],
  ])('keeps target %j raw while list-encoding field captions', async (target, targetXml) => {
    const workbook = WORKBOOK.replace(/Details/g, targetXml).replace(
      "caption='Category'",
      "caption='Category, A\\B &amp; C'",
    );
    const action = ALL_FIELDS.replace(
      "name='special-fields' value='all'",
      "name='field-captions' value='Category\\, A\\\\B &amp; C'",
    ).replace("value='Details'", `value='${targetXml}'`);
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, targetSheet: target, highlightFields: ['Category'] },
      initialXml: workbook,
      readbackXml: withActions(workbook, action),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
    expect(receipt(result).targetSheet).toBe(target);
    expect(receipt(result).highlightFields).toEqual(['Category, A\\B & C']);
  });

  it.each([
    ['Details, West', 'Details\\, West'],
    ['Details\\West', 'Details\\\\West'],
  ])('rejects a list-escaped target %j on readback', async (target, escapedTarget) => {
    const workbook = WORKBOOK.replace(/Details/g, target);
    const { result } = await getToolResult({
      args: { ...ARGS, targetSheet: target },
      initialXml: workbook,
      readbackXml: withActions(
        workbook,
        ALL_FIELDS.replace("value='Details'", `value='${escapedTarget}'`),
      ),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('requested highlight semantics');
  });

  it.each(['Details, West', 'Details\\West'])(
    'rejects an identical native action targeting %j before apply',
    async (target) => {
      const workbook = WORKBOOK.replace(/Details/g, target);
      const action = ALL_FIELDS.replace("value='Details'", `value='${target}'`);
      const { result, applyWorkbookDocument } = await getToolResult({
        args: { ...ARGS, caption: 'Another caption', targetSheet: target },
        initialXml: withActions(workbook, action),
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('identical highlight action');
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'Sample - Superstore'])(
    'prefers an exact caption over another field internal name with datasource %s',
    async (datasource) => {
      const workbook = WORKBOOK.replace(
        "caption='Category' datatype='string' name='[Category]'",
        "caption='Category' datatype='string' name='[Calculation_1]'",
      ).replace(
        "caption='Sub-Category' datatype='string' name='[Sub-Category]'",
        "caption='Location' datatype='string' name='[Category]'",
      );
      const action = ALL_FIELDS.replace(
        "name='special-fields' value='all'",
        "name='field-captions' value='Category'",
      );
      const { result, applyWorkbookDocument } = await getToolResult({
        args: { ...ARGS, datasource, highlightFields: ['Category'] },
        initialXml: workbook,
        readbackXml: withActions(workbook, action),
      });
      expect(result.isError).toBe(false);
      expect(appliedDocumentXml(applyWorkbookDocument)).toContain(action);
      expect(receipt(result).highlightFields).toEqual(['Category']);
    },
  );

  it('prefers a literal bracketed caption before interpreting a field reference', async () => {
    const workbook = WORKBOOK.replace(
      "caption='Category' datatype='string' name='[Category]'",
      "caption='[Category]' datatype='string' name='[Calculation_1]'",
    ).replace(
      "caption='Sub-Category' datatype='string' name='[Sub-Category]'",
      "caption='Location' datatype='string' name='[Category]'",
    );
    const action = ALL_FIELDS.replace(
      "name='special-fields' value='all'",
      "name='field-captions' value='[Category]'",
    );
    const { result } = await getToolResult({
      args: { ...ARGS, highlightFields: ['[Category]'] },
      initialXml: workbook,
      readbackXml: withActions(workbook, action),
    });
    expect(result.isError).toBe(false);
    expect(receipt(result).highlightFields).toEqual(['[Category]']);
  });

  it('keeps source and target dashboard exclusions independent', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        ...ARGS,
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeSourceSheets: ['Profit'],
        excludeTargetSheets: ['Details'],
      },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, DASHBOARD_ACTION),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(DASHBOARD_ACTION);
    expect(receipt(result)).toMatchObject({
      excludeSourceSheets: ['Profit'],
      excludeTargetSheets: ['Details'],
    });
  });

  it('treats an omitted sourceWorksheet like an empty one for a dashboard-only create', async () => {
    const run = async (
      sourceWorksheet: string | undefined,
    ): Promise<{
      result: Awaited<ReturnType<typeof getToolResult>>['result'];
      applied: string;
    }> => {
      const args = { ...ARGS, sourceWorksheet, sourceDashboard: 'Overview' };
      // The first pass captures the applied document; the second feeds it back as the readback.
      const probe = await getToolResult({ args, initialXml: WORKBOOK });
      const applied = appliedDocumentXml(probe.applyWorkbookDocument);
      const { result } = await getToolResult({ args, initialXml: WORKBOOK, readbackXml: applied });
      return { result, applied };
    };
    const empty = await run('');
    const omitted = await run(undefined);

    expect(omitted.result.isError).toBe(false);
    expect(omitted.applied).toBe(empty.applied);
    expect(omitted.applied).toContain("dashboard='Overview'");
    expect(omitted.applied).not.toContain("worksheet='Profit' dashboard");
  });

  it('supports a worksheet on a dashboard targeting a standalone sheet', async () => {
    const action = ALL_FIELDS.replace(
      "worksheet='Profit'",
      "worksheet='Profit' dashboard='Overview'",
    );
    const { result } = await getToolResult({
      args: { ...ARGS, sourceDashboard: 'Overview' },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(false);
    expect(receipt(result).targetSheet).toBe('Details');
  });

  it.each([
    [{ targetSheet: undefined }, 'targetSheet is required'],
    [{ sourceWorksheet: '' }, 'requires a source'],
    [{ sourceWorksheet: 'Missing' }, 'was not found'],
    [{ sourceWorksheet: '', sourceDashboard: 'Missing' }, 'was not found'],
    [{ sourceWorksheet: 'Overview' }, 'is a dashboard'],
    [{ sourceDashboard: 'Profit' }, 'is a worksheet'],
    [{ targetSheet: 'Missing' }, 'was not found'],
    [{ sourceWorksheet: 'Other', sourceDashboard: 'Overview' }, 'is not on dashboard'],
    [{ excludeSourceSheets: ['Profit'] }, 'dashboard-only source'],
    [
      { sourceWorksheet: '', sourceDashboard: 'Overview', excludeSourceSheets: ['Other'] },
      'not on dashboard',
    ],
    [{ excludeTargetSheets: ['Profit'] }, 'Target must be a dashboard'],
    [{ targetSheet: 'Overview', excludeTargetSheets: ['Other'] }, 'not on dashboard'],
    [{ highlightFields: ['Missing'] }, 'Available fields'],
    [{ highlightFields: [] }, 'nonempty field names'],
    [{ highlightFields: [' '] }, 'nonempty field names'],
    [{ highlightFields: ['Category'], highlightBy: 'all-fields' }, 'mutually exclusive'],
    [{ clearSelection: 'exclude-all' }, 'only clearSelection show-all'],
    [{ clearSelection: 'do-nothing' }, 'only clearSelection show-all'],
    [{ targetParameter: '[Parameters].[Parameter 1]' }, 'not allowed'],
    [{ targetSet: 'Category Set' }, 'not allowed'],
    [{ url: 'https://example.com' }, 'not allowed'],
    [{ filterFields: ['Category'] }, 'not allowed'],
    [{ singleSelect: true }, 'not allowed'],
    [{ sourceField: 'Category' }, 'not allowed'],
    [{ urlEncode: true }, 'not allowed'],
    [{ mode: 'filter', highlightFields: ['Category'] }, 'only allowed in highlight mode'],
  ] satisfies [Partial<AuthorActionArgs>, string][])(
    'rejects %j before apply',
    async (overrides, message) => {
      const { result, applyWorkbookDocument } = await getToolResult({
        args: { ...ARGS, ...overrides },
        initialXml: WORKBOOK,
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain(message);
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['command', SPECIFIC_FIELDS.replace('tsc:brush', 'tsc:tsl-filter')],
    ['source', SPECIFIC_FIELDS.replace("worksheet='Profit'", "worksheet='Other'")],
    ['activation', SPECIFIC_FIELDS.replace('on-select', 'on-hover')],
    ['clearing', SPECIFIC_FIELDS.replace("auto-clear='true' ", '')],
    ['target', SPECIFIC_FIELDS.replace("value='Details'", "value='Profit'")],
    ['fields', SPECIFIC_FIELDS.replace('Category,Sub-Category', 'Category')],
    ['all-fields rewrite', ALL_FIELDS],
    [
      'disabled brushing',
      SPECIFIC_FIELDS.replace('</command>', "<param name='should-brush' value='off' /></command>"),
    ],
  ])('fails readback when Desktop changes %s', async (_setting, action) => {
    const { result } = await getToolResult({
      args: { ...ARGS, highlightFields: ['Category', 'Sub-Category'] },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('requested highlight semantics');
  });

  it.each([
    DASHBOARD_ACTION.replace("<exclude-sheet name='Profit' />", ''),
    DASHBOARD_ACTION.replace("<param name='exclude' value='Details' />", ''),
  ])('fails readback when an exclusion is dropped', async (action) => {
    const { result } = await getToolResult({
      args: {
        ...ARGS,
        sourceWorksheet: '',
        sourceDashboard: 'Overview',
        targetSheet: 'Overview',
        excludeSourceSheets: ['Profit'],
        excludeTargetSheets: ['Details'],
      },
      initialXml: WORKBOOK,
      readbackXml: withActions(WORKBOOK, action),
    });
    expect(result.isError).toBe(true);
  });

  it('rejects an identical retry even under a different caption and reordered fields', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, caption: 'Another caption', highlightFields: ['Sub-Category', 'Category'] },
      initialXml: withActions(WORKBOOK, SPECIFIC_FIELDS),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('identical highlight action');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('accepts reordered field captions on readback', async () => {
    const { result } = await getToolResult({
      args: { ...ARGS, highlightFields: ['Category', 'Sub-Category'] },
      initialXml: WORKBOOK,
      readbackXml: withActions(
        WORKBOOK,
        SPECIFIC_FIELDS.replace('Category,Sub-Category', 'Sub-Category,Category'),
      ),
    });
    expect(result.isError).toBe(false);
  });

  it('rejects ambiguous field names and supports explicit datasource recovery', async () => {
    const workbook = WORKBOOK.replace("caption='Category'", "caption='Primary category'").replace(
      '</datasources>',
      "<datasource caption='Other data' name='other'><column caption='Other category' name='[Category]' datatype='string' role='dimension' type='nominal' /></datasource></datasources>",
    );
    const args = { ...ARGS, highlightFields: ['Category'] };
    const rejected = await getToolResult({ args, initialXml: workbook });
    expect(rejected.result.isError).toBe(true);
    expect(JSON.stringify(rejected.result)).toContain('is ambiguous; pass datasource');
    expect(rejected.applyWorkbookDocument).not.toHaveBeenCalled();
    const action = ALL_FIELDS.replace(
      "name='special-fields' value='all'",
      "name='field-captions' value='Primary category'",
    );
    const accepted = await getToolResult({
      args: { ...args, datasource: 'Sample - Superstore' },
      initialXml: workbook,
      readbackXml: withActions(workbook, action),
    });
    expect(accepted.result.isError).toBe(false);
    expect(receipt(accepted.result).highlightFields).toEqual(['Primary category']);
  });

  it('allows distinct activation on the same source, target, and fields', async () => {
    const second = ALL_FIELDS.replace('Highlight Details', 'Hover Details')
      .replace('[Action1]', '[Action2]')
      .replace('on-select', 'on-hover');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { ...ARGS, caption: 'Hover Details', activation: 'on-hover' },
      initialXml: withActions(WORKBOOK, ALL_FIELDS),
      readbackXml: withActions(WORKBOOK, ALL_FIELDS + second),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(ALL_FIELDS + second);
  });

  it('inserts highlight before later action families and preserves them', async () => {
    const existing =
      "<datasources><datasource name='existing' /></datasources>" +
      "<nav-action caption='Navigate' name='[Nav1]' />" +
      "<edit-group-action caption='Set' name='[Set1]' />" +
      "<edit-parameter-action caption='Parameter' name='[Parameter1]' />";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: ARGS,
      initialXml: withActions(WORKBOOK, existing),
      readbackXml: withActions(WORKBOOK, ALL_FIELDS + existing),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(
      `<actions>${ALL_FIELDS}${existing}</actions>`,
    );
  });
});
