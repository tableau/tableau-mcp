import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../../desktop/wrappers/injectViewpoints.js';
import * as loadDashboardXmlModule from '../../../../desktop/wrappers/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { TableauDesktopToolContext } from '../../toolContext.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBuildAndApplyDashboardTool } from './buildAndApplyDashboard.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadDashboardXml.js');
vi.mock('../../../../desktop/wrappers/injectViewpoints.js');
vi.mock('fs');

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
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({
        validationWarnings: [],
        verifiedWorksheetNames: ['KPI 1', 'KPI 2', 'Chart 1', 'Chart 2'],
      }),
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

  it('uses verified registrations without a redundant read or write, even if another read would fail', async () => {
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Ok({
        validationWarnings: [],
        verifiedWorksheetNames: ['KPI 1', 'KPI 2', 'Chart 1', 'Chart 2'],
      }),
    );
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
      Err({ type: 'invalid-response', error: new Error('transient read failure') }),
    );

    const result = await getToolResult({
      layoutSpec: defaultLayoutSpec,
      worksheetNames: ['KPI 1', 'Chart 1'],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      viewpointCount: 2,
      viewpointState: 'success',
    });
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
    expect(injectViewpointsModule.injectViewpoints).not.toHaveBeenCalled();
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
  });

  it('does not treat an unverified requested worksheet as registered', async () => {
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Ok({ validationWarnings: [], verifiedWorksheetNames: ['KPI 1'] }),
    );
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
      Err({ type: 'invalid-response', error: new Error('transient read failure') }),
    );

    const result = await getToolResult({
      layoutSpec: defaultLayoutSpec,
      worksheetNames: ['KPI 1', 'Chart 1'],
    });

    expect(result.isError).toBe(true);
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
  });

  it('names the dashboard as the artifact on every write it makes', async () => {
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));
    const mockWorkbookLoad = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [] }));

    await getToolResult({ layoutSpec: defaultLayoutSpec, worksheetNames: ['Chart 1'] });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardName: 'Sales Dashboard',
        xml: expect.stringContaining('<zone'),
        focus: { navigate: 'artifact', sheetName: 'Sales Dashboard' },
      }),
    );
    expect(mockWorkbookLoad).not.toHaveBeenCalled();
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
  afterEach(() => {
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
    expect(injectViewpointsModule.injectViewpoints).not.toHaveBeenCalled();
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
  });

  it('requires all requested views before a surgical apply and requests verified readback', async () => {
    const args = { layoutSpec: defaultLayoutSpec, worksheetNames: ['KPI 1', 'Chart 1'] };
    await getToolResult(args);
    expect(loadDashboardXmlModule.loadDashboardXml).toHaveBeenCalledWith(
      expect.objectContaining({
        requireExistingSheet: true,
        verifyReadback: true,
        worksheetNames: args.worksheetNames,
      }),
    );
  });

  it.each(['sheet-absent', 'registration-required', 'verification-failed'] as const)(
    'propagates %s without a workbook or injection fallback',
    async (type) => {
      vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
        Err({
          type: 'load-dashboard-xml-error',
          error: { type, message: 'Cannot safely apply', worksheetNames: ['Missing'] },
        }),
      );
      const result = await getToolResult({
        layoutSpec: defaultLayoutSpec,
        worksheetNames: ['KPI 1', 'Chart 1'],
      });
      expect(result.isError).toBe(true);
      expect(loadDashboardXmlModule.loadDashboardXml).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, []])(
    'reports an incomplete result for missing verification %s',
    async (verifiedWorksheetNames) => {
      vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
        Ok({
          validationWarnings: [],
          verifiedWorksheetNames,
        }),
      );
      const result = await getToolResult({
        layoutSpec: defaultLayoutSpec,
        worksheetNames: ['KPI 1', 'Chart 1'],
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('viewpoint-verification');
      expect(result.content[0].text).toContain('Do not replace the workbook');
    },
  );
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
