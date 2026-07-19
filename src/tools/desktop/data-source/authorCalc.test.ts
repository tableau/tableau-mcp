import { readFileSync } from 'fs';
import { join } from 'path';

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

  it('splices legally into a REAL Desktop document (regression: relation columns + clones + build comment)', async () => {
    // Every author-calc bug tonight was invisible to synthetic fixtures and cost a
    // live verse to find. This replays the tool against a real saved document.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const realXml = readFileSync(
      join(
        process.cwd(),
        'src',
        'tools',
        'desktop',
        'data-source',
        '__fixtures__',
        'real-superstore-document.twb.xml',
      ),
      'utf8',
    );
    const calcXml =
      "<column caption='Replay Tier' datatype='string' name='[Calculation_1700000000000]' role='dimension' type='nominal'><calculation class='tableau' formula='IF SUM([Profit]) &gt; 0 THEN &apos;Top&apos; ELSE &apos;Bottom&apos; END' /></column>";
    const { result, executeCommand } = await getToolResult({
      args: {
        caption: 'Replay Tier',
        formula: "IF SUM([Profit]) > 0 THEN 'Top' ELSE 'Bottom' END",
        role: 'dimension',
        datatype: 'string',
      },
      initialXml: realXml,
      readbackXml: realXml.replace('</datasource>', `${calcXml}</datasource>`),
    });

    expect(result.isError).toBe(false);
    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    const loaded = loadCall.args.text;
    const at = loaded.indexOf("caption='Replay Tier'");
    expect(at).toBeGreaterThan(-1);
    // legal position: NOT inside <relation>…</relation>, and inside the first datasource
    const relStart = loaded.lastIndexOf('<relation', at);
    const relEnd = relStart === -1 ? -1 : loaded.indexOf('</relation>', relStart);
    expect(relStart === -1 || relEnd < at).toBe(true);
    expect(at).toBeLessThan(loaded.indexOf('</datasource>', at) + '</datasource>'.length);
    expect(at).toBeLessThan(loaded.indexOf('</datasources>'));
  });

  it('resolves sibling-calc caption references to internal names (live 2026-07-19: 5 of 6 layered calcs broken)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const priorCalc =
      "<column caption='Member Profit' datatype='real' name='[Calculation_900]' role='measure' type='quantitative'><calculation class='tableau' formula='{ FIXED [Sub-Category] : SUM([Profit]) }' /></column>";
    const xml = BASE_XML.replace('</datasource>', `${priorCalc}</datasource>`);

    const { result, executeCommand } = await getToolResult({
      args: {
        caption: 'Top Threshold',
        formula: '{ FIXED : PERCENTILE([Member Profit], 0.80) }',
      },
      readbackXml: withColumn(
        xml,
        "<column caption='Top Threshold' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='{ FIXED : PERCENTILE([Calculation_900], 0.80) }' /></column>",
      ),
      initialXml: xml,
    });

    expect(result.isError).toBe(false);
    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    expect(loadCall.args.text).toContain('PERCENTILE([Calculation_900], 0.80)');
    expect(loadCall.args.text).not.toContain('PERCENTILE([Member Profit]');
    // base-field references (caption == name) stay untouched
    expect(loadCall.args.text).toContain('{ FIXED [Sub-Category] : SUM([Profit]) }');
  });

  it('ignores worksheet-dependencies datasource clones (live 2026-07-19: splicing a clone is silently discarded)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const xml = BASE_XML.replace(
      "<worksheets><worksheet name='Sheet 1' /></worksheets>",
      "<worksheets><worksheet name='Sheet 1'><table><view><datasources><datasource name='Superstore' /></datasources><datasource-dependencies datasource='Superstore'><column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource-dependencies></view></table></worksheet></worksheets>",
    );

    const { result, executeCommand } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
      readbackXml: withColumn(
        xml,
        "<column caption='Margin' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] * 0.2' /></column>",
      ),
    });

    expect(result.isError).toBe(false);
    const loadCall = commandCalls(executeCommand).find(
      (call) => call.command === 'load-underlying-metadata',
    );
    invariant(loadCall?.args && typeof loadCall.args.text === 'string');
    // the splice must land INSIDE the top-level <datasources> block, before its close
    const loaded = loadCall.args.text;
    expect(loaded.indexOf("caption='Margin'")).toBeLessThan(loaded.indexOf('</datasources>'));
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
describe('parameter caption resolution (verse-3 empty-sheet fix)', () => {
  it('resolves parameter captions to qualified [Parameters].[Parameter N] references', async () => {
    const { resolveCaptionReferencesForTest } = await import('./authorCalc.js');
    const workbookXml = [
      "<workbook><datasources>",
      "<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>",
      "<column caption='Top or Bottom' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Top&quot;' />",
      "<column caption='Number of Sub-Categories' datatype='integer' name='[Parameter 2]' param-domain-type='any' role='measure' type='quantitative' value='5' />",
      "</datasource>",
      "<datasource name='Sample - Superstore'><column caption='Profit' name='[Profit]' /></datasource>",
      "</datasources></workbook>",
    ].join('');
    const targetXml = "<datasource name='Sample - Superstore'><column caption='Profit' name='[Profit]' /></datasource>";
    const resolved = resolveCaptionReferencesForTest(
      'IF [Top or Bottom] = "Top" THEN RANK(SUM([Profit])) <= [Number of Sub-Categories] END',
      targetXml,
      workbookXml,
    );
    expect(resolved).toBe(
      'IF [Parameters].[Parameter 1] = "Top" THEN RANK(SUM([Profit])) <= [Parameters].[Parameter 2] END',
    );
  });
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
