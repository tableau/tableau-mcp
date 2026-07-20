import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExecuteCommandArgs } from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAuthorActionTool } from './authorAction.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters'>",
  "<column caption='p.Period' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column>",
  '</datasource>',
  "<datasource name='Sample - Superstore'>",
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Profit' /></worksheets>",
  '</workbook>',
].join('');

describe('authorActionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the workbook-level <actions> block and splices an edit-parameter-action, verifying readback', async () => {
    const readbackXml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Set Period' name='[Action1]'><activation type='on-select' /><source type='sheet' worksheet='Profit' /><agg-type type='attr' /><clear-option type='do-nothing' value='s:LROOT:' /><params><param name='source-field' value='[Sample - Superstore].[:Measure Names]' /><param name='target-parameter' value='[Parameters].[Parameter 1]' /></params></edit-parameter-action>",
    );
    const { result, executeCommand } = await getToolResult({
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
    expect(parsed.targetParameter).toBe('[Parameters].[Parameter 1]');

    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    const loaded = loadCall.args.text;
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
      "<edit-parameter-action caption='Second' name='[Action2]'></edit-parameter-action></actions>",
    );
    const { result, executeCommand } = await getToolResult({
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
    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    // Only one <actions> block — appended, not duplicated.
    expect(loadCall.args.text.match(/<actions>/g)?.length).toBe(1);
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withActions(
      BASE_XML,
      "<edit-parameter-action caption='Dup' name='[Action1]'></edit-parameter-action>",
    );
    const { result, executeCommand } = await getToolResult({
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
    expect(
      commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata'),
    ).toBe(false);
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
  caption: string;
  sourceWorksheet: string;
  sourceField: string;
  targetParameter: string;
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
  executeCommand: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, readbackXml ?? initialXml];
  let saveCount = 0;
  const executeCommand = vi.fn(async (params: ExecuteCommandArgs<undefined>) => {
    if (params.command === 'save-underlying-metadata') {
      return new Ok({
        command_id: `save-${saveCount}`,
        status: 'completed',
        parsedResult: { text: documents[Math.min(saveCount++, documents.length - 1)] },
      });
    }
    return new Ok({ command_id: 'load-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({ executeCommand }),
  };
  const tool = getAuthorActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      activation: args.activation ?? 'on-select',
    },
    extra,
  );

  return { result, executeCommand };
}

function commandCalls(
  executeCommand: ReturnType<typeof vi.fn>,
): Array<ExecuteCommandArgs<undefined>> {
  return executeCommand.mock.calls.map(([call]) => call);
}
