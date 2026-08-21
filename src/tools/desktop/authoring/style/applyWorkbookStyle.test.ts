import { createHash } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import * as episodeEvents from '../../../../desktop/episode-events.js';
import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { workbookTargetFingerprint } from '../../api/workbookTargetFingerprint.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getApplyWorkbookStyleTool } from './applyWorkbookStyle.js';

const { fileLogSpy } = vi.hoisted(() => ({ fileLogSpy: vi.fn() }));

vi.mock('../../../../logging/fileLogger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../logging/fileLogger.js')>()),
  getFileLogger: () => ({ log: fileLogSpy }),
}));

const REDACTION = '[redacted custom theme JSON]';
const theme = {
  version: '1.0.0',
  'base-theme': 'default',
  styles: { 'worksheet-title': { 'font-color': '#7A2E8E' } },
};
const themeJson = JSON.stringify(theme);
const themeSha256 = sha256(themeJson);
const themeName = `studio-theme-${themeSha256.slice(0, 12)}`;
const selectedThemeXml = workbookXml(themeName);
const workbookInventory = {
  title: 'Book 2',
  location: null,
  unsavedChanges: true,
  worksheets: [{ id: 'sheet-1', name: 'se-eval-scratch', hidden: false }],
  dashboards: [],
  storyboards: [],
};
const expectedWorkbookTarget = workbookTargetFingerprint(workbookInventory);

describe('apply-workbook-style', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers only the native Custom Theme inputs', async () => {
    const tool = getApplyWorkbookStyleTool(new DesktopMcpServer());
    const schema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('apply-workbook-style');
    expect(Object.keys(schema)).toEqual([
      'session',
      'themeJson',
      'themeSha256',
      'expectedWorkbookTarget',
    ]);
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(schema.themeJson.safeParse('x').success).toBe(false);
    expect(schema.themeJson.safeParse('x'.repeat(64 * 1024)).success).toBe(true);
    expect(schema.themeJson.safeParse('x'.repeat(64 * 1024 + 1)).success).toBe(false);
    expect(schema.themeSha256.safeParse('A'.repeat(64)).success).toBe(false);
    expect(schema.expectedWorkbookTarget.safeParse('a'.repeat(64)).success).toBe(true);
    expect(schema.expectedWorkbookTarget.safeParse('short').success).toBe(false);
  });

  it('accepts an exact 64 KiB UTF-8 multibyte theme', async () => {
    const exactThemeJson = multibyteThemeJson(64 * 1024);
    const exactThemeSha = sha256(exactThemeJson);
    const exactThemeName = `studio-theme-${exactThemeSha.slice(0, 12)}`;
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValue(Ok(workbookDocument(workbookXml(exactThemeName)))),
    });

    const result = await callTool({
      executor,
      args: {
        session: 'S1',
        themeJson: exactThemeJson,
        themeSha256: exactThemeSha,
        expectedWorkbookTarget,
      },
    });

    expect(result.isError).toBe(false);
    expect(executor.executeCommand).toHaveBeenCalledOnce();
  });

  it('rejects a 64 KiB plus one UTF-8 multibyte theme before reading or writing Desktop', async () => {
    const oversizedThemeJson = multibyteThemeJson(64 * 1024 + 1);
    const executor = makeExecutorMock();

    const result = await callTool({
      executor,
      args: {
        session: 'S1',
        themeJson: oversizedThemeJson,
        themeSha256: sha256(oversizedThemeJson),
        expectedWorkbookTarget,
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(oversizedThemeJson);
    expect(executor.getWorkbook).not.toHaveBeenCalled();
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('sends the exact validated source once and verifies the direct root theme reference', async () => {
    const order: string[] = [];
    const executor = makeExecutorMock({
      getWorkbook: vi.fn(async () => {
        order.push('target');
        return Ok(workbookInventory);
      }),
      executeCommand: vi.fn(async () => {
        order.push('command');
        return Ok(commandSuccess());
      }),
      getWorkbookDocument: vi.fn(async () => {
        order.push('readback');
        return Ok(workbookDocument(selectedThemeXml));
      }),
    });
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();

    const result = await callTool({ executor });
    const body = bodyOf(result);

    expect(result.isError).toBe(false);
    expect(order).toEqual(['target', 'command', 'readback']);
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    expect(executor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabdoc',
      command: 'apply-theme',
      expectedInstanceId: 'instance-live',
      args: {
        'file-contents': themeJson,
        'file-name': themeName,
        'should-clear': 'true',
        'theme-json-syntax': 'high-level',
      },
      signal: expect.any(AbortSignal),
    });
    expect(executor.getWorkbookDocument).toHaveBeenCalledOnce();
    expect(body).toEqual({
      applied: true,
      retrySafe: false,
      themeName,
      themeSha256,
      verification: {
        status: 'passed',
        themeReference: 'passed',
        message: 'Workbook readback confirms Desktop selected the requested native theme.',
      },
    });
    expect(result.structuredContent?.nextAction).toMatchObject({
      kind: 'done',
      receipt: {
        did: [expect.stringContaining('selected the requested native theme')],
        didNot: [],
        unverified: expect.arrayContaining([
          expect.stringContaining('Individual theme settings'),
          expect.stringContaining('Workbook semantic preservation'),
          expect.stringContaining('Rendered appearance'),
          expect.stringContaining('Image export'),
          expect.stringContaining('Save/reopen persistence'),
        ]),
      },
    });
    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'apply_succeeded',
        operation: 'apply-native-custom-theme',
        promise_outcome: 'verified',
      }),
    );
  });

  it('rejects a changed workbook target before sending the native theme command', async () => {
    const executor = makeExecutorMock({
      getWorkbook: vi.fn().mockResolvedValue(
        Ok({
          ...workbookInventory,
          worksheets: [{ id: 'other', name: 'Other Sheet', hidden: false }],
        }),
      ),
    });

    const result = await callTool({ executor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      verification: {
        status: 'not-run',
        themeReference: 'not-run',
        message: 'The current workbook changed after review; the theme command was not sent.',
      },
    });
    expect(result.structuredContent?.nextAction).toEqual({
      kind: 'prefill',
      label: 'Review the style guide again before applying it',
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a workbook target read failure before sending the native theme command', async () => {
    const executor = makeExecutorMock({
      getWorkbook: vi
        .fn()
        .mockResolvedValue(
          Err({ type: 'command-timed-out' as const, error: 'inventory unavailable' }),
        ),
    });

    const result = await callTool({ executor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(result.structuredContent?.nextAction).toEqual({
      kind: 'prefill',
      label: 'Review the style guide again before applying it',
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('rejects a thrown workbook target read before sending the native theme command', async () => {
    const executor = makeExecutorMock({
      getWorkbook: vi.fn().mockRejectedValue(new Error('PRIVATE WORKBOOK DETAIL')),
    });

    const result = await callTool({ executor });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.nextAction).toEqual({
      kind: 'prefill',
      label: 'Review the style guide again before applying it',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE WORKBOOK DETAIL');
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('polls after the command until the direct root theme reference matches', async () => {
    vi.useFakeTimers();
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValueOnce(Ok(workbookDocument('<workbook/>')))
        .mockResolvedValueOnce(Ok(workbookDocument(selectedThemeXml))),
    });

    const pending = callTool({ executor });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.isError).toBe(false);
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['invalid JSON', '{', sha256('{')],
    ['hash mismatch', themeJson, '0'.repeat(64)],
  ])('fails safely before invocation for %s', async (_case, candidateJson, candidateSha) => {
    const executor = makeExecutorMock();
    const getExecutor = vi.fn().mockResolvedValue(executor);

    const result = await callTool({
      executor,
      getExecutor,
      args: {
        session: 'S1',
        themeJson: candidateJson,
        themeSha256: candidateSha,
        expectedWorkbookTarget,
      },
    });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      themeSha256: candidateSha,
      verification: { status: 'not-run', themeReference: 'not-run' },
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
  });

  it('fails safely when the session cannot be resolved', async () => {
    const executor = makeExecutorMock();
    const getExecutor = vi.fn().mockResolvedValue(executor);

    const result = await callTool({
      executor,
      getExecutor,
      args: { session: 'default', themeJson, themeSha256, expectedWorkbookTarget },
    });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(getExecutor).not.toHaveBeenCalled();
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('fails safely when executor acquisition fails before invocation', async () => {
    const executor = makeExecutorMock();

    const result = await callTool({
      executor,
      getExecutor: vi.fn().mockRejectedValue(new Error('executor unavailable')),
    });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('fails safely when the executor has no Desktop instance identity', async () => {
    const executor = makeExecutorMock();

    const result = await callTool({ executor, instanceId: null });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      verification: { status: 'not-run', themeReference: 'not-run' },
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
  });

  it.each([
    [
      'command failure',
      makeExecutorMock({
        executeCommand: vi
          .fn()
          .mockResolvedValue(
            Err({ type: 'command-timed-out' as const, error: 'uncertain dispatch' }),
          ),
      }),
    ],
    [
      'readback failure',
      makeExecutorMock({
        executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
        getWorkbookDocument: vi
          .fn()
          .mockResolvedValue(
            Err({ type: 'command-timed-out' as const, error: 'readback timeout' }),
          ),
      }),
    ],
    [
      'malformed readback',
      makeExecutorMock({
        executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
        getWorkbookDocument: vi.fn().mockResolvedValue(Ok(workbookDocument('<workbook>'))),
      }),
    ],
  ])('returns unknown without retrying after %s', async (_case, executor) => {
    const result = await callTool({ executor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      verification: { status: 'unknown', themeReference: 'unknown' },
    });
    expect(result.structuredContent?.nextAction).toMatchObject({
      kind: 'prefill',
      label: expect.stringMatching(/inspect.*do not retry/i),
    });
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    expect(vi.mocked(executor.getWorkbookDocument).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('times out unmatched readback as unknown with one command attempt', async () => {
    vi.useFakeTimers();
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
      getWorkbookDocument: vi.fn().mockResolvedValue(Ok(workbookDocument('<workbook/>'))),
    });

    const pending = callTool({ executor });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(8);
  });

  it('holds the shared apply lock through readback', async () => {
    let releaseFirstRead!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let readCount = 0;
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
      getWorkbookDocument: vi.fn(async () => {
        readCount += 1;
        if (readCount === 1) await firstRead;
        return Ok(workbookDocument(selectedThemeXml));
      }),
    });

    const first = callTool({ executor });
    await vi.waitFor(() => expect(executor.executeCommand).toHaveBeenCalledTimes(1));
    const second = callTool({ executor });
    await Promise.resolve();
    expect(executor.executeCommand).toHaveBeenCalledTimes(1);

    releaseFirstRead();
    await Promise.all([first, second]);

    expect(executor.executeCommand).toHaveBeenCalledTimes(2);
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('redacts theme JSON from invocation notification and file-log payload', async () => {
    const sentinel = 'NEVER_LOG_THEME_SENTINEL_6f8e';
    const privateJson = JSON.stringify({
      ...theme,
      styles: { worksheet: { 'font-family': sentinel } },
    });
    const privateSha = sha256(privateJson);
    const privateName = `studio-theme-${privateSha.slice(0, 12)}`;
    fileLogSpy.mockResolvedValue(undefined);
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(commandSuccess())),
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValue(Ok(workbookDocument(workbookXml(privateName)))),
    });

    const { result, notification } = await callToolWithServer({
      executor,
      args: {
        session: 'S1',
        themeJson: privateJson,
        themeSha256: privateSha,
        expectedWorkbookTarget,
      },
    });
    await vi.waitFor(() => expect(fileLogSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(notification).toHaveBeenCalled());
    const observable = JSON.stringify({
      notifications: notification.mock.calls,
      fileLogs: fileLogSpy.mock.calls,
    });

    expect(result.isError).toBe(false);
    expect(observable).toContain(REDACTION);
    expect(observable).not.toContain(privateJson);
    expect(observable).not.toContain(sentinel);
    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ 'file-contents': privateJson }),
      }),
    );
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function multibyteThemeJson(byteCount: number): string {
  const base = JSON.stringify({
    version: '1.0.0',
    'base-theme': 'default',
    styles: { worksheet: { 'font-family': 'Tableau 日本語' } },
  });
  const themeJson = `${base}${' '.repeat(byteCount - Buffer.byteLength(base, 'utf8'))}`;
  expect(Buffer.byteLength(themeJson, 'utf8')).toBe(byteCount);
  expect(themeJson.length).toBeLessThan(byteCount);
  return themeJson;
}

function workbookXml(name: string): string {
  return `<workbook><style-theme name="custom" value="${name}"/></workbook>`;
}

function workbookDocument(xml: string): {
  xml: string;
  applicationVersion: undefined;
  xsdPayloadVersion: undefined;
  instanceId: string;
} {
  return {
    xml,
    applicationVersion: undefined,
    xsdPayloadVersion: undefined,
    instanceId: 'instance-live',
  };
}

function commandSuccess(): {
  command_id: string;
  status: 'completed';
  submitted_at: string;
} {
  return { command_id: 'theme-1', status: 'completed' as const, submitted_at: 'now' };
}

type ToolArgs = {
  session: string;
  themeJson: string;
  themeSha256: string;
  expectedWorkbookTarget: string;
};

async function callTool({
  executor,
  getExecutor = vi.fn().mockResolvedValue(executor),
  args = { session: 'S1', themeJson, themeSha256, expectedWorkbookTarget },
  instanceId = 'instance-live',
}: {
  executor: ExternalApiToolExecutor;
  getExecutor?: ReturnType<typeof vi.fn>;
  args?: ToolArgs;
  instanceId?: string | null;
}): Promise<CallToolResult> {
  return (await callToolWithServer({ executor, getExecutor, args, instanceId })).result;
}

async function callToolWithServer({
  executor,
  getExecutor = vi.fn().mockResolvedValue(executor),
  args = { session: 'S1', themeJson, themeSha256, expectedWorkbookTarget },
  instanceId = 'instance-live',
}: {
  executor: ExternalApiToolExecutor;
  getExecutor?: ReturnType<typeof vi.fn>;
  args?: ToolArgs;
  instanceId?: string | null;
}): Promise<{ result: CallToolResult; notification: ReturnType<typeof vi.fn> }> {
  const getWorkbook = vi.mocked(executor.getWorkbook);
  if (!getWorkbook.getMockImplementation()) {
    getWorkbook.mockResolvedValue(Ok(workbookInventory));
  }
  (executor as unknown as { desktopInstanceId: string | undefined }).desktopInstanceId =
    instanceId ?? undefined;
  const server = new DesktopMcpServer();
  const notification = vi.fn();
  (
    server as unknown as { mcpServer: { server: { notification: ReturnType<typeof vi.fn> } } }
  ).mcpServer = { server: { notification } };
  const tool = getApplyWorkbookStyleTool(server);
  const callback = await Provider.from(tool.callback);
  const result = await callback(args, { ...getMockRequestHandlerExtra(), getExecutor });
  return { result, notification };
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}
