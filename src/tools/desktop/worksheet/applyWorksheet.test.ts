import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as loadWorksheetXmlModule from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import * as episodeEvents from '../../../desktop/episode-events.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyWorksheetTool } from './applyWorksheet.js';

vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
vi.mock('fs');

describe('applyWorksheetTool', () => {
  const resultSchema = z.object({
    message: z.string(),
  });
  const skippedReadbackVerification = {
    ok: true,
    status: 'skipped' as const,
    message: 'worksheet busy',
  };
  const promisedSortLossWarning: ReadbackFinding = {
    kind: 'sort',
    node: 'computed-sort',
    column: '[DS].[none:State:nk]',
    intended: '<computed-sort column="[DS].[none:State:nk]">',
    readback: 'missing',
    severity: 'warning',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    episodeEvents.resetEpisodeEventsForTests();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getApplyWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-worksheet');
    expect(tool.description).toBe(
      'Apply a modified cached worksheet file to Desktop — the apply leg of the manual build path (add-field/remove-field edit the file; this lands it).',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      mode: expect.any(Object),
      worksheetFile: expect.any(Object),
      worksheetXml: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Apply Worksheet',
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should successfully apply worksheet XML in inline mode', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [] }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toBe(
      'Successfully applied worksheet update for "Sheet 1". The worksheet has been updated.\n\nHOST VERIFICATION — unverified: preflight clean · apply completed · readback unavailable. Do not claim the change is confirmed; report only the evidence above.',
    );
  });

  it('should successfully apply worksheet XML in file mode', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const mockFilePath = '/path/to/worksheet.xml';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [] }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
      worksheetFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied worksheet update');
    expect(resultObj.message).toContain('HOST VERIFICATION');

    expect(existsSync).toHaveBeenCalledWith(mockFilePath);
    expect(readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
  });

  it('reports skipped readback honestly for inline worksheet XML apply', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [], readbackVerification: skippedReadbackVerification }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const message = resultSchema.parse(JSON.parse(result.content[0].text)).message;
    expect(message).toContain('HOST VERIFICATION — unverified');
    expect(message).toContain('readback unavailable');
    expect(message).not.toMatch(/\bverified\b/i);
  });

  it('reports skipped readback honestly for file-based worksheet apply', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const mockFilePath = '/path/to/worksheet.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [], readbackVerification: skippedReadbackVerification }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
      worksheetFile: mockFilePath,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const message = resultSchema.parse(JSON.parse(result.content[0].text)).message;
    expect(message).toContain('HOST VERIFICATION — unverified');
    expect(message).toContain('readback unavailable');
    expect(message).not.toMatch(/\bverified\b/i);
  });

  it('fails the receipt when readback warnings show promised sort loss', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({
        readbackWarnings: [promisedSortLossWarning],
        readbackVerification: { ok: true, status: 'warning' },
      }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const message = resultSchema.parse(JSON.parse(result.content[0].text)).message;
    expect(message).toContain('HOST VERIFICATION — failed');
    expect(message).toContain('promised sort NOT verified');
    expect(message).not.toContain('HOST VERIFICATION — verified');
  });

  it('emits apply and readback events with promise_outcome without changing response text', async () => {
    const eventSpy = vi.spyOn(episodeEvents, 'emitWorksheetPromiseEvents');
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [], readbackVerification: { ok: true, status: 'passed' } }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(resultSchema.parse(JSON.parse(result.content[0].text)).message).toBe(
      'Successfully applied worksheet update for "Sheet 1". The worksheet has been updated.\n\nHOST VERIFICATION — verified: preflight clean · apply completed · readback clean. No host evidence of any workbook problem beyond the findings listed above — do not report unlisted issues.',
    );
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '12345',
        tool: 'apply-worksheet',
        operation: 'load-worksheet',
        readback: { ok: true, status: 'passed' },
        findings: [],
        promiseOutcome: 'verified',
      }),
    );
  });

  it('should return error when inline mode is used without worksheetXml', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError('When mode=inline, non-empty worksheet content is required.').message,
    );
  });

  it('should return error when file mode is used without worksheetFile', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('When mode=file, a non-empty worksheet file path');
  });

  it('should return error when worksheet file does not exist', async () => {
    const mockFilePath = '/nonexistent/worksheet.xml';
    vi.mocked(existsSync).mockReturnValue(false);

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
      worksheetFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached worksheet file not found');
  });

  it('should return error when file read fails', async () => {
    const mockFilePath = '/path/to/worksheet.xml';
    const readError = new Error('Permission denied');

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'file',
      worksheetFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when loadWorksheetXml command fails', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };

    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when worksheet XML load fails', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const error = {
      type: 'load-worksheet-xml-error' as const,
      error: { type: 'invalid-xml' as const },
    };

    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new WorksheetXmlLoadFailedError(error.error).message);
  });

  it('should pass the abort signal to loadWorksheetXml command', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const mockLoadWorksheetXml = vi
      .spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockResolvedValue(Ok({ readbackWarnings: [] }));

    const mockExecutor = vi.fn().mockResolvedValue({});
    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mode: 'inline',
      worksheetXml: mockXml,
      mockExecutor,
      customSignal,
    });

    expect(mockLoadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({
        worksheetName: 'Sheet 1',
        xml: mockXml,
        signal: customSignal,
      }),
    );
  });
});

describe('applyWorksheetTool over-cap note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts an over-cap inline apply but appends the file-mode note', async () => {
    const overCapXml = '<worksheet name="Sales">' + 'x'.repeat(20000) + '</worksheet>';
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [] }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sales',
      mode: 'inline',
      worksheetXml: overCapXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const message = JSON.parse(result.content[0].text).message as string;
    expect(message).toContain('Successfully applied worksheet update');
    expect(message).toContain('inline cap');
    expect(message).toContain('mode=file');
  });
});

async function getToolResult({
  session,
  worksheetName,
  mode,
  worksheetFile,
  worksheetXml,
  mockExecutor,
  customSignal,
  configOverrides,
}: {
  session: string;
  worksheetName: string;
  mode: 'file' | 'inline';
  worksheetFile?: string;
  worksheetXml?: string;
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
  configOverrides?: Partial<TableauDesktopToolContext['config']>;
}): Promise<CallToolResult> {
  const tool = getApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  extra.config = { ...extra.config, ...configOverrides };

  return await callback({ session, worksheetName, mode, worksheetFile, worksheetXml }, extra);
}
