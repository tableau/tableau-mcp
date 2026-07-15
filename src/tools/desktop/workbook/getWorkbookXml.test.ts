import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetWorkbookXmlTool } from './getWorkbookXml.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('fs');

describe('getWorkbookXmlTool', () => {
  const inlineResultSchema = z.object({
    message: z.string(),
    workbookXml: z.string(),
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
    const getWorkbookXmlTool = getGetWorkbookXmlTool(new DesktopMcpServer());
    expect(getWorkbookXmlTool.name).toBe('get-workbook-xml');
    expect(getWorkbookXmlTool.description).toContain('Get current workbook structure');
    expect(getWorkbookXmlTool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      mode: expect.any(Object),
    });
    expect(getWorkbookXmlTool.annotations).toMatchObject({
      title: 'Get Workbook Structure',
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should return workbook XML inline when mode is inline', async () => {
    const mockXml = '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(mockXml));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = inlineResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.workbookXml).toBe(mockXml);
    expect(resultObj.message).toContain('inline');
    expect(resultObj.message).toContain('bytes');
  });

  it('should write to file and return path when mode is file', async () => {
    const mockXml = '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(mockXml));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mode: 'file',
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = fileResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.file).toContain('workbook');
    expect(resultObj.message).toContain('cache file');
    expect(resultObj.instructions).toContain('Use this file path');
  });

  it('should return error when command execution fails', async () => {
    const error = { type: 'unknown' as const, error: new Error('Network error') };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });

  it('should pass the abort signal to getWorkbookXml command', async () => {
    const mockGetWorkbookXml = vi
      .spyOn(getWorkbookXmlModule, 'getWorkbookXml')
      .mockResolvedValue(Ok('<workbook></workbook>'));

    const mockExecutor = vi.fn().mockResolvedValue({});
    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor,
      customSignal,
    });

    expect(mockGetWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: customSignal,
      }),
    );
  });

  it('should return under-cap XML inline byte-identically', async () => {
    const largeXml = '<?xml version="1.0"?><workbook>' + 'x'.repeat(10000) + '</workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(largeXml));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = inlineResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.workbookXml).toBe(largeXml);
  });

  it('forces file mode when inline XML exceeds the cap, regardless of requested mode', async () => {
    const overCapXml =
      '<workbook><worksheets><worksheet name="Sales"/></worksheets>' +
      '<datasources><datasource caption="Superstore" name="ds1"/></datasources>' +
      'x'.repeat(20000) +
      '</workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(overCapXml));

    const result = await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    // File mode: a path, no inline XML, and a summary + how-to.
    expect(parsed.workbookXml).toBeUndefined();
    const resultObj = fileResultSchema.parse(parsed);
    expect(resultObj.file).toContain('workbook');
    expect(resultObj.message).toContain('inline cap');
    expect(resultObj.message).toContain('Sales');
    expect(resultObj.message).toContain('Superstore');
    expect(resultObj.instructions).toContain('cache read tool');
  });

  it('logs a cap-hit receipt when the cap fires', async () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const overCapXml = '<workbook>' + 'x'.repeat(20000) + '</workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(overCapXml));

    await getToolResult({ session: '12345', mode: 'inline', mockExecutor: vi.fn() });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        data: expect.objectContaining({ capHit: true, tool: 'get-workbook-xml' }),
      }),
    );
  });

  it('respects a smaller cap overridden via config', async () => {
    const smallXml = '<workbook><worksheet name="A"/></workbook>';
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(smallXml));

    const result = await getToolResult({
      session: '12345',
      mode: 'inline',
      mockExecutor: vi.fn().mockResolvedValue({}),
      capBytes: 8,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.workbookXml).toBeUndefined();
    expect(parsed.file).toBeDefined();
  });
});

async function getToolResult({
  session,
  mode,
  mockExecutor,
  customSignal,
  capBytes,
}: {
  session: string;
  mode: 'file' | 'inline';
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
  capBytes?: number;
}): Promise<CallToolResult> {
  const getWorkbookXmlTool = getGetWorkbookXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(getWorkbookXmlTool.callback);

  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
    ...(capBytes !== undefined && { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
  };

  return await callback({ session, mode }, extra);
}
