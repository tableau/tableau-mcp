import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../desktop/commands/workbook/injectViewpoints.js';
import * as loadDashboardXmlModule from '../../../desktop/commands/workbook/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { DesktopCommandExecutionError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyDashboardWithViewpointsTool } from './applyDashboardWithViewpoints.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadDashboardXml.js');
vi.mock('../../../desktop/commands/workbook/injectViewpoints.js');
vi.mock('fs');

describe('applyDashboardWithViewpointsTool', () => {
  const resultSchema = z.object({ message: z.string() });
  const mockDashboardXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
  const mockWorkbookXml =
    '<workbook><windows><window class="dashboard" name="Sales Dashboard"/></windows></workbook>';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockDashboardXml);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(mockWorkbookXml));
    vi.spyOn(injectViewpointsModule, 'injectViewpoints').mockReturnValue(mockWorkbookXml);
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Ok.EMPTY);
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Ok.EMPTY);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getApplyDashboardWithViewpointsTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-dashboard-with-viewpoints');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      dashboardFile: expect.any(Object),
      worksheetNames: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('should successfully apply dashboard with viewpoints', async () => {
    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Sales Dashboard');
    expect(resultObj.message).toContain('2 viewpoint');
  });

  it('should inject viewpoints with the correct dashboard and worksheet names', async () => {
    const mockInject = vi
      .spyOn(injectViewpointsModule, 'injectViewpoints')
      .mockReturnValue(mockWorkbookXml);

    await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    });

    expect(mockInject).toHaveBeenCalledWith(mockWorkbookXml, 'Sales Dashboard', [
      'Sheet 1',
      'Sheet 2',
    ]);
  });

  it('should return error when dashboard file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getToolResult({
      dashboardFile: '/nonexistent.xml',
      worksheetNames: ['Sheet 1'],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached dashboard file not found');
  });

  it('should return error when file read fails', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1'],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when fetching workbook fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERR', message: 'Failed', recoverable: false },
    };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1'],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should return error when applying workbook fails', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1'],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when applying dashboard fails', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1'],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });
});

async function getToolResult({
  session = '12345',
  dashboardName = 'Sales Dashboard',
  dashboardFile,
  worksheetNames,
  mockExecutor = vi.fn().mockResolvedValue({}),
}: {
  session?: string;
  dashboardName?: string;
  dashboardFile: string;
  worksheetNames: string[];
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getApplyDashboardWithViewpointsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: mockExecutor };
  return await callback({ session, dashboardName, dashboardFile, worksheetNames }, extra);
}
