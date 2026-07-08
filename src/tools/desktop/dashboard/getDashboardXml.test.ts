import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getDashboardXmlModule from '../../../desktop/commands/workbook/getDashboardXml.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
} from '../../../errors/mcpToolError.js';
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetDashboardXmlTool } from './getDashboardXml.js';

vi.mock('../../../desktop/commands/workbook/getDashboardXml.js');
vi.mock('fs');

describe('getDashboardXmlTool', () => {
  const inlineResultSchema = z.object({
    message: z.string(),
    dashboardXml: z.string(),
  });

  const fileResultSchema = z.object({
    message: z.string(),
    file: z.string(),
    instructions: z.string(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getGetDashboardXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-dashboard-xml');
    expect(tool.description).toContain('Gets the XML for a specific dashboard');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      mode: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Get Dashboard XML',
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should return dashboard XML inline when mode is inline', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Ok(mockXml));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = inlineResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.dashboardXml).toBe(mockXml);
    expect(resultObj.message).toContain('inline');
    expect(resultObj.message).toContain('bytes');
  });

  it('should write to file and return path when mode is file', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Ok(mockXml));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'file' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = fileResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.file).toContain('dashboard');
    expect(resultObj.message).toContain('cache file');
    expect(resultObj.instructions).toContain('apply-dashboard');
  });

  it('should return error when execute-command-error occurs', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Network error', recoverable: false },
      },
    };
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when no-dashboard-found error occurs', async () => {
    const error = {
      type: 'get-dashboard-xml-error' as const,
      error: {
        type: 'no-dashboard-found' as const,
        message: 'No dashboard found for "Sales Dashboard".',
      },
    };
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetDashboardXmlFailedError(error.error).message);
  });

  it('should return error when multiple-dashboards-found error occurs', async () => {
    const error = {
      type: 'get-dashboard-xml-error' as const,
      error: {
        type: 'multiple-dashboards-found' as const,
        message: '2 dashboards found instead of 1.',
      },
    };
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetDashboardXmlFailedError(error.error).message);
  });

  it('should pass the abort signal to getDashboardXml command', async () => {
    const mockGetDashboardXml = vi
      .spyOn(getDashboardXmlModule, 'getDashboardXml')
      .mockResolvedValue(Ok('<dashboard name="Sales Dashboard"/>'));

    const customSignal = new AbortController().signal;
    await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline', customSignal });

    expect(mockGetDashboardXml).toHaveBeenCalledWith(
      expect.objectContaining({ signal: customSignal, dashboardName: 'Sales Dashboard' }),
    );
  });

  it('forces file mode when inline XML exceeds the cap, regardless of requested mode', async () => {
    const overCapXml =
      '<dashboard name="Sales Dashboard"><zones>' + 'x'.repeat(20000) + '</zones></dashboard>';
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Ok(overCapXml));

    const result = await getToolResult({ dashboardName: 'Sales Dashboard', mode: 'inline' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.dashboardXml).toBeUndefined();
    const resultObj = fileResultSchema.parse(parsed);
    expect(resultObj.message).toContain('inline cap');
    expect(resultObj.message).toContain('Sales Dashboard');
    expect(resultObj.instructions).toContain('read-cached-xml');
  });

  it('logs a cap-hit receipt when the cap fires', async () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const overCapXml = '<dashboard name="D"><zones>' + 'x'.repeat(20000) + '</zones></dashboard>';
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Ok(overCapXml));

    await getToolResult({ dashboardName: 'D', mode: 'inline' });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        data: expect.objectContaining({ capHit: true, tool: 'get-dashboard-xml' }),
      }),
    );
  });

  it('respects a smaller cap overridden via config', async () => {
    const smallXml = '<dashboard name="D"><zones/></dashboard>';
    vi.spyOn(getDashboardXmlModule, 'getDashboardXml').mockResolvedValue(Ok(smallXml));

    const result = await getToolResult({ dashboardName: 'D', mode: 'inline', capBytes: 8 });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.dashboardXml).toBeUndefined();
    expect(parsed.file).toBeDefined();
  });
});

async function getToolResult({
  session = '12345',
  dashboardName,
  mode,
  mockExecutor = vi.fn().mockResolvedValue({}),
  customSignal,
  capBytes,
}: {
  session?: string;
  dashboardName: string;
  mode: 'file' | 'inline';
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
  capBytes?: number;
}): Promise<CallToolResult> {
  const tool = getGetDashboardXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
    ...(capBytes !== undefined && { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
  };
  return await callback({ session, dashboardName, mode }, extra);
}
