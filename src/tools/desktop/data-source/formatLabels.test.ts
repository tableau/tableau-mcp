import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExecuteCommandArgs } from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getFormatLabelsTool } from './formatLabels.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources><datasource name="Sample - Superstore" /></datasources>',
  '<worksheets>',
  "<worksheet name='Profit'>",
  '<table>',
  '<style />',
  '<panes>',
  "<pane selection-relaxation-option='selection-relaxation-allow'>",
  '<view><breakdown value="auto" /></view>',
  "<mark class='Automatic' />",
  '</pane>',
  '</panes>',
  '</table>',
  '</worksheet>',
  '</worksheets>',
  '</workbook>',
].join('');

function labelsShown(xml: string, value: 'true' | 'false'): string {
  return xml.replace(
    "<pane selection-relaxation-option='selection-relaxation-allow'>",
    `<pane selection-relaxation-option='selection-relaxation-allow'><style><style-rule element='mark'><format attr='mark-labels-show' value='${value}' /></style-rule></style>`,
  );
}

describe('formatLabelsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns mark labels ON by inserting a pane style rule and verifies readback', async () => {
    const { result, executeCommand } = await getToolResult({
      args: { worksheet: 'Profit', showLabels: true },
      readbackXml: labelsShown(BASE_XML, 'true'),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).worksheet).toBe('Profit');
    expect(JSON.parse(result.content[0].text).showLabels).toBe(true);

    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    expect(loadCall.args.text).toContain("<format attr='mark-labels-show' value='true' />");
    // Exactly one rule — no duplicate style blocks.
    expect(loadCall.args.text.match(/mark-labels-show/g)?.length).toBe(1);
  });

  it('rewrites an existing mark-labels rule (idempotent toggle to OFF)', async () => {
    const withOn = labelsShown(BASE_XML, 'true');
    const { result, executeCommand } = await getToolResult({
      args: { worksheet: 'Profit', showLabels: false },
      initialXml: withOn,
      readbackXml: labelsShown(BASE_XML, 'false'),
    });

    expect(result.isError).toBe(false);
    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    expect(loadCall.args.text).toContain("value='false'");
    // Still exactly one rule — rewritten, not appended.
    expect(loadCall.args.text.match(/mark-labels-show/g)?.length).toBe(1);
  });

  it('rejects an unknown worksheet before loading metadata', async () => {
    const { result, executeCommand } = await getToolResult({
      args: { worksheet: 'Nope', showLabels: true },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('was not found');
    expect(
      commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata'),
    ).toBe(false);
  });

  it('rejects empty worksheet', async () => {
    const { result } = await getToolResult({ args: { worksheet: '', showLabels: true } });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('worksheet empty');
  });
});

type FormatLabelsArgs = { session?: string; worksheet: string; showLabels?: boolean };

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: FormatLabelsArgs;
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
  const tool = getFormatLabelsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    { session: '12345', ...args, showLabels: args.showLabels ?? true },
    extra,
  );

  return { result, executeCommand };
}

function commandCalls(
  executeCommand: ReturnType<typeof vi.fn>,
): Array<ExecuteCommandArgs<undefined>> {
  return executeCommand.mock.calls.map(([call]) => call);
}
