import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAuthorCalcTool } from './authorCalc.js';
import { authorCalculationsInWorkbook } from './authorCalcCore.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Superstore'>",
  "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
  "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets>",
  '</workbook>',
].join('');

const EMBEDDED_PUBLISHED_DATASOURCE =
  "<datasource name='Published Metadata'><column name='[ARR]' /></datasource>";
const PUBLISHED_BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'><datasources><datasource name='Published'>",
  "<connection class='sqlproxy'><metadata-records><metadata-record><attributes><attribute>",
  `<![CDATA[${EMBEDDED_PUBLISHED_DATASOURCE}]]>`,
  '</attribute></attributes></metadata-record></metadata-records></connection>',
  "<column caption='ARR' datatype='integer' name='[ARR]' role='measure' type='quantitative' />",
  "</datasource></datasources><worksheets><worksheet name='Sheet 1' /></worksheets></workbook>",
].join('');

const LEGACY_NAMED_CONNECTION_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'><datasources>",
  "<datasource inline='true' name='Sample - Superstore'>",
  "<connection class='federated'><named-connections>",
  "<named-connection caption='Sample - Superstore' name='excel-direct.0oz123' />",
  '</named-connections></connection>',
  "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
  '</datasource></datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets></workbook>",
].join('');

const MODERN_CAPTIONED_DATASOURCE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'><datasources>",
  "<datasource caption='Orders' inline='true' name='federated.orders'>",
  "<connection class='federated'><named-connections>",
  "<named-connection caption='Orders' name='textscan.orders' />",
  '</named-connections></connection>',
  "<column caption='Sales' datatype='real' name='[sales]' role='measure' type='quantitative' />",
  '</datasource>',
  "<datasource caption='h6-gross-margin-calc' inline='true' name='federated.csv040059ff380b040059ff380b'>",
  "<connection class='federated'><named-connections>",
  "<named-connection caption='h6-gross-margin-calc' name='textscan.csv040059ff380b040059ff380b' />",
  '</named-connections></connection>',
  "<column caption='Quantity' datatype='integer' name='[quantity]' role='measure' type='quantitative' />",
  '</datasource></datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets></workbook>",
].join('');

const INTERNAL_NAME_CAPTION_COLLISION_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'><datasources>",
  "<datasource caption='Primary Orders' inline='true' name='federated.primary'>",
  "<connection class='federated'><named-connections>",
  "<named-connection caption='Primary Orders' name='textscan.primary' />",
  '</named-connections></connection>',
  "<column caption='Primary Sales' datatype='real' name='[primary_sales]' role='measure' type='quantitative' />",
  '</datasource>',
  "<datasource caption='federated.primary' inline='true' name='federated.secondary'>",
  "<connection class='federated'><named-connections>",
  "<named-connection caption='Secondary Orders' name='textscan.secondary' />",
  '</named-connections></connection>',
  "<column caption='Secondary Sales' datatype='real' name='[secondary_sales]' role='measure' type='quantitative' />",
  '</datasource></datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets></workbook>",
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
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Profit & "Growth"',
        formula: 'IF [Sales] < 10 AND [Region] = \'West\' THEN "A & B" END',
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
      hint: 'reference it by caption in a build-worksheets-from-templates fieldMapping (name the caption plus a chart shape)',
    });

    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(
      "<column caption='Profit &amp; &quot;Growth&quot;' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='IF [Sales] &lt; 10 AND [Region] = &apos;West&apos; THEN &quot;A &amp; B&quot; END' /></column>",
    );
  });

  it('keeps a legacy friendly top-level datasource name instead of its nested connection id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const calcXml =
      "<column caption='Double Sales' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] * 2' /></column>";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Double Sales',
        formula: '[Sales] * 2',
        datasource: 'Sample - Superstore',
      },
      initialXml: LEGACY_NAMED_CONNECTION_XML,
      readbackXml: withColumnInDatasource(
        LEGACY_NAMED_CONNECTION_XML,
        'Sample - Superstore',
        calcXml,
      ),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).datasource).toBe('Sample - Superstore');
    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    expect(datasourceBlock(appliedXml, 'Sample - Superstore')).toContain(calcXml);
    expect(JSON.parse(result.content[0].text).datasource).not.toBe('excel-direct.0oz123');
  });

  it('resolves a unique visible datasource caption to its top-level internal name', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const calcXml =
      "<column caption='Double Quantity' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[quantity] * 2' /></column>";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Double Quantity',
        formula: '[Quantity] * 2',
        datasource: 'h6-gross-margin-calc',
      },
      initialXml: MODERN_CAPTIONED_DATASOURCE_XML,
      readbackXml: withColumnInDatasource(
        MODERN_CAPTIONED_DATASOURCE_XML,
        'federated.csv040059ff380b040059ff380b',
        calcXml,
      ),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).datasource).toBe(
      'federated.csv040059ff380b040059ff380b',
    );
    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    expect(datasourceBlock(appliedXml, 'federated.csv040059ff380b040059ff380b')).toContain(calcXml);
    expect(datasourceBlock(appliedXml, 'federated.orders')).not.toContain(calcXml);
    expect(JSON.parse(result.content[0].text).datasource).not.toBe(
      'textscan.csv040059ff380b040059ff380b',
    );
  });

  it('prefers an exact top-level internal name over a colliding datasource caption', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const calcXml =
      "<column caption='Double Primary Sales' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[primary_sales] * 2' /></column>";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Double Primary Sales',
        formula: '[primary_sales] * 2',
        datasource: 'federated.primary',
      },
      initialXml: INTERNAL_NAME_CAPTION_COLLISION_XML,
      readbackXml: withColumnInDatasource(
        INTERNAL_NAME_CAPTION_COLLISION_XML,
        'federated.primary',
        calcXml,
      ),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).datasource).toBe('federated.primary');
    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    expect(datasourceBlock(appliedXml, 'federated.primary')).toContain(calcXml);
    expect(datasourceBlock(appliedXml, 'federated.secondary')).not.toContain(calcXml);
    expect(JSON.parse(result.content[0].text).datasource).not.toBe('textscan.primary');
  });

  it('rejects an ambiguous datasource caption before apply and lists internal choices', async () => {
    const duplicateCaptionXml = MODERN_CAPTIONED_DATASOURCE_XML.replace(
      "caption='Orders'",
      "caption='h6-gross-margin-calc'",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Double Quantity',
        formula: '[Quantity] * 2',
        datasource: 'h6-gross-margin-calc',
      },
      initialXml: duplicateCaptionXml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('federated.orders');
    expect(result.content[0].text).toContain('federated.csv040059ff380b040059ff380b');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects calc readback from a different internal datasource', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const calcXml =
      "<column caption='Double Quantity' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[quantity] * 2' /></column>";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Double Quantity',
        formula: '[Quantity] * 2',
        datasource: 'federated.csv040059ff380b040059ff380b',
      },
      initialXml: MODERN_CAPTIONED_DATASOURCE_XML,
      readbackXml: withColumnInDatasource(
        MODERN_CAPTIONED_DATASOURCE_XML,
        'federated.orders',
        calcXml,
      ),
    });

    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not apply');
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withColumn(
      BASE_XML,
      "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
    );

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Profit', formula: '[Sales] * 0.2' },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'caption collision — pick a new caption or use the existing field',
    );
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
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
        'authoring',
        'datasource',
        '__fixtures__',
        'real-superstore-document.twb.xml',
      ),
      'utf8',
    );
    const calcXml =
      "<column caption='Replay Tier' datatype='string' name='[Calculation_1700000000000]' role='dimension' type='nominal'><calculation class='tableau' formula='IF SUM([Profit]) &gt; 0 THEN &apos;Top&apos; ELSE &apos;Bottom&apos; END' /></column>";
    const { result, applyWorkbookDocument } = await getToolResult({
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
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    const at = loaded.indexOf("caption='Replay Tier'");
    expect(at).toBeGreaterThan(-1);
    // legal position: NOT inside <relation>…</relation>, and inside the first datasource
    const relStart = loaded.lastIndexOf('<relation', at);
    const relEnd = relStart === -1 ? -1 : loaded.indexOf('</relation>', relStart);
    expect(relStart === -1 || relEnd < at).toBe(true);
    expect(at).toBeLessThan(loaded.indexOf('</datasource>', at) + '</datasource>'.length);
    expect(at).toBeLessThan(loaded.indexOf('</datasources>'));
  });

  it('rejects a fabricated direct-calc field against a live-shaped workbook before dispatch', async () => {
    const realXml = readFileSync(
      join(
        process.cwd(),
        'src',
        'tools',
        'desktop',
        'authoring',
        'datasource',
        '__fixtures__',
        'real-superstore-document.twb.xml',
      ),
      'utf8',
    );

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Unsafe Calc', formula: '[Fabricated] + [Sales]' },
      initialXml: realXml,
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('field reference [Fabricated] was not found'),
        },
      ],
    });
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('resolves sibling-calc caption references to internal names (live 2026-07-19: 5 of 6 layered calcs broken)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const priorCalc =
      "<column caption='Member Profit' datatype='real' name='[Calculation_900]' role='measure' type='quantitative'><calculation class='tableau' formula='{ FIXED [Sub-Category] : SUM([Profit]) }' /></column>";
    const xml = BASE_XML.replace('</datasource>', `${priorCalc}</datasource>`);

    const { result, applyWorkbookDocument } = await getToolResult({
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
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded).toContain('PERCENTILE([Calculation_900], 0.80)');
    expect(loaded).not.toContain('PERCENTILE([Member Profit]');
    // base-field references (caption == name) stay untouched
    expect(loaded).toContain('{ FIXED [Sub-Category] : SUM([Profit]) }');
  });

  it('ignores worksheet-dependencies datasource clones (live 2026-07-19: splicing a clone is silently discarded)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const xml = BASE_XML.replace(
      "<worksheets><worksheet name='Sheet 1' /></worksheets>",
      "<worksheets><worksheet name='Sheet 1'><table><view><datasources><datasource name='Superstore' /></datasources><datasource-dependencies datasource='Superstore'><column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource-dependencies></view></table></worksheet></worksheets>",
    );

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
      readbackXml: withColumn(
        xml,
        "<column caption='Margin' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] * 0.2' /></column>",
      ),
    });

    expect(result.isError).toBe(false);
    // the splice must land INSIDE the top-level <datasources> block, before its close
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.indexOf("caption='Margin'")).toBeLessThan(loaded.indexOf('</datasources>'));
  });

  it('splices a calc after a published datasource CDATA payload and before the outer close', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const calcXml =
      "<column caption='ARR Plus Ten' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[ARR] + 10' /></column>";
    const readbackXml = PUBLISHED_BASE_XML.replace(
      '</datasource></datasources>',
      `${calcXml}</datasource></datasources>`,
    );

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'ARR Plus Ten', formula: '[ARR] + 10' },
      initialXml: PUBLISHED_BASE_XML,
      readbackXml,
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    expect(loaded.slice(loaded.indexOf('<![CDATA[') + 9, loaded.indexOf(']]>'))).toBe(
      EMBEDDED_PUBLISHED_DATASOURCE,
    );
    expect(loaded.indexOf("caption='ARR Plus Ten'")).toBeGreaterThan(loaded.indexOf(']]>'));
    expect(loaded.indexOf("caption='ARR Plus Ten'")).toBeLessThan(
      loaded.lastIndexOf('</datasource>'),
    );
  });

  it('rejects a datasource name that exists only inside published metadata CDATA', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'ARR Plus Ten',
        formula: '[ARR] + 10',
        datasource: 'Published Metadata',
      },
      initialXml: PUBLISHED_BASE_XML,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Datasource "Published Metadata" was not found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects multiple candidate datasources without a selector and lists them', async () => {
    const xml = BASE_XML.replace(
      '</datasources>',
      "<datasource name='Inventory'></datasource><datasource name='Parameters'></datasource></datasources>",
    );

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple datasources found');
    expect(result.content[0].text).toContain('Superstore');
    expect(result.content[0].text).toContain('Inventory');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
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

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xmlWithoutWorksheet,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('at least one <datasource');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
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

    const { result, applyWorkbookDocument } = await getToolResult({
      args: { caption: 'Margin', formula: '[Sales] * 0.2' },
      initialXml: xml,
      readbackXml,
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(
      "name='[Calculation_1700000000001]'",
    );
  });

  it('scopes loose field resolution to the selected target datasource', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const initialXml = [
      "<?xml version='1.0' encoding='utf-8'?>",
      "<workbook version='18.1'><datasources>",
      "<datasource name='Orders'>",
      "<column caption='Revenue' datatype='real' name='[revenue]' role='measure' type='quantitative' />",
      '</datasource>',
      "<datasource name='Inventory'>",
      "<column caption='Cost' datatype='real' name='[cost]' role='measure' type='quantitative' />",
      '</datasource>',
      "</datasources><worksheets><worksheet name='Sheet 1' /></worksheets></workbook>",
    ].join('');
    const calcXml =
      "<column caption='Scoped Calc' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Revenue] + 1' /></column>";
    const readbackXml = initialXml.replace(
      "<column caption='Cost' datatype='real' name='[cost]' role='measure' type='quantitative' />",
      `<column caption='Cost' datatype='real' name='[cost]' role='measure' type='quantitative' />${calcXml}`,
    );
    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(new Ok({ command_id: 'apply-1', status: 'completed', result: null }));
    const executor = {
      start: vi.fn(),
      stop: vi.fn(),
      isAvailable: vi.fn(() => true),
      executeCommand: vi
        .fn()
        .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null })),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        new Ok({
          xml: readbackXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorkbookDocument,
    };

    const result = await authorCalculationsInWorkbook({
      workbookXml: initialXml,
      calcs: [{ caption: 'Scoped Calc', formula: '[Revenue] + 1' }],
      datasource: 'Inventory',
      resolveLooseReferences: true,
      executor: makeExecutorMock(executor),
      signal: new AbortController().signal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected target-scoped field resolution to fail');
    expect(result.error.message).toContain('field reference [Revenue] was not found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      commentKind: '//',
      formula: "// don't do this\n[Fabricated] + [Sales]",
    },
    {
      commentKind: '/* */',
      formula: "/* don't inspect [Comment Field] */\n[Fabricated] + [Sales]",
    },
  ])(
    'checks fabricated field references after an apostrophe in a $commentKind comment',
    async ({ formula }) => {
      const applyWorkbookDocument = vi
        .fn()
        .mockResolvedValue(new Ok({ command_id: 'apply-1', status: 'completed', result: null }));
      const executor = {
        start: vi.fn(),
        stop: vi.fn(),
        isAvailable: vi.fn(() => true),
        executeCommand: vi
          .fn()
          .mockResolvedValue(
            new Ok({ command_id: 'command-1', status: 'completed', result: null }),
          ),
        getWorkbookDocument: vi.fn().mockResolvedValue(
          new Ok({
            xml: BASE_XML,
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        ),
        applyWorkbookDocument,
      };

      const result = await authorCalculationsInWorkbook({
        workbookXml: BASE_XML,
        calcs: [{ caption: 'Unsafe Calc', formula }],
        resolveLooseReferences: true,
        executor: makeExecutorMock(executor),
        signal: new AbortController().signal,
      });

      expect(result.isErr()).toBe(true);
      if (result.isOk()) throw new Error('expected fabricated field reference to fail');
      expect(result.error.message).toContain('field reference [Fabricated] was not found');
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );
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
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, initialXml, readbackXml ?? withColumn(initialXml, '')];
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
  describe('parameter caption resolution (verse-3 empty-sheet fix)', () => {
    it('resolves parameter captions to qualified [Parameters].[Parameter N] references', async () => {
      const { resolveCaptionReferencesForTest } = await import('./authorCalc.js');
      const workbookXml = [
        '<workbook><datasources>',
        "<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>",
        "<column caption='Top or Bottom' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Top&quot;' />",
        "<column caption='Number of Sub-Categories' datatype='integer' name='[Parameter 2]' param-domain-type='any' role='measure' type='quantitative' value='5' />",
        '</datasource>',
        "<datasource name='Sample - Superstore'><column caption='Profit' name='[Profit]' /></datasource>",
        '</datasources></workbook>',
      ].join('');
      const targetXml =
        "<datasource name='Sample - Superstore'><column caption='Profit' name='[Profit]' /></datasource>";
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
    getExecutor: vi.fn().mockResolvedValue({
      executeCommand,
      getWorkbookDocument,
      applyWorkbookDocument,
    }),
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

  return { result, applyWorkbookDocument };
}

function withColumn(xml: string, column: string): string {
  return xml.replace('</datasource>', `${column}</datasource>`);
}

function withColumnInDatasource(xml: string, datasourceName: string, column: string): string {
  const block = datasourceBlock(xml, datasourceName);
  return xml.replace(block, block.replace('</datasource>', `${column}</datasource>`));
}

function datasourceBlock(xml: string, datasourceName: string): string {
  const openStart = xml.indexOf('<datasource');
  let cursor = openStart;
  while (cursor !== -1) {
    const openEnd = xml.indexOf('>', cursor) + 1;
    const openTag = xml.slice(cursor, openEnd);
    if (openTag.includes(`name='${datasourceName}'`)) {
      const closeEnd = xml.indexOf('</datasource>', openEnd) + '</datasource>'.length;
      return xml.slice(cursor, closeEnd);
    }
    cursor = xml.indexOf('<datasource', openEnd);
  }
  throw new Error(`missing datasource ${datasourceName}`);
}

function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const [xml] = applyWorkbookDocument.mock.calls[0] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}
