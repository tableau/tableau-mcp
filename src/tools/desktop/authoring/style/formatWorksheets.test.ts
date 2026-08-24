import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { formatWorksheetDocument, getFormatWorksheetsTool } from './formatWorksheets.js';

const WORKSHEET_XML = `<worksheet name='Sales by Category'>
  <table>
    <view>
      <datasources><datasource caption='Sample - Superstore' name='Sample - Superstore'/></datasources>
      <datasource-dependencies datasource='Sample - Superstore'>
        <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative'/>
        <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative'/>
      </datasource-dependencies>
      <aggregation value='true'/>
    </view>
    <style/>
    <panes><pane><mark class='Bar'/><encodings><text column='[Sample - Superstore].[sum:Sales:qk]'/></encodings></pane></panes>
    <rows>[Sample - Superstore].[none:Category:nk]</rows>
    <cols>[Sample - Superstore].[sum:Sales:qk]</cols>
  </table>
  <simple-id uuid='worksheet-1'/>
</worksheet>`;

describe('formatWorksheetDocument', () => {
  it('adds labels and an explicit USD format without copying donor currency', () => {
    const result = formatWorksheetDocument(WORKSHEET_XML, {
      showLabels: true,
      numberFormats: [
        {
          field: 'Sales',
          kind: 'currency',
          currencySymbol: '$',
          decimals: 1,
          displayUnits: 'millions',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("attr='mark-labels-show' value='true'");
    expect(result.xml).toContain("field='[Sample - Superstore].[sum:Sales:qk]'");
    expect(result.xml).toContain('&quot;$&quot;');
    expect(result.xml).toContain('#,##0,,.0M');
    expect(result.xml).not.toContain('£');
  });

  it('replaces an existing donor currency on the same field', () => {
    const existing = WORKSHEET_XML.replace(
      '<style/>',
      "<style><style-rule element='label'><format attr='text-format' field='[Sample - Superstore].[sum:Sales:qk]' value='c&quot;£&quot;#,##0,K;-&quot;£&quot;#,##0,K' /></style-rule></style>",
    );
    const result = formatWorksheetDocument(existing, {
      numberFormats: [
        {
          field: 'Sales',
          kind: 'currency',
          currencySymbol: '$',
          decimals: 0,
          displayUnits: 'thousands',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('&quot;$&quot;');
    expect(result.xml).not.toContain('£');
    expect(result.xml.match(/attr='text-format'/g)).toHaveLength(2);
  });

  it('writes both cell and label formats when the field is on text and a shelf', () => {
    const result = formatWorksheetDocument(WORKSHEET_XML, {
      numberFormats: [{ field: 'Sales', kind: 'percentage', decimals: 1 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml.match(/attr='text-format'/g)).toHaveLength(2);
    expect(result.xml.match(/value='p0\.0%'/g)).toHaveLength(2);
    expect(result.xml).toContain("element='cell'");
    expect(result.xml).toContain("element='label'");
  });

  it('writes a cell format when the field is used only as a mark value', () => {
    const textOnly = WORKSHEET_XML.replace(
      '    <cols>[Sample - Superstore].[sum:Sales:qk]</cols>\n',
      '',
    );
    const result = formatWorksheetDocument(textOnly, {
      numberFormats: [{ field: 'Sales', kind: 'number', decimals: 0 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("element='cell'");
    expect(result.xml).not.toContain("element='label'");
  });

  it('writes a label format when the field is used only on a shelf', () => {
    const shelfOnly = WORKSHEET_XML.replace(
      "<encodings><text column='[Sample - Superstore].[sum:Sales:qk]'/></encodings>",
      '<encodings/>',
    );
    const result = formatWorksheetDocument(shelfOnly, {
      numberFormats: [{ field: 'Sales', kind: 'number', decimals: 0 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("element='label'");
    expect(result.xml).not.toContain("element='cell'");
  });

  it('is idempotent when the same format is applied twice', () => {
    const first = formatWorksheetDocument(WORKSHEET_XML, {
      showLabels: true,
      numberFormats: [{ field: 'Sales', kind: 'number', decimals: 0 }],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = formatWorksheetDocument(first.xml, {
      showLabels: true,
      numberFormats: [{ field: 'Sales', kind: 'number', decimals: 0 }],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.xml.match(/attr='mark-labels-show'/g)).toHaveLength(1);
    expect(second.xml.match(/attr='text-format'/g)).toHaveLength(2);
  });

  it('fails closed when the requested field is not used by the worksheet', () => {
    const result = formatWorksheetDocument(WORKSHEET_XML, {
      numberFormats: [{ field: 'Profit', kind: 'currency', currencySymbol: '$', decimals: 0 }],
    });

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.message).toContain('Profit');
    expect(result.message).toContain('Sales');
  });

  it.each([
    ['thousands', 0, 'n#,##0,K;-#,##0,K'],
    ['thousands', 1, 'n#,##0,.0K;-#,##0,.0K'],
    ['thousands', 2, 'n#,##0,.00K;-#,##0,.00K'],
    ['millions', 0, 'n#,##0,,M;-#,##0,,M'],
    ['millions', 1, 'n#,##0,,.0M;-#,##0,,.0M'],
    ['millions', 2, 'n#,##0,,.00M;-#,##0,,.00M'],
    ['billions', 0, 'n#,##0,,,B;-#,##0,,,B'],
    ['billions', 1, 'n#,##0,,,.0B;-#,##0,,,.0B'],
    ['billions', 2, 'n#,##0,,,.00B;-#,##0,,,.00B'],
  ] as const)('places %s scale before %i decimals', (displayUnits, decimals, expected) => {
    const result = formatWorksheetDocument(WORKSHEET_XML, {
      numberFormats: [{ field: 'Sales', kind: 'number', displayUnits, decimals }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain(`value='${expected}'`);
  });
});

describe('format-worksheets tool', () => {
  it('uses a bounded public schema and never accepts a raw number-format string', () => {
    const tool = getFormatWorksheetsTool(new DesktopMcpServer());
    expect(tool.name).toBe('format-worksheets');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(Object.keys(tool.paramsSchema)).toEqual(['session', 'worksheets']);
    expect(JSON.stringify(tool.paramsSchema)).not.toContain('rawFormat');
  });

  it('formats each exact worksheet with its own field contract', async () => {
    const { result, applyWorksheetDocument } = await callTool({
      worksheets: [
        {
          name: 'Sales by Category',
          showLabels: true,
          numberFormats: [{ field: 'Sales', kind: 'currency', currencySymbol: '$', decimals: 0 }],
        },
        {
          name: 'Profit KPI',
          showLabels: true,
          numberFormats: [{ field: 'Profit', kind: 'currency', currencySymbol: '$', decimals: 0 }],
        },
      ],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      formatted: [
        { worksheet: 'Sales by Category', verified: true },
        { worksheet: 'Profit KPI', verified: true },
      ],
    });
    expect(applyWorksheetDocument).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate worksheet targets before applying', async () => {
    const { result, applyWorksheetDocument } = await callTool({
      worksheets: [
        { name: 'Sales by Category', showLabels: true },
        { name: 'Sales by Category', showLabels: true },
      ],
    });

    expect(result.isError).toBe(true);
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('preflights every target before applying any worksheet', async () => {
    const { result, applyWorksheetDocument } = await callTool({
      worksheets: [
        { name: 'Sales by Category', showLabels: true },
        {
          name: 'Profit KPI',
          numberFormats: [{ field: 'Discount', kind: 'percentage', decimals: 1 }],
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('skips apply when Tableau already has the requested formatting', async () => {
    const { result, applyWorksheetDocument } = await callTool(
      {
        worksheets: [
          {
            name: 'Sales by Category',
            showLabels: true,
            numberFormats: [{ field: 'Sales', kind: 'currency', currencySymbol: '$', decimals: 0 }],
          },
        ],
      },
      { preformatted: true },
    );

    expect(result.isError).toBe(false);
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('rejects a matching text format read back under a cell style rule', async () => {
    const { result } = await callTool(
      {
        worksheets: [
          {
            name: 'Sales by Category',
            numberFormats: [{ field: 'Sales', kind: 'number', decimals: 0 }],
          },
        ],
      },
      {
        readbackTransform: (xml) =>
          xml.replace("<style-rule element='label'>", "<style-rule element='cell'>"),
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects matching mark-label formatting read back in another pane', async () => {
    const { result } = await callTool(
      { worksheets: [{ name: 'Sales by Category', showLabels: true }] },
      {
        sourceTransform: (xml) =>
          xml
            .replace('<panes><pane>', "<panes><pane id='first'>")
            .replace(
              '</pane></panes>',
              "</pane><pane id='second'><mark class='Bar'/></pane></panes>",
            ),
        readbackTransform: moveMarkLabelFormatToSecondPane,
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
  });

  it('rejects readback that keeps formatting but drops a worksheet shelf', async () => {
    const { result } = await callTool(
      { worksheets: [{ name: 'Sales by Category', showLabels: true }] },
      {
        readbackTransform: (xml) =>
          xml.replace('    <rows>[Sample - Superstore].[none:Category:nk]</rows>\n', ''),
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('worksheet semantics');
  });

  it('does not post a worksheet that drifts from Bar to Line after preparation', async () => {
    const { result, applyWorksheetDocument } = await callTool(
      {
        worksheets: [
          { name: 'Sales by Category', showLabels: true },
          { name: 'Profit KPI', showLabels: true },
        ],
      },
      { driftSecondBeforeApply: true },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Profit KPI');
    expect(result.content[0].text).toContain('earlier formatted sheets may already be updated');
    expect(applyWorksheetDocument).toHaveBeenCalledTimes(1);
    expect(applyWorksheetDocument).not.toHaveBeenCalledWith(
      'worksheet-2',
      expect.any(String),
      expect.anything(),
    );
  });
});

type ToolArgs = {
  worksheets: Array<{
    name: string;
    showLabels?: boolean;
    numberFormats?: Array<{
      field: string;
      kind: 'number' | 'currency' | 'percentage';
      decimals: number;
      displayUnits?: 'none' | 'thousands' | 'millions' | 'billions';
      currencySymbol?: '$' | '€' | '£' | '¥';
    }>;
  }>;
};

async function callTool(
  args: ToolArgs,
  options: {
    preformatted?: boolean;
    sourceTransform?: (xml: string) => string;
    readbackTransform?: (xml: string) => string;
    driftSecondBeforeApply?: boolean;
  } = {},
): Promise<{
  result: CallToolResult;
  applyWorksheetDocument: ReturnType<typeof vi.fn>;
}> {
  const worksheets = args.worksheets.map(({ name }, index) => ({
    id: `worksheet-${index + 1}`,
    name,
  }));
  const documents = new Map(
    worksheets.map(({ id, name }, index) => {
      const source =
        name === 'Profit KPI'
          ? WORKSHEET_XML.replaceAll('Sales', 'Profit').replace(
              "name='Profit by Category'",
              "name='Profit KPI'",
            )
          : WORKSHEET_XML.replace("name='Sales by Category'", `name='${name}'`);
      const transformedSource = options.sourceTransform?.(source) ?? source;
      const request = args.worksheets[index];
      const prepared = options.preformatted
        ? formatWorksheetDocument(transformedSource, {
            showLabels: request.showLabels,
            numberFormats: request.numberFormats,
          })
        : undefined;
      return [id, prepared?.ok ? prepared.xml.replaceAll('/>', ' />') : transformedSource];
    }),
  );
  const applyWorksheetDocument = vi.fn(async (id: string, xml: string) => {
    documents.set(id, (options.readbackTransform?.(xml) ?? xml).replaceAll('/>', ' />'));
    if (options.driftSecondBeforeApply && id === 'worksheet-1') {
      documents.set(
        'worksheet-2',
        documents.get('worksheet-2')!.replace("class='Bar'", "class='Line'"),
      );
    }
    return new Ok({ command_id: 'apply-1', status: 'completed', result: null });
  });
  const executor = {
    instanceId: 'desktop-instance',
    listWorksheets: vi.fn().mockResolvedValue(new Ok({ worksheets })),
    getWorksheetDocument: vi.fn(async (id: string) => new Ok({ xml: documents.get(id)! })),
    applyWorksheetDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const tool = getFormatWorksheetsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback(
    {
      session: '12345',
      worksheets: args.worksheets,
    },
    extra,
  );
  return { result, applyWorksheetDocument };
}

function moveMarkLabelFormatToSecondPane(xml: string): string {
  const style =
    /<style><style-rule element='mark'><format attr='mark-labels-show' value='true'\s*\/><\/style-rule><\/style>/.exec(
      xml,
    )?.[0];
  if (!style) return xml;
  return xml.replace(style, '').replace("<pane id='second'>", `<pane id='second'>${style}`);
}
