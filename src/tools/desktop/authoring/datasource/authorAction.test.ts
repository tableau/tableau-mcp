import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAuthorActionTool } from './authorAction.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters'>",
  "<column caption='p.Period' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column>",
  '</datasource>',
  "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  "<group caption='Category Set' name='[Category Set]' user:ui-builder='filter-group' />",
  "<group caption='Ad Hoc Group' name='[Ad Hoc Group]' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Profit' /></worksheets>",
  '</workbook>',
].join('');

describe('authorActionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describes datasource selection as name or unique caption', async () => {
    const tool = getAuthorActionTool(new DesktopMcpServer());
    const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<
      string,
      { description?: string }
    >;

    expect(paramsSchema['datasource']?.description).toBe('Top-level name/unique caption.');
  });

  it('creates the workbook-level <actions> block and splices an edit-parameter-action, verifying readback', async () => {
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Sample - Superstore].[:Measure Names]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Sample - Superstore].[:Measure Names]',
        targetParameter: '[Parameters].[Parameter 1]',
        activation: 'on-select',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.actionName).toBe('[Action1]');
    expect(parsed.caption).toBe('Set Period');
    expect(parsed.mode).toBe('parameter');
    expect(parsed.target).toBe('[Parameters].[Parameter 1]');
    expect(parsed.targetParameter).toBe('[Parameters].[Parameter 1]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    // <actions> block created between </datasources> and <worksheets>.
    const dsClose = loaded.indexOf('</datasources>');
    const actionsAt = loaded.indexOf('<actions>');
    const wsAt = loaded.indexOf('<worksheets>');
    expect(dsClose).toBeLessThan(actionsAt);
    expect(actionsAt).toBeLessThan(wsAt);
    expect(loaded).toContain("<edit-parameter-action caption='Set Period' name='[Action1]'>");
    expect(loaded).toContain(
      "<param name='target-parameter' value='[Parameters].[Parameter 1]' />",
    );
  });

  it('appends into an existing <actions> block with a fresh action name', async () => {
    const withOne = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Existing' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const readbackXml = withOne.replace(
      '</actions>',
      "<edit-parameter-action caption='Second' name='[Action2]'><params><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action></actions>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Second',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: withOne,
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).actionName).toBe('[Action2]');
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    // Only one <actions> block — appended, not duplicated.
    expect(loaded.match(/<actions>/g)?.length).toBe(1);
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Dup' name='[Action1]'></edit-parameter-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Dup',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      initialXml: xml,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('detects caption collisions with edit-group-action elements', async () => {
    const xml = withActions(
      BASE_XML,
      "<edit-group-action caption='Dup' name='[Action1]'></edit-group-action>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Dup',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
      },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('emits a byte-faithful set action with children in XSD order', async () => {
    const expectedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<single-select value='true' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
        singleSelect: true,
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe('set');
    expect(parsed.target).toBe('[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]');
    expect(parsed.targetSet).toBe('[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]');

    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain(expectedAction);
    const activationAt = loaded.indexOf("<activation type='on-select' />");
    const sourceAt = loaded.indexOf("<source type='sheet' worksheet='Profit' />");
    const singleAt = loaded.indexOf("<single-select value='true' />");
    const membershipAt = loaded.indexOf("<add-or-remove-marks value='assign' />");
    const paramsAt = loaded.indexOf('<params>', membershipAt);
    expect(activationAt).toBeLessThan(sourceAt);
    expect(sourceAt).toBeLessThan(singleAt);
    expect(singleAt).toBeLessThan(membershipAt);
    expect(membershipAt).toBeLessThan(paramsAt);
  });

  it('resolves a unique datasource caption to the internal set target', async () => {
    const expectedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Sample - Superstore',
      },
      readbackXml: withActions(BASE_XML, expectedAction),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).targetSet).toBe(
      '[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]',
    );
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(expectedAction);
  });

  it('rejects a duplicate datasource caption before applying a set action', async () => {
    const duplicateCaptionXml = BASE_XML.replace(
      '</datasources>',
      "<datasource caption='Sample - Superstore' name='federated.duplicate'></datasource></datasources>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Sample - Superstore',
      },
      initialXml: duplicateCaptionXml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('federated.1syzfv90anwuu119p4zra1ga299n');
    expect(result.content[0].text).toContain('federated.duplicate');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('accepts set-action readback when Desktop backfills single-select', async () => {
    const normalizedAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' />" +
      "<source type='sheet' worksheet='Profit' />" +
      "<single-select value='false' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
      },
      readbackXml: withActions(BASE_XML, normalizedAction),
    });

    expect(result.isError).toBe(false);
  });

  it.each([
    ['assign', 'do-nothing'],
    ['add', 'show-all'],
    ['remove', 'exclude-all'],
  ] as const)(
    'emits set membership %s and clear selection %s in Tableau wire vocabulary',
    async (setMembership, clearSelection) => {
      const expectedAction =
        "<edit-group-action caption='Map Options' name='[Action1]'>" +
        "<activation type='on-select' />" +
        "<source type='sheet' worksheet='Profit' />" +
        `<add-or-remove-marks value='${setMembership}' />` +
        `<params><param name='selection-clear-set-option' value='${clearSelection}' />` +
        "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
        '</edit-group-action>';
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'set',
          caption: 'Map Options',
          sourceWorksheet: 'Profit',
          sourceField: '',
          targetSet: '[Category Set]',
          setMembership,
          clearSelection,
        },
        readbackXml: withActions(BASE_XML, expectedAction),
      });

      expect(result.isError).toBe(false);
      const loaded = appliedDocumentXml(applyWorkbookDocument);
      expect(loaded).toContain(`<add-or-remove-marks value='${setMembership}' />`);
      expect(loaded).toContain(
        `<param name='selection-clear-set-option' value='${clearSelection}' />`,
      );
    },
  );

  it('rejects a missing targetSet and names available sets', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetSet');
    expect(result.content[0].text).toContain('Category Set');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('ignores non-set groups during target resolution and suggestions', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Group',
        sourceWorksheet: 'Profit',
        targetSet: 'Ad Hoc Group',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Category Set');
    expect(result.content[0].text).not.toContain('Ad Hoc Group (');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('does not parse datasource-dependencies as a datasource', async () => {
    const xml = BASE_XML.replace(
      '</datasource>',
      "<datasource-dependencies name='phantom'><group caption='Phantom Set' name='[Phantom Set]' user:ui-builder='filter-group' /></datasource-dependencies></datasource>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Phantom',
        sourceWorksheet: 'Profit',
        targetSet: 'Phantom Set',
        datasource: 'phantom',
      },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Datasource "phantom" was not found');
    expect(result.content[0].text).not.toContain('Candidates: phantom');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('reports when a datasource filter matches no datasource', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        datasource: 'Missing Datasource',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Datasource "Missing Datasource" was not found');
    expect(result.content[0].text).toContain('federated.1syzfv90anwuu119p4zra1ga299n');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an unqualified targetParameter with recovery guidance', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: 'Parameter 1',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('[Parameters].[X]');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('requires sourceField in parameter mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceField is required in parameter mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects mode-incompatible targets', async () => {
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('targetParameter');
  });

  it('treats a blank targetParameter as absent in set mode', async () => {
    const action =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' />" +
      "<param name='target-group' value='[federated.1syzfv90anwuu119p4zra1ga299n].[Category Set]' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        targetSet: 'Category Set',
        targetParameter: '   ',
      },
      readbackXml: withActions(BASE_XML, action),
    });

    expect(result.isError).toBe(false);
  });

  it('treats a blank targetSet as absent in parameter mode', async () => {
    const action =
      "<edit-parameter-action caption='Set Period' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' />" +
      "<params><param name='source-field' value='[Profit]' />" +
      "<param name='target-parameter' value='[Parameters].[Parameter 1]' /></params>" +
      '</edit-parameter-action>';
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '[Profit]',
        targetParameter: '[Parameters].[Parameter 1]',
        targetSet: '\t ',
      },
      readbackXml: withActions(BASE_XML, action),
    });

    expect(result.isError).toBe(false);
  });

  it('fails set-action readback when the target-group param is absent', async () => {
    const incompleteAction =
      "<edit-group-action caption='Expand Category' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<add-or-remove-marks value='assign' />" +
      "<params><param name='selection-clear-set-option' value='do-nothing' /></params>" +
      '</edit-group-action>';
    const { result } = await getToolResult({
      args: {
        mode: 'set',
        caption: 'Expand Category',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetSet: 'Category Set',
      },
      readbackXml: withActions(BASE_XML, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target-group');
  });

  it('fails parameter-action readback when the target-parameter param is absent', async () => {
    const incompleteAction =
      "<edit-parameter-action caption='Set Period' name='[Action1]'>" +
      "<activation type='on-select' /><source type='sheet' worksheet='Profit' />" +
      "<agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' />" +
      '<params></params></edit-parameter-action>';
    const { result } = await getToolResult({
      args: {
        caption: 'Set Period',
        sourceWorksheet: 'Profit',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
      readbackXml: withActions(BASE_XML, incompleteAction),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target-parameter');
  });

  it('rejects empty required primitives', async () => {
    const { result } = await getToolResult({
      args: {
        caption: 'X',
        sourceWorksheet: '',
        sourceField: '',
        targetParameter: '[Parameters].[Parameter 1]',
      },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('sourceWorksheet empty');
  });
});

function withActions(baseXml: string, actionXml: string): string {
  const dsClose = baseXml.indexOf('</datasources>') + '</datasources>'.length;
  return baseXml.slice(0, dsClose) + `<actions>${actionXml}</actions>` + baseXml.slice(dsClose);
}

type AuthorActionArgs = {
  session?: string;
  mode?: 'parameter' | 'set';
  caption: string;
  sourceWorksheet: string;
  sourceField?: string;
  targetParameter?: string;
  targetSet?: string;
  datasource?: string;
  setMembership?: 'assign' | 'add' | 'remove';
  clearSelection?: 'do-nothing' | 'show-all' | 'exclude-all';
  singleSelect?: boolean;
  activation?: 'on-select' | 'on-hover' | 'on-menu';
};

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: AuthorActionArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, initialXml, readbackXml ?? initialXml];
  let readCount = 0;
  const executeCommand = vi
    .fn()
    .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null }));
  const getWorkbookDocument = vi.fn(async () => {
    return new Ok({
      xml: documents[Math.min(readCount++, documents.length - 1)],
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    });
  });
  const applyWorkbookDocument = vi.fn(async () => {
    return new Ok({ command_id: 'apply-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({
      executeCommand,
      getWorkbookDocument,
      applyWorkbookDocument,
    }),
  };
  const tool = getAuthorActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      mode: args.mode ?? 'parameter',
      sourceField: args.sourceField,
      targetParameter: args.targetParameter,
      targetSet: args.targetSet,
      datasource: args.datasource,
      singleSelect: args.singleSelect,
      activation: args.activation ?? 'on-select',
      setMembership: args.setMembership ?? 'assign',
      clearSelection: args.clearSelection ?? 'do-nothing',
    },
    extra,
  );

  return { result, applyWorkbookDocument };
}

function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const [xml] = applyWorkbookDocument.mock.calls[0] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}
