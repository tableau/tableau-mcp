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
    expect(result.xml).toContain('#,##0.0,,M');
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
    expect(result.xml.match(/attr='text-format'/g)).toHaveLength(1);
  });

  it('writes number formats through the worksheet label rule', () => {
    const result = formatWorksheetDocument(WORKSHEET_XML, {
      numberFormats: [{ field: 'Sales', kind: 'percentage', decimals: 1 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml.match(/attr='text-format'/g)).toHaveLength(1);
    expect(result.xml.match(/value='p0\.0%'/g)).toHaveLength(1);
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
    expect(second.xml.match(/attr='text-format'/g)).toHaveLength(1);
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
  options: { preformatted?: boolean } = {},
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
      const request = args.worksheets[index];
      const prepared = options.preformatted
        ? formatWorksheetDocument(source, {
            showLabels: request.showLabels,
            numberFormats: request.numberFormats,
          })
        : undefined;
      return [id, prepared?.ok ? prepared.xml.replaceAll('/>', ' />') : source];
    }),
  );
  const applyWorksheetDocument = vi.fn(async (id: string, xml: string) => {
    documents.set(id, xml.replaceAll('/>', ' />'));
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
