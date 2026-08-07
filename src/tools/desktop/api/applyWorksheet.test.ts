import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as episodeEvents from '../../../desktop/episode-events.js';
import { TemplateArtifactStore } from '../../../desktop/templates/templateArtifactStore.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import * as loadWorksheetXmlModule from '../../../desktop/wrappers/loadWorksheetXml.js';
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

vi.mock('../../../desktop/wrappers/loadWorksheetXml.js');
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
      'Apply a template artifact or a modified cached worksheet file to Desktop.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      worksheetFile: expect.any(Object),
      artifactId: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
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

  it('consumes a successfully dispatched artifact and reports failed verification as non-retryable', async () => {
    const store = artifactStore();
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockImplementation(async (args) => {
      expect(args.artifactApply?.dispatchState.attempted).toBe(false);
      expect(args.artifactApply?.expectedInstanceId).toBe('inst-build');
      args.artifactApply!.dispatchState.attempted = true;
      return Ok({
        readbackWarnings: [],
        readbackVerification: { ok: false, status: 'failed' },
      });
    });

    const result = await getArtifactToolResult(store, 'artifact-1', '12345');

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      artifactId: 'artifact-1',
      title: 'Artifact Sheet',
      applied: true,
      retrySafe: false,
      verification: { ok: false, status: 'failed' },
    });
    expect(store.reserve('artifact-1', '12345')).toEqual({ ok: false, reason: 'consumed' });
  });

  it('keeps a same-pid/new-instance mismatch usable for the correct instance', async () => {
    const store = artifactStore();
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockImplementationOnce(async (args) => {
        expect(args.artifactApply?.expectedInstanceId).toBe('inst-build');
        expect(args.artifactApply?.dispatchState.attempted).toBe(false);
        return Err({
          type: 'execute-command-error',
          error: { type: 'unknown', error: 'instance changed from inst-build to inst-restarted' },
        });
      })
      .mockImplementationOnce(async (args) => {
        expect(args.artifactApply?.expectedInstanceId).toBe('inst-build');
        args.artifactApply!.dispatchState.attempted = true;
        return Ok({
          readbackWarnings: [],
          readbackVerification: { ok: true, status: 'passed' },
        });
      });

    const mismatch = await getArtifactToolResult(store, 'artifact-1', '12345');
    expect(mismatch.isError).toBe(true);

    const stillUsable = store.reserve('artifact-1', '12345');
    expect(stillUsable.ok).toBe(true);
    if (!stillUsable.ok) return;
    store.release(stillUsable.lease);

    const correctInstance = await getArtifactToolResult(store, 'artifact-1', '12345');
    expect(correctInstance.isError).toBe(false);
    expect(store.reserve('artifact-1', '12345')).toEqual({ ok: false, reason: 'consumed' });
  });

  it('consumes an artifact after any possibly dispatched failure', async () => {
    const store = artifactStore();
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockImplementation(async (args) => {
      args.artifactApply!.dispatchState.attempted = true;
      return Err({
        type: 'execute-command-error',
        error: { type: 'unknown', error: new Error('connection lost after POST') },
      });
    });

    const result = await getArtifactToolResult(store, 'artifact-1', '12345');

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-1', '12345')).toEqual({ ok: false, reason: 'consumed' });
  });

  it('does not consume an artifact for the wrong Desktop session', async () => {
    const store = artifactStore();

    const result = await getArtifactToolResult(store, 'artifact-1', '99999');

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-1', '12345').ok).toBe(true);
    expect(loadWorksheetXmlModule.loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('checks artifact availability before resolving an executor', async () => {
    const store = artifactStore();
    const getExecutor = vi.fn().mockRejectedValue(new Error('Desktop unavailable'));
    const tool = getApplyWorksheetTool(new DesktopMcpServer(), { store });
    const callback = await Provider.from(tool.callback);

    const result = await callback(
      {
        session: '99999',
        artifactId: 'artifact-1',
        worksheetName: undefined,
        worksheetFile: undefined,
      },
      { ...getMockRequestHandlerExtra(), getExecutor },
    );

    expect(result.isError).toBe(true);
    expect(getExecutor).not.toHaveBeenCalled();
  });

  it('releases a reserved artifact when executor resolution throws', async () => {
    const store = artifactStore();
    const tool = getApplyWorksheetTool(new DesktopMcpServer(), { store });
    const callback = await Provider.from(tool.callback);

    const result = await callback(
      {
        session: '12345',
        artifactId: 'artifact-1',
        worksheetName: undefined,
        worksheetFile: undefined,
      },
      {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockRejectedValue(new Error('Desktop unavailable')),
      },
    );

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-1', '12345').ok).toBe(true);
  });

  it('allows only one concurrent apply for an artifact', async () => {
    const store = artifactStore();
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockImplementation(async (args) => {
      await blocked;
      args.artifactApply!.dispatchState.attempted = true;
      return Ok({ readbackWarnings: [], readbackVerification: { ok: true, status: 'passed' } });
    });

    const first = getArtifactToolResult(store, 'artifact-1', '12345');
    await vi.waitFor(() =>
      expect(loadWorksheetXmlModule.loadWorksheetXml).toHaveBeenCalledTimes(1),
    );
    const second = await getArtifactToolResult(store, 'artifact-1', '12345');
    expect(second.isError).toBe(true);
    invariant(second.content[0].type === 'text');
    expect(second.content[0].text).toContain('already being applied');
    finish();
    expect((await first).isError).toBe(false);
  });
});

function artifactStore(): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  store.put({
    id: 'artifact-1',
    sessionId: '12345',
    instanceId: 'inst-build',
    templateName: 'pulse-bar',
    templateSourceHash: 'source-hash',
    title: 'Artifact Sheet',
    datasource: 'target.ds',
    fieldMapping: { '{{field_base_1}}': '[target.ds].[sum:Revenue:qk]' },
    worksheetXml: '<worksheet name="Artifact Sheet"><table /></worksheet>',
    windowXml: '<window class="worksheet" name="Artifact Sheet" />',
    targetState: {
      worksheetName: 'Artifact Sheet',
      target: { state: 'absent' },
      targetWindow: { state: 'absent' },
      dependenciesSha256: 'dependencies',
    },
  });
  return store;
}

async function getArtifactToolResult(
  store: TemplateArtifactStore,
  artifactId: string,
  session: string,
): Promise<CallToolResult> {
  const tool = getApplyWorksheetTool(new DesktopMcpServer(), { store });
  const callback = await Provider.from(tool.callback);
  return await callback(
    { session, artifactId, worksheetName: undefined, worksheetFile: undefined },
    {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({}),
    },
  );
}

async function getToolResult({
  session,
  worksheetName,
  worksheetFile,
  worksheetXml,
  mockExecutor,
  customSignal,
  configOverrides,
}: {
  session: string;
  worksheetName: string;
  worksheetFile?: string;
  worksheetXml?: string;
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
  configOverrides?: Partial<TableauDesktopToolContext['config']>;
}): Promise<CallToolResult> {
  // The tool no longer takes a document. Tests that supplied XML directly now get a
  // synthetic cache path backed by the fs mock, so they still exercise the apply leg.
  if (worksheetXml !== undefined && worksheetFile === undefined) {
    worksheetFile = '/cache/synthetic-worksheet.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(worksheetXml);
  }

  const tool = getApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  extra.config = { ...extra.config, ...configOverrides };

  return await callback({ session, artifactId: undefined, worksheetName, worksheetFile }, extra);
}
