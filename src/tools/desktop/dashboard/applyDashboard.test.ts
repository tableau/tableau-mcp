import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as loadDashboardXmlModule from '../../../desktop/commands/workbook/loadDashboardXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyDashboardTool } from './applyDashboard.js';

vi.mock('../../../desktop/commands/workbook/loadDashboardXml.js');
vi.mock('fs');

describe('applyDashboardTool', () => {
  const resultSchema = z.object({ message: z.string() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getApplyDashboardTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-dashboard');
    expect(tool.description).toContain('Apply modified dashboard XML back to Tableau');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      mode: expect.any(Object),
      dashboardFile: expect.any(Object),
      dashboardXml: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ title: 'Apply Dashboard', readOnlyHint: false });
  });

  it('should successfully apply dashboard XML in inline mode', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Ok.EMPTY);

    const result = await getToolResult({
      mode: 'inline',
      dashboardXml: mockXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied dashboard XML');
  });

  it('should successfully apply dashboard XML in file mode', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const mockFilePath = '/path/to/dashboard.xml';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Ok.EMPTY);

    const result = await getToolResult({ mode: 'file', dashboardFile: mockFilePath });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied dashboard XML');
    expect(existsSync).toHaveBeenCalledWith(mockFilePath);
    expect(readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
  });

  it('should return error when inline mode is used without dashboardXml', async () => {
    const result = await getToolResult({ mode: 'inline' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('When mode=inline, a non-empty dashboard XML string is required.')
        .message,
    );
  });

  it('should return error when file mode is used without dashboardFile', async () => {
    const result = await getToolResult({ mode: 'file' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('When mode=file, a non-empty dashboard file path');
  });

  it('should return error when dashboard file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getToolResult({ mode: 'file', dashboardFile: '/nonexistent.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached dashboard file not found');
  });

  it('should return error when file read fails', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getToolResult({ mode: 'file', dashboardFile: '/path/to/dashboard.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when loadDashboardXml command fails', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ mode: 'inline', dashboardXml: mockXml });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should pass the abort signal to loadDashboardXml', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok.EMPTY);
    const customSignal = new AbortController().signal;

    await getToolResult({ mode: 'inline', dashboardXml: mockXml, customSignal });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ xml: mockXml, signal: customSignal }),
    );
  });
});

async function getToolResult({
  session = '12345',
  dashboardName = 'Sales Dashboard',
  mode,
  dashboardFile,
  dashboardXml,
  mockExecutor = vi.fn().mockResolvedValue({}),
  customSignal,
}: {
  session?: string;
  dashboardName?: string;
  mode: 'file' | 'inline';
  dashboardFile?: string;
  dashboardXml?: string;
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getApplyDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  return await callback({ session, dashboardName, mode, dashboardFile, dashboardXml }, extra);
}
