import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as episodeEvents from '../../../desktop/episode-events.js';
import type { WorksheetTemplatePlan } from '../../../desktop/templates/buildTemplateWorksheetArtifact.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../desktop/templates/templateArtifactStore.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import * as listWorksheetsModule from '../../../desktop/wrappers/listWorksheets.js';
import * as loadWorksheetXmlModule from '../../../desktop/wrappers/loadWorksheetXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import * as worksheetEditBufferModule from '../authoring/fields/worksheetEditBuffer.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyWorksheetTool } from './applyWorksheet.js';

vi.mock('../../../desktop/wrappers/loadWorksheetXml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof loadWorksheetXmlModule>()),
  loadWorksheetXml: vi.fn(),
}));
vi.mock('../authoring/fields/worksheetEditBuffer.js');
vi.mock('../../../desktop/wrappers/listWorksheets.js');
vi.mock('fs');

describe('applyWorksheetTool', () => {
  const resultSchema = z.object({
    message: z.string(),
  });
  const receiptSchema = z.object({
    did: z.array(z.string()),
    didNot: z.array(z.string()),
    unverified: z.array(z.string()),
  });
  const nextActionSchema = z.object({
    kind: z.literal('done'),
    label: z.string(),
    receipt: receiptSchema,
  });
  const structuredSchema = z.object({
    message: z.string(),
    nextAction: nextActionSchema,
  });
  const artifactStructuredSchema = z.object({
    artifactId: z.string(),
    title: z.string(),
    applied: z.boolean(),
    retrySafe: z.boolean(),
    verification: z.object({ ok: z.boolean(), status: z.string() }),
    nextAction: nextActionSchema,
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
    vi.mocked(listWorksheetsModule.listWorksheets).mockResolvedValue(
      Ok({ count: 1, worksheets: [{ id: 'artifact-sheet-uuid', name: 'Artifact Sheet' }] }),
    );
  });

  afterEach(() => {
    episodeEvents.resetEpisodeEventsForTests();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getApplyWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-worksheet');
    expect(tool.description).toBe(
      'Build and apply an exact template plan, apply a template artifact, or update a cached worksheet file.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetName: expect.any(Object),
      worksheetFile: expect.any(Object),
      artifactId: expect.any(Object),
      templatePlan: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('applies an exact template plan once without storing a reusable artifact', async () => {
    const artifact = templateArtifact('direct-plan');
    const store = new TemplateArtifactStore();
    const put = vi.spyOn(store, 'put');
    const buildArtifact = vi.fn().mockReturnValue(Ok({ artifact, provenance: 'protected' }));
    const mockLoadWorksheetXml = vi
      .spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockImplementation(async (args) => {
        expect(args.artifactApply).toMatchObject({
          expectedInstanceId: 'inst-build',
          expectedTargetState: artifact.targetState,
        });
        args.artifactApply!.dispatchState.attempted = true;
        return Ok({
          readbackWarnings: [],
          readbackVerification: { ok: true, status: 'passed' },
        });
      });
    const executor = {
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: '<workbook><worksheets/><windows/></workbook>',
          instanceId: 'inst-build',
        }),
      ),
    };

    const result = await getDirectTemplateToolResult({
      buildArtifact,
      getExecutor: vi.fn().mockResolvedValue(executor),
      store,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      title: 'Artifact Sheet',
      applied: true,
      retrySafe: false,
      verification: { ok: true, status: 'passed' },
    });
    expect(mockLoadWorksheetXml).toHaveBeenCalledOnce();
    expect(buildArtifact).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    // A stale add-field/remove-field buffer for this sheet predates the direct-plan
    // apply and must not survive it.
    expect(worksheetEditBufferModule.clearStickyWorksheetFile).toHaveBeenCalledWith({
      session: '12345',
      worksheetId: 'artifact-sheet-uuid',
    });
  });

  it.each([
    ['invalid template', new ArgsValidationError('Template "missing" is not available.')],
    ['invalid datasource', new ArgsValidationError('Datasource "wrong" does not match.')],
    ['invalid binding', new ArgsValidationError('Missing required template field.')],
  ])('does not dispatch a direct plan with %s', async (_label, buildError) => {
    const result = await getDirectTemplateToolResult({
      buildArtifact: vi.fn().mockReturnValue(buildError.toErr()),
      getExecutor: vi.fn().mockResolvedValue({
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: '<workbook><worksheets/><windows/></workbook>',
            instanceId: 'inst-build',
          }),
        ),
      }),
    });

    expect(result.isError).toBe(true);
    expect(loadWorksheetXmlModule.loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('keeps post-dispatch direct-plan uncertainty non-retryable', async () => {
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockImplementation(async (args) => {
      args.artifactApply!.dispatchState.attempted = true;
      return Err({
        type: 'execute-command-error',
        error: { type: 'unknown', error: 'connection lost after POST' },
      });
    });

    const result = await getDirectTemplateToolResult({
      buildArtifact: vi
        .fn()
        .mockReturnValue(
          Ok({ artifact: templateArtifact('direct-plan'), provenance: 'protected' }),
        ),
      getExecutor: vi.fn().mockResolvedValue({
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: '<workbook><worksheets/><windows/></workbook>',
            instanceId: 'inst-build',
          }),
        ),
      }),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Do not retry');
  });

  it.each([
    {
      artifactId: 'artifact-1',
      templatePlan: directTemplatePlan(),
      worksheetName: undefined,
      worksheetFile: undefined,
    },
    {
      artifactId: undefined,
      templatePlan: directTemplatePlan(),
      worksheetName: 'Sheet 1',
      worksheetFile: '/cache/sheet.xml',
    },
    {
      artifactId: undefined,
      templatePlan: undefined,
      worksheetName: 'Sheet 1',
      worksheetFile: undefined,
    },
    {
      artifactId: undefined,
      templatePlan: undefined,
      worksheetName: undefined,
      worksheetFile: undefined,
    },
  ])('rejects ambiguous or incomplete apply modes before resolving Desktop', async (args) => {
    const getExecutor = vi.fn();
    const tool = getApplyWorksheetTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);

    const result = await callback({ session: '12345', ...args } as any, {
      ...getMockRequestHandlerExtra(),
      getExecutor,
    });

    expect(result.isError).toBe(true);
    expect(getExecutor).not.toHaveBeenCalled();
    expect(loadWorksheetXmlModule.loadWorksheetXml).not.toHaveBeenCalled();
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

    // The text block is unchanged: it still carries only { message }.
    expect(Object.keys(JSON.parse(result.content[0].text))).toEqual(['message']);

    // Superset rule: the structured block carries the full text message plus the
    // receipt. No readback ran here, so the receipt claims only dispatch and
    // preflight, and lists the applied structure as unverified.
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(resultObj.message);
    expect(structured.nextAction.receipt).toEqual({
      did: [
        'Desktop accepted the worksheet XML apply for "Sheet 1"',
        'preflight validation returned 0 warning(s)',
      ],
      didNot: [],
      unverified: [
        'whether the applied worksheet retained its intended structure — post-apply readback was unavailable',
      ],
    });
  });

  it('should successfully apply worksheet XML in file mode', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    const mockFilePath = '/path/to/worksheet.xml';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecar').mockReturnValue({
      ok: true,
      sourceHash: 'd'.repeat(64),
    });
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
    expect(loadWorksheetXmlModule.loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSourceHash: 'd'.repeat(64) }),
    );
    sidecarSpy.mockRestore();
  });

  it('resolves a worksheet id against the fragment simple-id for cached-file apply', async () => {
    const mockXml =
      "<worksheet name='Sales Detail'><simple-id uuid='{SHEET-GUID-9}' /><table></table></worksheet>";
    const mockLoadWorksheetXml = vi
      .spyOn(loadWorksheetXmlModule, 'loadWorksheetXml')
      .mockResolvedValue(Ok({ appliedName: 'Renamed Live', readbackWarnings: [] }));

    const result = await getToolResult({
      session: '12345',
      worksheetName: '{SHEET-GUID-9}',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied worksheet update for "Renamed Live"');
    expect(mockLoadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sales Detail' }),
    );
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

    // The readback ran, so its outcome is an observation the receipt may claim;
    // rendered output stays unverified because readback compares XML only.
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(resultSchema.parse(JSON.parse(result.content[0].text)).message);
    expect(structured.nextAction.receipt).toEqual({
      did: [
        'Desktop accepted the worksheet XML apply for "Sheet 1"',
        'preflight validation returned 0 warning(s)',
        'read back the applied worksheet — verification status "passed", promise outcome "verified"',
      ],
      didNot: [],
      unverified: [
        'whether the sheet renders as intended — readback compared workbook XML, not rendered output',
      ],
    });
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

  it('closes the sticky edit buffer keyed on the live sheet id after a successful cached-file apply', async () => {
    const mockXml = '<worksheet name="Sheet 1"><table></table></worksheet>';
    vi.mocked(listWorksheetsModule.listWorksheets).mockResolvedValue(
      Ok({ count: 1, worksheets: [{ id: 'live-sheet-uuid', name: 'Sheet 1' }] }),
    );
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ readbackWarnings: [] }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    expect(worksheetEditBufferModule.clearStickyWorksheetFile).toHaveBeenCalledWith({
      session: '12345',
      worksheetId: 'live-sheet-uuid',
    });
  });

  it('closes the buffer for an id-less fragment by resolving the live id from the applied name', async () => {
    // An id-less cached fragment applies via the name fallback; keying the clear on the
    // fragment's absent simple-id skipped it, so a later name-only edit resumed the stale buffer.
    const mockXml = '<worksheet name="Old Name"><table></table></worksheet>';
    vi.mocked(listWorksheetsModule.listWorksheets).mockResolvedValue(
      Ok({ count: 1, worksheets: [{ id: 'live-sheet-uuid', name: 'Renamed Live' }] }),
    );
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Ok({ appliedName: 'Renamed Live', readbackWarnings: [] }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Old Name',
      worksheetXml: mockXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    expect(worksheetEditBufferModule.clearStickyWorksheetFile).toHaveBeenCalledWith({
      session: '12345',
      worksheetId: 'live-sheet-uuid',
    });
  });

  it('does not close the sticky edit buffer when the cached-file apply fails', async () => {
    vi.spyOn(loadWorksheetXmlModule, 'loadWorksheetXml').mockResolvedValue(
      Err({ type: 'load-worksheet-xml-error', error: { type: 'invalid-xml' } }),
    );

    const result = await getToolResult({
      session: '12345',
      worksheetName: 'Sheet 1',
      worksheetXml: '<worksheet name="Sheet 1"><table></table></worksheet>',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(true);
    expect(worksheetEditBufferModule.clearStickyWorksheetFile).not.toHaveBeenCalled();
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

    // The text block is unchanged: it still carries only the artifact result body.
    expect(Object.keys(JSON.parse(result.content[0].text))).toEqual([
      'artifactId',
      'title',
      'applied',
      'retrySafe',
      'verification',
    ]);

    // Superset rule: the structured block folds the same artifact body in — an
    // observed failed readback, not a success claim. A failed verification must NOT
    // mint a 'done' marker (that tells the agent to stop and would bury the failure);
    // it directs the agent to inspect the sheet and build a fresh artifact instead.
    const structured = artifactStructuredSchema
      .extend({ nextAction: z.object({ kind: z.literal('prefill'), label: z.string() }) })
      .parse(result.structuredContent);
    expect(structured).toMatchObject({
      artifactId: 'artifact-1',
      title: 'Artifact Sheet',
      applied: true,
      retrySafe: false,
      verification: { ok: false, status: 'failed' },
    });
    expect(structured.nextAction).toEqual({
      kind: 'prefill',
      label: 'Verification failed — inspect sheet, rebuild artifact',
    });
    expect(store.reserve('artifact-1', '12345')).toEqual({ ok: false, reason: 'consumed' });
    // Applied (even with a failed readback) — the sheet changed, so any prior
    // add-field/remove-field buffer for it is stale and must be closed.
    expect(worksheetEditBufferModule.clearStickyWorksheetFile).toHaveBeenCalledWith({
      session: '12345',
      worksheetId: 'artifact-sheet-uuid',
    });
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
        templatePlan: undefined,
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
        templatePlan: undefined,
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
    {
      session,
      artifactId,
      templatePlan: undefined,
      worksheetName: undefined,
      worksheetFile: undefined,
    },
    {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue({}),
    },
  );
}

const directTemplatePlan = (): WorksheetTemplatePlan => ({
  templateName: 'pulse-bar',
  title: 'Artifact Sheet',
  datasource: 'target.ds',
  fieldMapping: { field_base_1: '[target.ds].[sum:Revenue:qk]' },
});

function templateArtifact(id: string): TemplateWorksheetArtifact {
  return {
    id,
    sessionId: '12345',
    instanceId: 'inst-build',
    templateName: 'pulse-bar',
    templateSourceHash: 'source-hash',
    title: 'Artifact Sheet',
    datasource: 'target.ds',
    fieldMapping: { field_base_1: '[target.ds].[sum:Revenue:qk]' },
    worksheetXml: '<worksheet name="Artifact Sheet"><table /></worksheet>',
    windowXml: '<window class="worksheet" name="Artifact Sheet" />',
    targetState: {
      worksheetName: 'Artifact Sheet',
      target: { state: 'absent' as const },
      targetWindow: { state: 'absent' as const },
      dependenciesSha256: 'dependencies',
    },
  };
}

async function getDirectTemplateToolResult({
  buildArtifact,
  getExecutor,
  store,
}: {
  buildArtifact: ReturnType<typeof vi.fn>;
  getExecutor: TableauDesktopToolContext['getExecutor'];
  store?: TemplateArtifactStore;
}): Promise<CallToolResult> {
  const tool = (getApplyWorksheetTool as any)(new DesktopMcpServer(), {
    buildArtifact,
    createId: () => 'direct-plan',
    store,
  });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactId: undefined,
      templatePlan: directTemplatePlan(),
      worksheetName: undefined,
      worksheetFile: undefined,
    },
    { ...getMockRequestHandlerExtra(), getExecutor },
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

  return await callback(
    { session, artifactId: undefined, templatePlan: undefined, worksheetName, worksheetFile },
    extra,
  );
}
