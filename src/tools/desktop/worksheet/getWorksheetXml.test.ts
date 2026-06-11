import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as getWorksheetXmlModule from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetWorksheetXmlTool } from './getWorksheetXml.js';

vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('fs');

describe('getWorksheetXmlTool', () => {
  const inlineResultSchema = z.object({
    message: z.string(),
    worksheetXml: z.string(),
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
    const tool = getGetWorksheetXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-worksheet-xml');
    expect(tool.description).toContain('Gets the XML for a specific worksheet');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      mode: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Get Worksheet XML',
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should return worksheet XML inline when mode is inline', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(getWorksheetXmlModule, 'getWorksheetXml').mockResolvedValue(Ok(mockXml));

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = inlineResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.worksheetXml).toBe(mockXml);
    expect(resultObj.message).toContain('inline');
    expect(resultObj.message).toContain('bytes');
  });

  it('should write to file and return path when mode is file', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(getWorksheetXmlModule, 'getWorksheetXml').mockResolvedValue(Ok(mockXml));

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = fileResultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.file).toContain('worksheet');
    expect(resultObj.message).toContain('cache file');
    expect(resultObj.instructions).toContain('Use this file path');
  });

  it('should return error when execute-command-error occurs', async () => {
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Network error', recoverable: false },
      },
    };
    vi.spyOn(getWorksheetXmlModule, 'getWorksheetXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when no-worksheet-found error occurs', async () => {
    const error = {
      type: 'get-worksheet-xml-error' as const,
      error: { type: 'no-worksheet-found' as const, message: 'No worksheet found for Sheet 1.' },
    };
    vi.spyOn(getWorksheetXmlModule, 'getWorksheetXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetWorksheetXmlFailedError(error.error).message);
  });

  it('should return error when multiple-worksheets-found error occurs', async () => {
    const error = {
      type: 'get-worksheet-xml-error' as const,
      error: {
        type: 'multiple-worksheets-found' as const,
        message: '3 worksheets found instead of 1.',
      },
    };
    vi.spyOn(getWorksheetXmlModule, 'getWorksheetXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new GetWorksheetXmlFailedError(error.error).message);
  });

  it('should pass the abort signal to getWorksheetXml command', async () => {
    const mockGetWorksheetXml = vi
      .spyOn(getWorksheetXmlModule, 'getWorksheetXml')
      .mockResolvedValue(Ok('<worksheet name="Sheet 1"/>'));

    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      customSignal,
    });

    expect(mockGetWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: customSignal,
        worksheetName: 'Sheet 1',
      }),
    );
  });
});

async function getToolResult({
  session,
  worksheetName,
  mode,
  mockExecutor = vi.fn().mockResolvedValue({}),
  customSignal,
}: {
  session: string;
  worksheetName: string;
  mode: 'file' | 'inline';
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getGetWorksheetXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session, worksheetName, mode }, extra);
}
