import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as listWorksheetsModule from '../../../desktop/commands/workbook/listWorksheets.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListWorksheetsTool } from './listWorksheets.js';

vi.mock('../../../desktop/commands/workbook/listWorksheets.js');

describe('listWorksheetsTool', () => {
  const resultSchema = z.object({
    count: z.number(),
    worksheets: z.array(z.string()),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listWorksheetsTool = getListWorksheetsTool(new DesktopMcpServer());
    expect(listWorksheetsTool.name).toBe('list-worksheets');
    expect(listWorksheetsTool.description).toContain(
      'Gets a list of all worksheet names in the current workbook',
    );
    expect(listWorksheetsTool.paramsSchema).toMatchObject({
      session: expect.any(Object),
    });
    expect(listWorksheetsTool.annotations).toMatchObject({
      title: 'List All Worksheets in Workbook',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('should successfully list worksheets', async () => {
    const mockListWorksheets = vi.spyOn(listWorksheetsModule, 'listWorksheets').mockResolvedValue(
      Ok({
        count: 3,
        worksheets: ['Sheet 1', 'Sales Dashboard', 'Analysis'],
      }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      count: 3,
      worksheets: ['Sheet 1', 'Sales Dashboard', 'Analysis'],
    });

    expect(mockListWorksheets).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {},
        signal: expect.any(Object),
      }),
    );
  });

  it('should return empty list when no worksheets exist', async () => {
    vi.spyOn(listWorksheetsModule, 'listWorksheets').mockResolvedValue(
      Ok({
        count: 0,
        worksheets: [],
      }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj).toMatchObject({
      count: 0,
      worksheets: [],
    });
  });

  it('should return error when command execution fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    vi.spyOn(listWorksheetsModule, 'listWorksheets').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should pass the abort signal to listWorksheets command', async () => {
    const mockListWorksheets = vi.spyOn(listWorksheetsModule, 'listWorksheets').mockResolvedValue(
      Ok({
        count: 1,
        worksheets: ['Sheet 1'],
      }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});
    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      mockExecutor,
      customSignal,
    });

    expect(mockListWorksheets).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: customSignal,
      }),
    );
  });
});

async function getToolResult({
  session,
  mockExecutor,
  customSignal,
}: {
  session: string;
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const listWorksheetsTool = getListWorksheetsTool(new DesktopMcpServer());
  const callback = await Provider.from(listWorksheetsTool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session }, extra);
}
