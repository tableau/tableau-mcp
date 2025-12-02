import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodTypeAny } from 'zod';

import { Server } from '../../server.js';
import { Provider } from '../../utils/provider.js';
import { buildWorkbookXml } from './buildWorkbookXml.js';
import { getInjectVizIntoWorkbookXmlTool, paramsSchema } from './injectVizIntoWorkbookXml.js';

describe('injectVizIntoWorkbookXml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const injectVizIntoWorkbookXmlTool = getInjectVizIntoWorkbookXmlTool(new Server());
    expect(injectVizIntoWorkbookXmlTool.name).toBe('inject-viz-into-workbook-xml');
    expect(injectVizIntoWorkbookXmlTool.description).toContain(
      "Takes a TWB XML workbook string and injects a basic visualization by wiring columns (dimensions) and rows (measures) into the first or named worksheet. It adds <datasources> and <datasource-dependencies> into the sheet's <view>, and sets <rows>/<cols> shelves.",
    );
    expect(injectVizIntoWorkbookXmlTool.paramsSchema).toMatchObject({});
  });

  it('should successfully inject a viz into a workbook', async () => {
    const workbookXml = buildWorkbookXml({
      siteName: 'test-site',
      hostname: 'test-hostname',
      port: 'test-port',
      channel: 'http',
      datasourceName: 'test-datasource',
      datasourceCaption: 'test-datasource-caption',
      publishedDatasourceId: 'test-published-datasource-id',
      revision: '1.0',
      worksheetName: 'test-worksheet',
    });

    const result = await getToolResult({
      workbookXml,
      worksheetName: 'test-worksheet',
      datasourceConnectionName: 'test-datasource-connection-name',
      datasourceCaption: 'test-datasource-caption',
      columns: ['test-column-1', 'test-column-2'],
      rows: [
        { field: 'test-row-1', aggregation: 'SUM' },
        { field: 'test-row-2', aggregation: 'AVG' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(
      "<datasource caption='test-datasource-caption' name='test-datasource-connection-name' />",
    );

    expect(result.content[0].text).toContain(
      "<column-instance column='[test-column-1]' derivation='None' name='[none:test-column-1:nk]' pivot='key' type='nominal' />",
    );
    expect(result.content[0].text).toContain(
      "<column-instance column='[test-column-2]' derivation='None' name='[none:test-column-2:nk]' pivot='key' type='nominal' />",
    );
    expect(result.content[0].text).toContain(
      "<column-instance column='[test-row-1]' derivation='Sum' name='[sum:test-row-1:qk]' pivot='key' type='quantitative' />",
    );

    expect(result.content[0].text).toContain(
      "<column-instance column='[test-row-2]' derivation='Avg' name='[avg:test-row-2:qk]' pivot='key' type='quantitative' />",
    );
  });
});

async function getToolResult(
  params: z.objectOutputType<typeof paramsSchema, ZodTypeAny>,
): Promise<CallToolResult> {
  const injectVizIntoWorkbookXmlTool = getInjectVizIntoWorkbookXmlTool(new Server());
  const callback = await Provider.from(injectVizIntoWorkbookXmlTool.callback);
  return await callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
