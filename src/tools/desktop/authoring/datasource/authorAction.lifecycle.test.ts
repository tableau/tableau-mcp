import invariant from '../../../../utils/invariant.js';
import {
  readWorkbookActions,
  removeWorkbookAction,
  WorkbookAction,
} from './authorActionLifecycle.js';
import {
  appliedDocumentXml,
  AuthorActionArgs,
  BASE_XML,
  DATASOURCE_NAME,
  getToolResult,
  withActions,
} from './authorActionTestFixtures.js';

const WORKBOOK = BASE_XML.replace('</worksheets>', "<worksheet name='Details' /></worksheets>");
const UNRELATED =
  "<action name='[Action3]' caption='Unrelated'><source type='sheet' worksheet='Profit' /><link expression='https://example.com/unrelated' /></action>";
const SOURCE = "<activation type='on-select' /><source type='sheet' worksheet='Profit' />";
const CASES: {
  mode: AuthorActionArgs['mode'];
  definition: string;
  args: Partial<AuthorActionArgs>;
}[] = [
  {
    mode: 'parameter',
    definition: `<edit-parameter-action name='[Action7]' caption='Original'>${SOURCE}<agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[${DATASOURCE_NAME}].[Profit]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>`,
    args: {
      sourceField: `[${DATASOURCE_NAME}].[Profit]`,
      targetParameter: '[Parameters].[Parameter 1]',
    },
  },
  {
    mode: 'set',
    definition: `<edit-group-action name='[Action7]' caption='Original'>${SOURCE}<add-or-remove-marks value='assign' /><params><param name='selection-clear-set-option' value='do-nothing' /><param name='target-group' value='[${DATASOURCE_NAME}].[Category Set]' /></params></edit-group-action>`,
    args: { targetSet: 'Category Set' },
  },
  {
    mode: 'url',
    definition: `<action name='[Action7]' caption='Original'>${SOURCE}<link caption='' expression='https://example.com/selected' /></action>`,
    args: { url: 'https://example.com/selected' },
  },
  {
    mode: 'filter',
    definition: `<action name='[Action7]' caption='Original'>${SOURCE}<command command='tsc:tsl-filter'><param name='special-fields' value='all' /><param name='target' value='Profit' /></command></action>`,
    args: { targetSheet: 'Profit' },
  },
  {
    mode: 'highlight',
    definition: `<action name='[Action7]' caption='Original'>${SOURCE.replace('<activation ', "<activation auto-clear='true' ")}<command command='tsc:brush'><param name='special-fields' value='all' /><param name='target' value='Profit' /></command></action>`,
    args: { targetSheet: 'Profit', clearSelection: 'show-all' },
  },
];

function actions(xml: string): WorkbookAction[] {
  const parsed = readWorkbookActions(xml);
  invariant(parsed.isOk());
  return parsed.value;
}

function receipt(
  result: Awaited<ReturnType<typeof getToolResult>>['result'],
): Record<string, unknown> {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('author-action edit/delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(CASES)(
    'replaces a $mode definition under the same internal name',
    async ({ mode, definition, args }) => {
      const replacement = definition
        .replace("worksheet='Profit'", "worksheet='Details'")
        .replace("type='on-select'", "type='on-hover'");
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Original',
          sourceWorksheet: 'Details',
          activation: 'on-hover',
          ...args,
        },
        initialXml: withActions(WORKBOOK, UNRELATED + definition),
        readbackXml: withActions(WORKBOOK, UNRELATED + replacement),
      });
      expect(result.isError).toBe(false);
      expect(receipt(result)).toMatchObject({ actionName: '[Action7]', caption: 'Original', mode });
      const submitted = actions(appliedDocumentXml(applyWorkbookDocument));
      expect(submitted.map((action) => action.name).sort()).toEqual(['[Action3]', '[Action7]']);
      expect(submitted.find((action) => action.name === '[Action3]')).toEqual(
        actions(withActions(WORKBOOK, UNRELATED))[0],
      );
      const edited = submitted.find((action) => action.name === '[Action7]');
      expect(edited?.xml).toContain('worksheet="Details"');
      expect(edited?.xml).toContain('type="on-hover"');
    },
  );

  it.each([
    ...CASES,
    {
      mode: 'navigation',
      definition:
        "<nav-action name='[Action7]' caption='Original'><source type='sheet' worksheet='Profit' /><target type='sheet' sheet='Details' /></nav-action>",
    },
  ])('deletes only the selected $mode action', async ({ definition }) => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { operation: 'delete', actionName: '[Action7]' },
      initialXml: withActions(WORKBOOK, UNRELATED + definition),
      readbackXml: withActions(WORKBOOK, UNRELATED),
    });
    expect(result.isError).toBe(false);
    expect(receipt(result)).toEqual({
      operation: 'delete',
      actionName: '[Action7]',
      caption: 'Original',
    });
    expect(actions(appliedDocumentXml(applyWorkbookDocument))).toEqual(
      actions(withActions(WORKBOOK, UNRELATED)),
    );
  });

  it('deletes the final action', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { operation: 'delete', actionName: '[Action3]' },
      initialXml: withActions(WORKBOOK, UNRELATED),
      readbackXml: WORKBOOK,
    });
    expect(result.isError).toBe(false);
    expect(actions(appliedDocumentXml(applyWorkbookDocument))).toEqual([]);
  });

  it('creates after the final action was deleted, preserving brushing settings', async () => {
    const empty = withActions(WORKBOOK, '').replace(
      '<actions></actions>',
      "<actions enable-brushing='false' />",
    );
    const definition = CASES[2].definition.replace('[Action7]', '[Action1]');
    const readbackXml = withActions(WORKBOOK, definition).replace(
      '<actions>',
      "<actions enable-brushing='false'>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Original',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: empty,
      readbackXml,
    });
    expect(result.isError).toBe(false);
    const submitted = appliedDocumentXml(applyWorkbookDocument);
    expect(submitted.match(/<actions\b/g)).toHaveLength(1);
    expect(submitted).toContain("enable-brushing='false'");
    expect(actions(submitted).map((action) => action.name)).toEqual(['[Action1]']);
  });

  it('changes the action mode while preserving its identity and family order', async () => {
    const replacement = CASES[2].definition
      .replace('[Action7]', '[Action3]')
      .replace('Original', 'Unrelated');
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action3]',
        mode: 'url',
        caption: 'Unrelated',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: withActions(
        WORKBOOK,
        CASES[0].definition +
          CASES[1].definition.replace('[Action7]', '[Action3]').replace('Original', 'Unrelated'),
      ),
      readbackXml: withActions(WORKBOOK, replacement + CASES[0].definition),
    });
    expect(result.isError).toBe(false);
    const submitted = actions(appliedDocumentXml(applyWorkbookDocument));
    expect(submitted.map((action) => action.name)).toEqual(['[Action3]', '[Action7]']);
    expect(submitted[0].xml).toContain('<action ');
    expect(submitted[1].xml).toContain('<edit-parameter-action ');
  });

  it('preserves shared field dependencies when deleting an action', async () => {
    const metadata = `<datasources><datasource name='${DATASOURCE_NAME}' /></datasources><datasource-dependencies datasource='${DATASOURCE_NAME}'><column name='[Profit]' datatype='real' /></datasource-dependencies>`;
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { operation: 'delete', actionName: '[Action7]' },
      initialXml: withActions(WORKBOOK, UNRELATED + metadata + CASES[0].definition),
      readbackXml: withActions(WORKBOOK, UNRELATED + metadata),
    });
    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(
      `datasource-dependencies datasource="${DATASOURCE_NAME}"`,
    );
  });

  it.each([
    { operation: 'edit', actionName: undefined },
    { operation: 'delete', actionName: '' },
    { operation: 'create', actionName: '[Action7]' },
    { operation: 'edit', actionName: '[Action7]', caption: undefined },
    { operation: 'edit', actionName: '[Action7]', sourceWorksheet: undefined },
  ] as const)('refuses invalid lifecycle arguments before applying: %j', async (overrides) => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'url',
        caption: 'Original',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
        ...overrides,
      },
    });
    expect(result.isError).toBe(true);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('lists available internal names when the selected action is absent', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: { operation: 'delete', actionName: 'Original' },
      initialXml: withActions(WORKBOOK, CASES[0].definition),
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('[Action7] (Original)') }),
      ]),
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a caption used by another action', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action7]',
        mode: 'url',
        caption: 'Unrelated',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/new',
      },
      initialXml: withActions(WORKBOOK, UNRELATED + CASES[2].definition),
    });
    expect(result.isError).toBe(true);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it.each(['retained', 'dropped sibling', 'renamed sibling'])(
    'rejects an unsuccessful delete readback: %s',
    async (failure) => {
      const initialXml = withActions(WORKBOOK, UNRELATED + CASES[0].definition);
      const readbackXml =
        failure === 'retained'
          ? initialXml
          : failure === 'dropped sibling'
            ? WORKBOOK
            : withActions(WORKBOOK, UNRELATED.replace('[Action3]', '[Action33]'));
      const { result } = await getToolResult({
        args: { operation: 'delete', actionName: '[Action7]' },
        initialXml,
        readbackXml,
      });
      expect(result.isError).toBe(true);
    },
  );

  it('does not accept an edit that landed under a new internal name', async () => {
    const { result } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action7]',
        mode: 'url',
        caption: 'Edited',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: withActions(WORKBOOK, CASES[2].definition),
      readbackXml: withActions(
        WORKBOOK,
        CASES[2].definition.replace('Original', 'Edited').replace('[Action7]', '[Action8]'),
      ),
    });
    expect(result.isError).toBe(true);
  });

  it.each(CASES)(
    'rejects stale $mode source/activation settings even when name, caption, and target match',
    async ({ mode, definition, args }) => {
      const initialXml = withActions(WORKBOOK, definition);
      const { result } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Original',
          sourceWorksheet: 'Details',
          activation: 'on-hover',
          ...args,
        },
        initialXml,
        readbackXml: initialXml,
      });
      expect(result.isError).toBe(true);
    },
  );

  it.each([
    {
      index: 0,
      overrides: { onClear: 'set-value', clearValue: 'Quarter' },
      stale: CASES[0].definition.replace(
        "type='do-nothing' value='s:LROOT:'",
        "type='assign-fixed-value' value='s:LROOT:Month'",
      ),
    },
    { index: 1, overrides: { setMembership: 'add' }, stale: CASES[1].definition },
    { index: 1, overrides: { clearSelection: 'show-all' }, stale: CASES[1].definition },
    { index: 1, overrides: { singleSelect: true }, stale: CASES[1].definition },
    { index: 2, overrides: { urlTarget: 'browser' }, stale: CASES[2].definition },
    {
      index: 2,
      overrides: { urlTarget: 'specific-zone', zoneId: '2' },
      stale: CASES[2].definition,
    },
    { index: 2, overrides: { urlEncode: true }, stale: CASES[2].definition },
  ] satisfies { index: number; overrides: Partial<AuthorActionArgs>; stale: string }[])(
    'rejects dropped mode-specific edit settings: $overrides',
    async ({ index, overrides, stale }) => {
      const { mode, definition, args } = CASES[index];
      const { result } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Original',
          sourceWorksheet: 'Profit',
          ...args,
          ...overrides,
        },
        initialXml: withActions(WORKBOOK, definition),
        readbackXml: withActions(WORKBOOK, stale),
      });
      expect(result.isError).toBe(true);
    },
  );
});

describe('workbook action selectors', () => {
  it('only considers direct children of the workbook actions block', () => {
    const nested =
      "<dashboards><dashboard name='D'><actions><action name='[Action3]' caption='Nested' /></actions></dashboard></dashboards>";
    const xml = withActions(
      WORKBOOK.replace('</workbook>', `${nested}</workbook>`),
      `<!-- <action name='[Action3]' /> -->${UNRELATED}`,
    );
    expect(actions(xml).map((action) => action.caption)).toEqual(['Unrelated']);
    const removed = removeWorkbookAction(xml, '[Action3]');
    invariant(removed.isOk());
    expect(removed.value.xml).toContain('caption="Nested"');
    expect(actions(removed.value.xml)).toEqual([]);
  });

  it('matches an entity-encoded internal name without interpreting the selector as markup', () => {
    const xml = withActions(WORKBOOK, UNRELATED.replace('[Action3]', '[Action&#51; &amp; x]'));
    const removed = removeWorkbookAction(xml, '[Action3 & x]');
    invariant(removed.isOk());
    expect(actions(removed.value.xml)).toEqual([]);
  });

  it.each([
    '<workbook><actions>',
    withActions(WORKBOOK, UNRELATED + UNRELATED),
    withActions(WORKBOOK, '<action />'),
    withActions(WORKBOOK, UNRELATED).replace('</workbook>', '<actions /></workbook>'),
  ])('rejects malformed or ambiguous action inventories', (xml) => {
    expect(readWorkbookActions(xml).isErr()).toBe(true);
    expect(removeWorkbookAction(xml, '[Action3]').isErr()).toBe(true);
  });
});
