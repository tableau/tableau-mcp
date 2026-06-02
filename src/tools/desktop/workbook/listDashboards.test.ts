import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as listDashboardsModule from '../../../desktop/commands/workbook/listDashboards.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListDashboardsTool } from './listDashboards.js';

vi.mock('../../../desktop/commands/workbook/listDashboards.js');

describe('listDashboardsTool', () => {
  const resultSchema = z.object({
    count: z.number(),
    dashboards: z.array(z.string()),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listDashboardsTool = getListDashboardsTool(new DesktopMcpServer());
    expect(listDashboardsTool.name).toBe('list-dashboards');
    expect(listDashboardsTool.description).toContain(
      'Gets a list of all dashboard names in the current workbook',
    );
    expect(listDashboardsTool.paramsSchema).toMatchObject({
      session: expect.any(Object),
    });
    expect(listDashboardsTool.annotations).toMatchObject({
      title: 'List All Dashboards in Workbook',
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should successfully list dashboards', async () => {
    const mockListDashboards = vi.spyOn(listDashboardsModule, 'listDashboards').mockResolvedValue(
      Ok({
        count: 2,
        dashboards: ['Sales Overview', 'Executive Summary'],
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
      count: 2,
      dashboards: ['Sales Overview', 'Executive Summary'],
    });

    expect(mockListDashboards).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {},
        signal: expect.any(Object),
      }),
    );
  });

  it('should return empty list when no dashboards exist', async () => {
    vi.spyOn(listDashboardsModule, 'listDashboards').mockResolvedValue(
      Ok({
        count: 0,
        dashboards: [],
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
      dashboards: [],
    });
  });

  it('should return error when command execution fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    vi.spyOn(listDashboardsModule, 'listDashboards').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should pass the abort signal to listDashboards command', async () => {
    const mockListDashboards = vi.spyOn(listDashboardsModule, 'listDashboards').mockResolvedValue(
      Ok({
        count: 1,
        dashboards: ['Main Dashboard'],
      }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});
    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      mockExecutor,
      customSignal,
    });

    expect(mockListDashboards).toHaveBeenCalledWith(
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
  const listDashboardsTool = getListDashboardsTool(new DesktopMcpServer());
  const callback = await Provider.from(listDashboardsTool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session }, extra);
}
