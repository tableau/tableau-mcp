import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import * as commandModule from '../../../desktop/commands/workbook/getWorksheetSummaryData.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetWorksheetSummaryDataTool } from './getWorksheetSummaryData.js';

vi.mock('../../../desktop/commands/workbook/getWorksheetSummaryData.js');

describe('getWorksheetSummaryDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a read-only tool with the expected shape', () => {
    const tool = getGetWorksheetSummaryDataTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-worksheet-summary-data');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      maxRows: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('returns the summary data as JSON text', async () => {
    vi.spyOn(commandModule, 'getWorksheetSummaryData').mockResolvedValue(
      Ok({
        columns: [{ name: 'Category', dataType: 'string' }],
        rows: [['Furniture'], ['Technology']],
      }),
    );

    const result = await getToolResult({ session: '12345', worksheetName: 'Sales' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.rows).toEqual([['Furniture'], ['Technology']]);
  });

  it('maps a no-worksheet-found command error to an error result', async () => {
    vi.spyOn(commandModule, 'getWorksheetSummaryData').mockResolvedValue(
      Err({
        type: 'get-worksheet-summary-data-error',
        error: { type: 'no-worksheet-found', message: 'No worksheet found for "Sales".' },
      }),
    );

    const result = await getToolResult({ session: '12345', worksheetName: 'Sales' });

    expect(result.isError).toBe(true);
  });
});

async function getToolResult({
  session,
  worksheetName,
  maxRows,
}: {
  session: string;
  worksheetName: string;
  maxRows?: number;
}): Promise<CallToolResult> {
  const tool = getGetWorksheetSummaryDataTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: vi.fn() };
  return await callback({ session, worksheetName, maxRows }, extra);
}
