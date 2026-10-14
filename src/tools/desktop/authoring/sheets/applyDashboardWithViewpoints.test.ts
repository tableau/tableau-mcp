import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cacheFingerprintModule from '../../../../desktop/wrappers/cacheFingerprint.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../../desktop/wrappers/injectViewpoints.js';
import * as loadDashboardXmlModule from '../../../../desktop/wrappers/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.desktop.js';
import { FileReadError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { mockContainedCacheReadFromFs } from '../../api/applyPreamble.testUtils.js';
import { TableauDesktopToolContext } from '../../toolContext.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getApplyDashboardWithViewpointsTool } from './applyDashboardWithViewpoints.js';

vi.mock('../../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../desktop/cachePath.js')>()),
  readContainedCacheTextFile: vi.fn(),
}));
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
    mockContainedCacheReadFromFs();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockDashboardXml);
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({
        validationWarnings: [],
        documentWarnings: [],
        verifiedWorksheetNames: ['Sheet 1', 'Sheet 2'],
      }),
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
      Ok({
        validationWarnings: [],
        documentWarnings: [],
        verifiedWorksheetNames: ['Sheet 1', 'Sheet 2'],
      }),
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

  it('shows Desktop warnings in the success body and gives a non-done next action', async () => {
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Ok({
        validationWarnings: [],
        documentWarnings: warnings,
        verifiedWorksheetNames: ['Sheet 1', 'Sheet 2'],
      }),
    );

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toContain('dropped-node: Removed an unsupported zone.');
    expect(body.message).toContain('Desktop reported 1 warning(s)');
    expect(body.message).not.toContain('Successfully');
    expect(body.viewpointState).toBe('success');
    expect(body.warnings).toEqual(warnings);
    expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
  });

  it('omits warnings from a clean success body', async () => {
    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1', 'Sheet 2'],
    });
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).not.toHaveProperty('warnings');
    expect(result.structuredContent).toBeUndefined();
  });

  it('refuses a stale cache sidecar before any Desktop call (W9)', async () => {
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      dashboardFile: '/path/to/dashboard.xml',
      worksheetNames: ['Sheet 1'],
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('different Desktop session');
    expect(mockExecutor).not.toHaveBeenCalled();
    expect(loadDashboardXmlModule.loadDashboardXml).not.toHaveBeenCalled();
    sidecarSpy.mockRestore();
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
