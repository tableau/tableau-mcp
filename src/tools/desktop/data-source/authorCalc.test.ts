import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExecuteCommandArgs } from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAuthorCalcTool } from './authorCalc.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Superstore'>",
  "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets>",
  '</workbook>',
].join('');

describe('authorCalcTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (vi.isMockFunction(Date.now)) {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it('splices an escaped calculation into the target datasource and verifies readback', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { result, executeCommand } = await getToolResult({
      args: {
        caption: 'Profit & "Growth"',
        formula: "IF [Sales] < 10 AND [Region] = 'West' THEN \"A & B\" END",
      },
      readbackXml: withColumn(
        BASE_XML,
        "<column caption='Profit &amp; &quot;Growth&quot;' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='IF [Sales] &lt; 10 AND [Region] = &apos;West&apos; THEN &quot;A &amp; B&quot; END' /></column>",
      ),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      calcName: '[Calculation_1700000000000]',
      caption: 'Profit & "Growth"',
      datasource: 'Superstore',
      hint: 'reference it by caption in generate-viz-from-notional-spec',
    });

    const loadCall = commandCalls(executeCommand).find((call) => call.command === 'load-underlying-metadata');
    expect(loadCall).toBeDefined();
    expect(loadCall?.args?.text).toContain(
      "<column caption='Profit &amp; &quot;Growth&quot;' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='IF [Sales] &lt; 10 AND [Region] = &apos;West&apos; THEN &quot;A &amp; B&quot; END' /></column>",
    );
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withColumn(
      BASE_XML,
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
    );

    const { result, executeCommand } = await getToolResult({
      args: { caption: 'Profit', formula: '[Sales] * 0.2' },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'caption collision — pick a new caption or use the existing field',
    );
    expect(commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata')).toBe(
      false,
    );
  });

  it('rejects multiple candidate datasources without a selector and lists them', async () => {
    const xml = BASE_XML.replace(
      '</datasources>',
      "<datasource name='Inventory'></datasource><datasource name='Parameters'></datasource></datasources>",
    );

    const { result, executeCommand } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple datasources found');
    expect(result.content[0].text).toContain('Superstore');
    expect(result.content[0].text).toContain('Inventory');
    expect(commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata')).toBe(
      false,
    );
  });

  it('errors when readback does not include the new column and caption', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_100);
    const { result } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      readbackXml: BASE_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('load completed but did not apply');
  });

  it('surfaces guard rejection before loading metadata', async () => {
    const xmlWithoutWorksheet = BASE_XML.replace(
      "<worksheets><worksheet name='Sheet 1' /></worksheets>",
      '',
    );

    const { result, executeCommand } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xmlWithoutWorksheet,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('whole-document or nothing');
    expect(commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata')).toBe(
      false,
    );
  });

  it('avoids colliding with existing Calculation ids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const xml = withColumn(
      BASE_XML,
      "<column caption='Existing' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative' />",
    );
    const readbackXml = withColumn(
      xml,
      "<column caption='Margin' datatype='real' name='[Calculation_1700000000001]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] * 0.2' /></column>",
    );

    const { result, executeCommand } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
      readbackXml,
    });

    expect(result.isError).toBe(false);
    const loadCall = commandCalls(executeCommand).find((call) => call.command === 'load-underlying-metadata');
    expect(loadCall?.args?.text).toContain("name='[Calculation_1700000000001]'");
  });
});

type AuthorCalcArgs = {
  session?: string;
  caption: string;
  formula: string;
  role?: 'measure' | 'dimension';
  datatype?: 'real' | 'integer' | 'string' | 'boolean' | 'date' | 'datetime';
  datasource?: string;
};

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: AuthorCalcArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  executeCommand: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, readbackXml ?? withColumn(initialXml, '')];
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
  const tool = getAuthorCalcTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      role: args.role ?? 'measure',
      datatype: args.datatype ?? 'real',
      datasource: args.datasource,
    },
    extra,
  );

  return { result, executeCommand };
}

function withColumn(xml: string, column: string): string {
  return xml.replace('</datasource>', `${column}</datasource>`);
}

function commandCalls(executeCommand: ReturnType<typeof vi.fn>): Array<ExecuteCommandArgs<undefined>> {
  return executeCommand.mock.calls.map(([call]) => call);
}
