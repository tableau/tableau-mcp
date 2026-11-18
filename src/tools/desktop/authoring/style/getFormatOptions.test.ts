import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGetFormatOptionsTool } from './getFormatOptions.js';

const WORKSHEET_XML = `<worksheet name='Sales by Category'>
  <table>
    <view>
      <datasource-dependencies datasource='Sample - Superstore'>
        <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative'/>
        <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative'/>
      </datasource-dependencies>
    </view>
    <style><style-rule element='label'><format attr='text-format' field='[Sample - Superstore].[sum:Sales:qk]' value='p0.0%'/></style-rule></style>
    <panes><pane><style><style-rule element='mark'><format attr='mark-labels-show' value='true'/></style-rule></style><mark class='Bar'/></pane></panes>
    <rows>[Sample - Superstore].[none:Category:nk]</rows>
    <cols>[Sample - Superstore].[sum:Sales:qk]</cols>
  </table>
</worksheet>`;

describe('get-format-options tool', () => {
  it('is a read-only tool', () => {
    const tool = getGetFormatOptionsTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-format-options');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it('reads the current labels and number formats of each worksheet', async () => {
    const { result } = await callTool(['Sales by Category']);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      worksheets: [
        {
          worksheet: 'Sales by Category',
          showLabels: true,
          numberFormats: [
            {
              field: '[Sample - Superstore].[sum:Sales:qk]',
              caption: 'Sales',
              current: { kind: 'percentage', decimals: 1 },
            },
          ],
        },
      ],
    });
  });

  it('refuses an unknown worksheet without reading any document', async () => {
    const { result, getWorksheetDocument } = await callTool(['Missing']);

    expect(result.isError).toBe(true);
    expect(getWorksheetDocument).not.toHaveBeenCalled();
  });
});

async function callTool(worksheets: string[]): Promise<{
  result: CallToolResult;
  getWorksheetDocument: ReturnType<typeof vi.fn>;
}> {
  const getWorksheetDocument = vi.fn().mockResolvedValue(new Ok({ xml: WORKSHEET_XML }));
  const executor = {
    instanceId: 'desktop-instance',
    listWorksheets: vi
      .fn()
      .mockResolvedValue(
        new Ok({ worksheets: [{ id: 'worksheet-1', name: 'Sales by Category' }] }),
      ),
    getWorksheetDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const tool = getGetFormatOptionsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback({ session: '12345', worksheets }, extra);
  return { result, getWorksheetDocument };
}
