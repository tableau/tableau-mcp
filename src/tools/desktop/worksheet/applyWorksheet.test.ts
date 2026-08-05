import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as loadWorksheetXmlModule from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import * as episodeEvents from '../../../desktop/episode-events.js';
import type { WorksheetApplyState } from '../../../desktop/metadata/targetWorksheetState.js';
import {
  setTemplateArtifactStoreForTests,
  TemplateArtifactStore,
} from '../../../desktop/templates/templateArtifactStore.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import {
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
  const verifiedArtifactApply = {
    readbackWarnings: [],
    readbackVerification: { ok: true, status: 'passed' as const },
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
      'Apply a guarded template artifact or modified cached worksheet file to Desktop.',
    );
    expect(tool.paramsSchema).toMatchObject({
      artifactId: expect.any(Object),
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      worksheetFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('bounds session, worksheet name, and worksheet file inputs', () => {
    const schema = getApplyWorksheetTool(new DesktopMcpServer()).paramsSchema as {
      session: z.ZodTypeAny;
      worksheetName: z.ZodTypeAny;
      worksheetFile: z.ZodTypeAny;
    };

    expect(schema.session.safeParse('s'.repeat(64)).success).toBe(true);
    expect(schema.session.safeParse('s'.repeat(65)).success).toBe(false);
    expect(schema.worksheetName.safeParse('').success).toBe(false);
    expect(schema.worksheetName.safeParse('w').success).toBe(true);
    expect(schema.worksheetName.safeParse('w'.repeat(255)).success).toBe(true);
    expect(schema.worksheetName.safeParse('w'.repeat(256)).success).toBe(false);
    expect(schema.worksheetFile.safeParse('f'.repeat(4096)).success).toBe(true);
    expect(schema.worksheetFile.safeParse('f'.repeat(4097)).success).toBe(false);
  });

  it('consumes a session-bound artifact and applies its exact guarded payload', async () => {
    const server = new DesktopMcpServer();
    const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const expectedState = putArtifact(server, artifactId, '12345:instance-live');
    const load = vi
      .spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockResolvedValue(Ok(verifiedArtifactApply));
    const mockExecutor = vi.fn().mockResolvedValue({ desktopInstanceId: 'instance-live' });

    const first = await getToolResult({ session: '12345', artifactId, mockExecutor, server });
    const replay = await getToolResult({ session: '12345', artifactId, mockExecutor, server });

    expect(first.isError).toBe(false);
    invariant(first.content[0].type === 'text');
    expect(JSON.parse(first.content[0].text)).toMatchObject({
      templateProvenance: 'custom',
      metadataTrust: 'untrusted-repository',
    });
    expect(load).toHaveBeenCalledWith({
      worksheetName: 'Stored Sheet',
      xml: '<worksheet name="Stored Sheet"><table /></worksheet>',
      worksheetWindowXml: '<window class="worksheet" name="Stored Sheet" />',
      expectedState,
      focus: { navigate: 'artifact', sheetName: 'Stored Sheet' },
      executor: { desktopInstanceId: 'instance-live' },
      signal: expect.any(AbortSignal),
      requireExistingSheet: false,
    });
    expect(replay.isError).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it('rejects artifactId combined with manual worksheet arguments', async () => {
    const load = vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml');

    const result = await getToolResult({
      session: '12345',
      artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      worksheetName: 'Manual Sheet',
      worksheetFile: '/cache/manual.xml',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('artifactId cannot be combined');
    expect(load).not.toHaveBeenCalled();
  });

  it('releases an artifact only after a proven pre-dispatch read failure', async () => {
    const server = new DesktopMcpServer();
    const artifactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    putArtifact(server, artifactId, '12345');
    const load = vi
      .spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockResolvedValueOnce(
        Err({
          type: 'execute-command-error',
          error: { type: 'unknown', error: new Error('read failed') },
          dispatchState: 'not-dispatched',
          retrySafe: true,
        }),
      )
      .mockResolvedValueOnce(Ok(verifiedArtifactApply));
    const mockExecutor = vi.fn().mockResolvedValue({});

    const failedRead = await getToolResult({ session: '12345', artifactId, mockExecutor, server });
    const retry = await getToolResult({ session: '12345', artifactId, mockExecutor, server });

    expect(failedRead.isError).toBe(true);
    invariant(failedRead.content[0].type === 'text');
    expect(JSON.parse(failedRead.content[0].text)).toEqual({
      mutationOutcome: 'not-dispatched',
      guidance: expect.stringContaining('Retry apply-worksheet with this artifactId'),
    });
    expect(retry.isError).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('consumes a pre-dispatch failure that is not proven to be a read failure', async () => {
    const server = new DesktopMcpServer();
    const artifactId = 'cececece-cece-4ece-8ece-cececececece';
    putArtifact(server, artifactId, '12345');
    const load = vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Err({
        type: 'execute-command-error',
        error: { type: 'invalid-response', error: new Error('invalid guarded upsert') },
        dispatchState: 'not-dispatched',
      }),
    );
    const mockExecutor = vi.fn().mockResolvedValue({});

    const failed = await getToolResult({ session: '12345', artifactId, mockExecutor, server });
    const replay = await getToolResult({ session: '12345', artifactId, mockExecutor, server });

    expect(failed.isError).toBe(true);
    invariant(failed.content[0].type === 'text');
    expect(JSON.parse(failed.content[0].text)).toEqual({
      mutationOutcome: 'not-dispatched',
      guidance: expect.stringContaining('artifact was consumed'),
    });
    expect(replay.isError).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it('consumes an artifact after a possibly-dispatched failure', async () => {
    const server = new DesktopMcpServer();
    const artifactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    putArtifact(server, artifactId, '12345');
    const load = vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Err({
        type: 'execute-command-error',
        error: { type: 'unknown', error: new Error('dispatch uncertain') },
        dispatchState: 'possibly-dispatched',
      }),
    );
    const mockExecutor = vi.fn().mockResolvedValue({});

    const uncertain = await getToolResult({ session: '12345', artifactId, mockExecutor, server });
    const replay = await getToolResult({ session: '12345', artifactId, mockExecutor, server });

    expect(uncertain.isError).toBe(true);
    invariant(uncertain.content[0].type === 'text');
    expect(JSON.parse(uncertain.content[0].text)).toEqual({
      mutationOutcome: 'possibly-dispatched',
      guidance: expect.stringContaining('artifact was consumed'),
    });
    expect(replay.isError).toBe(true);
    expect(load).toHaveBeenCalledOnce();
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

  it('should return error when no worksheetFile is given', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('A non-empty worksheet file path is required');
  });

  it('should return error when worksheet file does not exist', async () => {
    const mockFilePath = '/nonexistent/worksheet.xml';
    vi.mocked(existsSync).mockReturnValue(false);

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
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

function putArtifact(
  server: DesktopMcpServer,
  artifactId: string,
  sessionId: string,
): WorksheetApplyState {
  const expectedState: WorksheetApplyState = {
    workbookSha256: 'e'.repeat(64),
    target: { state: 'absent' },
    targetWindow: { state: 'absent' },
    dependenciesSha256: 'c'.repeat(64),
    artifactSha256: 'd'.repeat(64),
  };
  const store = new TemplateArtifactStore({ createId: () => artifactId });
  setTemplateArtifactStoreForTests(server, store);
  store.put(sessionId, {
    worksheetName: 'Stored Sheet',
    worksheetXml: '<worksheet name="Stored Sheet"><table /></worksheet>',
    worksheetWindowXml: '<window class="worksheet" name="Stored Sheet" />',
    expectedState,
    templateProvenance: 'custom',
    metadataTrust: 'untrusted-repository',
  });
  return expectedState;
}

async function getToolResult({
  session,
  artifactId,
  worksheetName,
  worksheetFile,
  worksheetXml,
  mockExecutor,
  customSignal,
  configOverrides,
  server,
}: {
  session: string;
  artifactId?: string;
  worksheetName?: string;
  worksheetFile?: string;
  worksheetXml?: string;
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
  configOverrides?: Partial<TableauDesktopToolContext['config']>;
  server?: DesktopMcpServer;
}): Promise<CallToolResult> {
  // The tool no longer takes a document. Tests that supplied XML directly now get a
  // synthetic cache path backed by the fs mock, so they still exercise the apply leg.
  if (worksheetXml !== undefined && worksheetFile === undefined) {
    worksheetFile = '/cache/synthetic-worksheet.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(worksheetXml);
  }

  const tool = getApplyWorksheetTool(server ?? new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  extra.config = { ...extra.config, ...configOverrides };

  const artifactCallback = callback as unknown as (
    args: {
      session?: string;
      artifactId?: string;
      worksheetName?: string;
      worksheetFile?: string;
    },
    callbackExtra: typeof extra,
  ) => Promise<CallToolResult>;
  return await artifactCallback({ session, artifactId, worksheetName, worksheetFile }, extra);
}
