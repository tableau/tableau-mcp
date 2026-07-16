import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../desktop/commands/workbook/injectViewpoints.js';
import * as loadDashboardXmlModule from '../../../desktop/commands/workbook/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildAndApplyDashboardTool } from './buildAndApplyDashboard.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadDashboardXml.js');
vi.mock('../../../desktop/commands/workbook/injectViewpoints.js');
vi.mock('fs');

const mockWorkbookXml =
  '<workbook><windows><window class="dashboard" name="Sales Dashboard"/></windows></workbook>';

const defaultLayoutSpec = {
  kpis: ['KPI 1', 'KPI 2'],
  charts: ['Chart 1', 'Chart 2'],
  layoutType: 'auto-grid' as const,
};

describe('buildAndApplyDashboardTool', () => {
  const resultSchema = z.object({
    message: z.string(),
    kpiCount: z.number(),
    chartCount: z.number(),
    viewpointCount: z.number(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(mockWorkbookXml));
    vi.spyOn(injectViewpointsModule, 'injectViewpoints').mockReturnValue(mockWorkbookXml);
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBuildAndApplyDashboardTool(new DesktopMcpServer());
    expect(tool.name).toBe('build-and-apply-dashboard');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      dashboardFile: expect.any(Object),
      workbookFile: expect.any(Object),
      layoutSpec: expect.any(Object),
      worksheetNames: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('should build and apply a dashboard successfully', async () => {
    const result = await getToolResult({
      layoutSpec: defaultLayoutSpec,
      worksheetNames: ['KPI 1', 'KPI 2', 'Chart 1', 'Chart 2'],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.kpiCount).toBe(2);
    expect(resultObj.chartCount).toBe(2);
    expect(resultObj.viewpointCount).toBe(4);
  });

  it('should call loadDashboardXml with built XML containing zone elements', async () => {
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    await getToolResult({ layoutSpec: defaultLayoutSpec, worksheetNames: ['Chart 1'] });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardName: 'Sales Dashboard',
        xml: expect.stringContaining('<zone'),
      }),
    );
  });

  it('should include a title text zone when title is provided', async () => {
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    await getToolResult({
      title: 'My Dashboard',
      layoutSpec: { kpis: [], charts: ['Chart 1'], layoutType: 'auto-grid' },
      worksheetNames: ['Chart 1'],
    });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        xml: expect.stringContaining('type-v2="text"'),
      }),
    );
  });

  it('should return error when workbook file does not exist', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) !== '/workbook.xml');

    const result = await getToolResult({
      workbookFile: '/workbook.xml',
      layoutSpec: defaultLayoutSpec,
      worksheetNames: [],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Workbook cache file not found');
  });

  it('should return error when dashboard file does not exist', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) !== '/dashboard.xml');

    const result = await getToolResult({
      dashboardFile: '/dashboard.xml',
      layoutSpec: defaultLayoutSpec,
      worksheetNames: [],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Dashboard cache file not found');
  });

  it('should return error when getWorkbookXml fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERR', message: 'Failed', recoverable: false },
    };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ layoutSpec: defaultLayoutSpec, worksheetNames: [] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should return error when loadWorkbookXml fails', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ layoutSpec: defaultLayoutSpec, worksheetNames: [] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when loadDashboardXml fails', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ layoutSpec: defaultLayoutSpec, worksheetNames: [] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });
});

async function getToolResult({
  session = '12345',
  dashboardName = 'Sales Dashboard',
  dashboardFile = '/path/dashboard.xml',
  workbookFile = '/path/workbook.xml',
  title,
  layoutSpec,
  worksheetNames,
  mockExecutor = vi.fn().mockResolvedValue({}),
}: {
  session?: string;
  dashboardName?: string;
  dashboardFile?: string;
  workbookFile?: string;
  title?: string;
  layoutSpec: {
    kpis: string[];
    charts: string[];
    layoutType: 'auto-grid' | 'rows' | 'columns' | 'custom';
    gridColumns?: number;
    kpiStripHeight?: number;
  };
  worksheetNames: string[];
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getBuildAndApplyDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: mockExecutor };
  return await callback(
    { session, dashboardName, dashboardFile, workbookFile, title, layoutSpec, worksheetNames },
    extra,
  );
}
