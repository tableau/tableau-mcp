import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../../desktop/wrappers/injectViewpoints.js';
import * as loadDashboardXmlModule from '../../../../desktop/wrappers/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { DesktopCommandExecutionError, FileReadError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { TableauDesktopToolContext } from '../../toolContext.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getApplyDashboardWithViewpointsTool } from './applyDashboardWithViewpoints.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadDashboardXml.js');
vi.mock('../../../../desktop/wrappers/injectViewpoints.js');
vi.mock('fs');

describe('applyDashboardWithViewpointsTool', () => {
  const resultSchema = z.object({ message: z.string() });
  const mockDashboardXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockDashboardXml);
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({ validationWarnings: [], verifiedWorksheetNames: ['Sheet 1', 'Sheet 2'] }),
    );
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

  it('uses verified registrations without a redundant read or write, even if another read would fail', async () => {
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Ok({ validationWarnings: [], verifiedWorksheetNames: ['Sheet 1', 'Sheet 2'] }),
    );
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
      Err({ type: 'invalid-response', error: new Error('transient read failure') }),
    );

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
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
      Ok({ validationWarnings: [], verifiedWorksheetNames: ['Sheet 1'] }),
    );
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(
      Err({ type: 'invalid-response', error: new Error('transient read failure') }),
    );

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    });

    expect(result.isError).toBe(true);
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
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
  afterEach(() => {
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
    expect(injectViewpointsModule.injectViewpoints).not.toHaveBeenCalled();
    expect(getWorkbookXmlModule.getWorkbookXml).not.toHaveBeenCalled();
  });

  it('requires all requested views before a surgical apply and requests verified readback', async () => {
    const args = {
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    };
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
        dashboardFile: '/path/to/dashboard.xml',
        worksheetNames: ['Sheet 1', 'Sheet 2'],
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
        dashboardFile: '/path/to/dashboard.xml',
        worksheetNames: ['Sheet 1', 'Sheet 2'],
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
