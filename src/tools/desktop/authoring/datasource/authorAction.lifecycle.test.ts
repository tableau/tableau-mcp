import { z } from 'zod';

import {
  readWorkbookActions,
  WorkbookAction,
} from '../../../../desktop/metadata/workbookActions.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getAuthorActionTool } from './authorAction.js';
import { editedActionSettingsMatch, removeWorkbookAction } from './authorActionLifecycle.js';
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
    'requires an explicit edit mode through the registered schema for $mode actions',
    async ({ definition }) => {
      const tool = getAuthorActionTool(new DesktopMcpServer());
      const shape = await Provider.from(tool.paramsSchema);
      invariant(shape !== undefined);
      const args = z.object(shape).parse({
        operation: 'edit',
        actionName: '[Action7]',
        caption: 'Edited',
        sourceWorksheet: 'Profit',
        sourceField: `[${DATASOURCE_NAME}].[Profit]`,
        targetParameter: '[Parameters].[Parameter 1]',
      });
      const { result, applyWorkbookDocument } = await getToolResult({
        args,
        initialXml: withActions(WORKBOOK, UNRELATED + definition),
        readbackXml: withActions(
          WORKBOOK,
          UNRELATED + CASES[0].definition.replace('Original', 'Edited'),
        ),
      });
      expect(result.isError).toBe(true);
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('mode is required for edit');
    },
  );

  it.each([undefined, 'create'] as const)(
    'keeps the parameter mode default for create operation %s',
    async (operation) => {
      const tool = getAuthorActionTool(new DesktopMcpServer());
      const shape = await Provider.from(tool.paramsSchema);
      invariant(shape !== undefined);
      const args = z.object(shape).parse({
        operation,
        caption: 'Created',
        sourceWorksheet: 'Profit',
        sourceField: `[${DATASOURCE_NAME}].[Profit]`,
        targetParameter: '[Parameters].[Parameter 1]',
      });
      const { result, applyWorkbookDocument } = await getToolResult({
        args,
        initialXml: withActions(WORKBOOK, UNRELATED),
        readbackXml: withActions(
          WORKBOOK,
          UNRELATED +
            CASES[0].definition.replace('[Action7]', '[Action1]').replace('Original', 'Created'),
        ),
      });
      expect(result.isError).toBe(false);
      expect(receipt(result).mode).toBe('parameter');
      expect(
        actions(appliedDocumentXml(applyWorkbookDocument))
          .map((action) => action.name)
          .sort(),
      ).toEqual(['[Action1]', '[Action3]']);
    },
  );

  describe('on a Desktop build that keeps workbook actions on load', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function settle<T>(promise: Promise<T>): Promise<T> {
      let done = false;
      const wrapped = promise.finally(() => {
        done = true;
      });
      while (!done) await vi.advanceTimersByTimeAsync(300);
      return wrapped;
    }

    it('delete leaves all actions in place and says to remove it in Dashboard > Actions', async () => {
      const initialXml = withActions(WORKBOOK, UNRELATED + CASES[2].definition);
      const { result, applyWorkbookDocument } = await settle(
        getToolResult({
          args: { operation: 'delete', actionName: '[Action7]' },
          initialXml,
          readbackXml: initialXml,
          desktop: 'append',
        }),
      );
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('keeps workbook actions on load');
      expect(result.content[0].text).toContain('Dashboard > Actions');
      expect(result.content[0].text).toContain('Original');
      // The remaining action is carried, so the POST does not re-send it.
      expect(appliedDocumentXml(applyWorkbookDocument)).not.toContain('[Action3]');
    });

    it('create posts only the new action, not the live ones', async () => {
      const { result, applyWorkbookDocument } = await settle(
        getToolResult({
          args: {
            caption: 'Created',
            sourceWorksheet: 'Profit',
            sourceField: `[${DATASOURCE_NAME}].[Profit]`,
            targetParameter: '[Parameters].[Parameter 1]',
          },
          initialXml: withActions(WORKBOOK, UNRELATED),
          readbackXml: withActions(
            WORKBOOK,
            UNRELATED +
              CASES[0].definition.replace('[Action7]', '[Action1]').replace('Original', 'Created'),
          ),
          desktop: 'append',
        }),
      );
      expect(result.isError).toBe(false);
      expect(
        actions(appliedDocumentXml(applyWorkbookDocument)).map((action) => action.name),
      ).toEqual(['[Action1]']);
    });
  });

  describe.each(['missing', 'renamed', 'rewritten'] as const)(
    'failed edit recovery: %s',
    (failure) => {
      it.each(CASES)(
        'explains undo recovery for a $mode action',
        async ({ mode, definition, args }) => {
          const replacement = definition.replace('Original', 'Edited');
          const readback =
            failure === 'missing'
              ? ''
              : failure === 'renamed'
                ? replacement.replace('[Action7]', '[Action17]')
                : replacement.replace("worksheet='Profit'", "worksheet='Details'");
          const { result, applyWorkbookDocument } = await getToolResult({
            desktop: 'append',
            args: {
              operation: 'edit',
              actionName: '[Action7]',
              mode,
              caption: 'Edited',
              sourceWorksheet: 'Profit',
              ...args,
            },
            initialXml: withActions(WORKBOOK, UNRELATED + definition),
            readbackXml: withActions(WORKBOOK, UNRELATED + readback),
          });
          expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
          expect(result.isError).toBe(true);
          invariant(result.content[0].type === 'text');
          expect(result.content[0].text).toContain('edit failed verification');
          expect(result.content[0].text).toContain('[Action7]');
          expect(result.content[0].text).toContain(
            failure === 'rewritten' ? 'definition changed' : 'no longer present',
          );
          expect(result.content[0].text).toContain('Run undo-workbook in the same session');
          expect(result.content[0].text).toContain('restore the previous workbook before retrying');
          expect(result.content[0].text).not.toContain('Copies were added');
        },
      );
    },
  );

  it.each(CASES)(
    'preserves numeric disabled state for a $mode edit',
    async ({ mode, definition, args }) => {
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Edited',
          sourceWorksheet: 'Profit',
          ...args,
        },
        initialXml: withActions(
          WORKBOOK,
          UNRELATED + definition.replace(' name=', " enabled='0' name="),
        ),
        readbackXml: withActions(
          WORKBOOK,
          UNRELATED +
            definition.replace('Original', 'Edited').replace(' name=', " enabled='false' name="),
        ),
      });
      expect(result.isError).toBe(false);
      expect(
        actions(appliedDocumentXml(applyWorkbookDocument)).find(
          (action) => action.name === '[Action7]',
        )?.xml,
      ).toMatch(/enabled=['"]false['"]/);
    },
  );

  it.each(CASES)(
    'rejects numeric disabled state becoming enabled for a $mode edit',
    async ({ mode, definition, args }) => {
      const { result } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Edited',
          sourceWorksheet: 'Profit',
          ...args,
        },
        initialXml: withActions(WORKBOOK, definition.replace(' name=', " enabled='0' name=")),
        readbackXml: withActions(WORKBOOK, definition.replace('Original', 'Edited')),
      });
      expect(result.isError).toBe(true);
    },
  );

  it('preserves numeric disabled state across a set-to-URL mode change', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action7]',
        mode: 'url',
        caption: 'Edited',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: withActions(
        WORKBOOK,
        CASES[1].definition.replace(' name=', " enabled='0' name="),
      ),
      readbackXml: withActions(
        WORKBOOK,
        CASES[2].definition
          .replace('Original', 'Edited')
          .replace(' name=', " enabled='false' name="),
      ),
    });
    expect(result.isError).toBe(false);
    expect(actions(appliedDocumentXml(applyWorkbookDocument))[0].xml).toMatch(
      /enabled=['"]false['"]/,
    );
  });

  describe.each([undefined, 'create'] as const)('create operation %s', (operation) => {
    it.each([undefined, '', ' ', '\t\r\n '])(
      'accepts a cleared actionName (%j) as omitted',
      async (actionName) => {
        const created = CASES[2].definition.replace('[Action7]', '[Action1]');
        const { result, applyWorkbookDocument } = await getToolResult({
          args: {
            operation,
            actionName,
            mode: 'url',
            caption: 'Original',
            sourceWorksheet: 'Profit',
            url: 'https://example.com/selected',
          },
          initialXml: withActions(WORKBOOK, UNRELATED),
          readbackXml: withActions(WORKBOOK, UNRELATED + created),
        });
        expect(result.isError).toBe(false);
        expect(receipt(result)).toMatchObject({ actionName: '[Action1]', mode: 'url' });
        expect(
          actions(appliedDocumentXml(applyWorkbookDocument))
            .map((action) => action.name)
            .sort(),
        ).toEqual(['[Action1]', '[Action3]']);
      },
    );
  });

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

  it.each(CASES)(
    'preserves disabled state when editing a $mode action',
    async ({ mode, definition, args }) => {
      const disabled = definition.replace(' name=', " enabled='false' name=");
      const replacement = disabled.replace('Original', 'Edited');
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Edited',
          sourceWorksheet: 'Profit',
          ...args,
        },
        initialXml: withActions(WORKBOOK, UNRELATED + disabled),
        readbackXml: withActions(WORKBOOK, UNRELATED + replacement),
      });
      expect(result.isError).toBe(false);
      const submitted = actions(appliedDocumentXml(applyWorkbookDocument));
      expect(submitted.find((action) => action.name === '[Action7]')?.xml).toMatch(
        /enabled=['"]false['"]/,
      );
      expect(submitted.find((action) => action.name === '[Action3]')).toEqual(
        actions(withActions(WORKBOOK, UNRELATED))[0],
      );
    },
  );

  it.each(CASES)(
    'rejects a $mode edit readback that enabled a disabled action',
    async ({ mode, definition, args }) => {
      const { result } = await getToolResult({
        args: {
          operation: 'edit',
          actionName: '[Action7]',
          mode,
          caption: 'Edited',
          sourceWorksheet: 'Profit',
          ...args,
        },
        initialXml: withActions(WORKBOOK, definition.replace(' name=', " enabled='false' name=")),
        readbackXml: withActions(WORKBOOK, definition.replace('Original', 'Edited')),
      });
      expect(result.isError).toBe(true);
    },
  );

  it('accepts explicit enabled=true when Desktop saves the default enabled state', async () => {
    const definition = CASES[2].definition;
    const { result } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action7]',
        mode: 'url',
        caption: 'Edited',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: withActions(WORKBOOK, definition),
      readbackXml: withActions(
        WORKBOOK,
        definition.replace('Original', 'Edited').replace(' name=', " enabled='true' name="),
      ),
    });
    expect(result.isError).toBe(false);
  });

  describe.each(['create', 'edit'] as const)('URL %s duplicate detection', (operation) => {
    const variants = [
      {
        setting: 'hover trigger',
        args: { activation: 'on-hover' },
        from: "type='on-select'",
        to: "type='on-hover'",
      },
      {
        setting: 'menu trigger',
        args: { activation: 'on-menu' },
        from: "type='on-select'",
        to: '',
      },
      {
        setting: 'browser destination',
        args: { urlTarget: 'browser' },
        from: ' /></action>',
        to: '><url-action-type>browser</url-action-type></link></action>',
      },
      {
        setting: 'specific zone destination',
        args: { urlTarget: 'specific-zone', zoneId: '2' },
        from: ' /></action>',
        to: '><url-action-type>specific-zone</url-action-type><url-action-target>2</url-action-target></link></action>',
      },
      {
        setting: 'URL encoding',
        args: { urlEncode: true },
        from: "<link caption=''",
        to: "<link url-escape='true' caption=''",
      },
    ] satisfies { setting: string; args: Partial<AuthorActionArgs>; from: string; to: string }[];

    it.each(variants)(
      'allows the same URL with a different $setting',
      async ({ args, from, to }) => {
        const selectedName = operation === 'create' ? '[Action1]' : '[Action7]';
        const original = CASES[2].definition;
        const sibling = original.replace('[Action7]', '[Action8]').replace('Original', 'Sibling');
        const replacement = original
          .replace('[Action7]', selectedName)
          .replace('Original', 'Edited')
          .replace(from, to);
        const { result, applyWorkbookDocument } = await getToolResult({
          args: {
            operation,
            actionName: operation === 'edit' ? selectedName : undefined,
            mode: 'url',
            caption: 'Edited',
            sourceWorksheet: 'Profit',
            url: 'https://example.com/selected',
            ...args,
          },
          initialXml: withActions(WORKBOOK, sibling + (operation === 'edit' ? original : '')),
          readbackXml: withActions(WORKBOOK, sibling + replacement),
        });
        expect(result.isError).toBe(false);
        const submitted = actions(appliedDocumentXml(applyWorkbookDocument));
        expect(submitted.map((action) => action.name).sort()).toEqual(
          [selectedName, '[Action8]'].sort(),
        );
        expect(submitted.find((action) => action.name === '[Action8]')).toEqual(
          actions(withActions(WORKBOOK, sibling))[0],
        );
      },
    );

    it('allows the same URL with different source exclusions', async () => {
      const workbook = WORKBOOK.replace(
        '</workbook>',
        "<dashboards><dashboard name='D'><zones><zone name='Profit'/><zone name='Details'/></zones></dashboard></dashboards></workbook>",
      );
      const original = CASES[2].definition.replace("worksheet='Profit'", "dashboard='D'");
      const sibling = original
        .replace('[Action7]', '[Action8]')
        .replace('Original', 'Sibling')
        .replace("dashboard='D' />", "dashboard='D'><exclude-sheet name='Profit'/></source>");
      const selectedName = operation === 'create' ? '[Action1]' : '[Action7]';
      const replacement = original
        .replace('[Action7]', selectedName)
        .replace('Original', 'Edited')
        .replace("dashboard='D' />", "dashboard='D'><exclude-sheet name='Details'/></source>");
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          operation,
          actionName: operation === 'edit' ? selectedName : undefined,
          mode: 'url',
          caption: 'Edited',
          sourceWorksheet: '',
          sourceDashboard: 'D',
          excludeSourceSheets: ['Details'],
          url: 'https://example.com/selected',
        },
        initialXml: withActions(workbook, sibling + (operation === 'edit' ? original : '')),
        readbackXml: withActions(workbook, sibling + replacement),
      });
      expect(result.isError).toBe(false);
      const submitted = actions(appliedDocumentXml(applyWorkbookDocument));
      expect(submitted.find((action) => action.name === '[Action8]')).toEqual(
        actions(withActions(workbook, sibling))[0],
      );
      expect(submitted.find((action) => action.name === selectedName)?.xml).toContain(
        'name="Details"',
      );
    });

    it('still rejects an identical URL interaction before applying', async () => {
      const original = CASES[2].definition.replace(
        'https://example.com/selected',
        'https://example.com/other',
      );
      const sibling = CASES[2].definition
        .replace('[Action7]', '[Action8]')
        .replace('Original', 'Sibling');
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          operation,
          actionName: operation === 'edit' ? '[Action7]' : undefined,
          mode: 'url',
          caption: 'Edited',
          sourceWorksheet: 'Profit',
          url: 'https://example.com/selected',
        },
        initialXml: withActions(WORKBOOK, sibling + (operation === 'edit' ? original : '')),
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('identical URL action') }),
        ]),
      );
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    });
  });

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

  it('keeps a disabled action disabled when its mode changes', async () => {
    const disabled = CASES[1].definition.replace(' name=', " enabled='false' name=");
    const replacement = CASES[2].definition.replace(' name=', " enabled='false' name=");
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        operation: 'edit',
        actionName: '[Action7]',
        mode: 'url',
        caption: 'Original',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/selected',
      },
      initialXml: withActions(WORKBOOK, disabled),
      readbackXml: withActions(WORKBOOK, replacement),
    });
    expect(result.isError).toBe(false);
    expect(actions(appliedDocumentXml(applyWorkbookDocument))[0].xml).toMatch(
      /enabled=['"]false['"]/,
    );
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
    { operation: 'edit', actionName: ' \t\r\n ' },
    { operation: 'delete', actionName: '' },
    { operation: 'delete', actionName: ' \t\r\n ' },
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

  describe.each(['edit', 'delete'] as const)(
    '%s on a Desktop that appends actions',
    (operation) => {
      it.each(CASES)(
        'explains added copies and undo recovery for $mode actions',
        async ({ mode, definition, args }) => {
          const copiedSibling = UNRELATED.replace('[Action3]', '[Action13]');
          const copiedEdit = definition
            .replace('[Action7]', '[Action17]')
            .replace('Original', 'Edited');
          const { result, applyWorkbookDocument } = await getToolResult({
            desktop: 'append',
            args:
              operation === 'delete'
                ? { operation, actionName: '[Action7]' }
                : {
                    operation,
                    actionName: '[Action7]',
                    mode,
                    caption: 'Edited',
                    sourceWorksheet: 'Profit',
                    ...args,
                  },
            initialXml: withActions(WORKBOOK, UNRELATED + definition),
            readbackXml: withActions(
              WORKBOOK,
              UNRELATED + definition + copiedSibling + (operation === 'edit' ? copiedEdit : ''),
            ),
          });
          expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
          expect(result.isError).toBe(true);
          invariant(result.content[0].type === 'text');
          expect(result.content[0].text).toContain(
            'This Desktop build adds actions instead of replacing them.',
          );
          expect(result.content[0].text).toContain('Copies were added to the workbook.');
          expect(result.content[0].text).toContain('Run undo-workbook in the same session');
          expect(result.content[0].text).toContain(
            'use a Desktop build that supports replacing workbook actions before retrying',
          );
        },
      );

      it('does not diagnose added copies when an original name is absent', async () => {
        const definition = CASES[2].definition;
        const { result, applyWorkbookDocument } = await getToolResult({
          desktop: 'append',
          args:
            operation === 'delete'
              ? { operation, actionName: '[Action7]' }
              : {
                  operation,
                  actionName: '[Action7]',
                  mode: 'url',
                  caption: 'Edited',
                  sourceWorksheet: 'Profit',
                  url: 'https://example.com/selected',
                },
          initialXml: withActions(WORKBOOK, UNRELATED + definition),
          readbackXml: withActions(
            WORKBOOK,
            UNRELATED +
              UNRELATED.replace('[Action3]', '[Action13]') +
              definition.replace('[Action7]', '[Action17]'),
          ),
        });
        expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).not.toContain('Copies were added');
      });
    },
  );

  it('keeps creation readback failures separate from edit/delete compatibility errors', async () => {
    const definition = CASES[2].definition;
    const { result, applyWorkbookDocument } = await getToolResult({
      desktop: 'append',
      args: {
        mode: 'url',
        caption: 'New',
        sourceWorksheet: 'Profit',
        url: 'https://example.com/new',
      },
      initialXml: withActions(WORKBOOK, UNRELATED + definition),
      readbackXml: withActions(
        WORKBOOK,
        UNRELATED +
          definition +
          UNRELATED.replace('[Action3]', '[Action13]') +
          definition.replace('[Action7]', '[Action17]'),
      ),
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('Copies were added');
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
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('Copies were added');
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
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('Copies were added');
      expect(result.content[0].text).not.toContain('undo-workbook');
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

describe('XML boolean action settings', () => {
  it.each(['false', '0', ' false ', ' 0 '])('reads enabled=%j as disabled', (value) => {
    const xml = withActions(
      WORKBOOK,
      CASES[2].definition.replace(' name=', ` enabled='${value}' name=`),
    );
    expect(actions(xml)[0].enabled).toBe(false);
  });

  it.each(['true', '1', undefined])('reads enabled=%j as enabled', (value) => {
    const definition =
      value === undefined
        ? CASES[2].definition
        : CASES[2].definition.replace(' name=', ` enabled='${value}' name=`);
    expect(actions(withActions(WORKBOOK, definition))[0].enabled).toBe(true);
  });

  const booleanCases = [
    {
      mode: 'set',
      xml: CASES[1].definition.replace(
        '<add-or-remove-marks',
        "<single-select value='true'/><add-or-remove-marks",
      ),
    },
    { mode: 'URL', xml: CASES[2].definition.replace('<link ', "<link url-escape='true' ") },
    { mode: 'highlight', xml: CASES[4].definition },
  ];
  it.each(booleanCases)('accepts numeric true for $mode settings', ({ xml }) => {
    expect(editedActionSettingsMatch(xml.replaceAll("'true'", "'1'"), xml)).toBe(true);
  });
  it.each(booleanCases)('rejects numeric false for a true $mode setting', ({ xml }) => {
    expect(editedActionSettingsMatch(xml.replaceAll("'true'", "'0'"), xml)).toBe(false);
  });
});
