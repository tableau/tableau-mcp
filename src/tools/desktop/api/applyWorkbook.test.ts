import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import * as loadWorkbookXmlModule from '../../../desktop/wrappers/loadWorkbookXml.js';
import {
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyWorkbookTool } from './applyWorkbook.js';

vi.mock('../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('fs');

describe('applyWorkbookTool', () => {
  const resultSchema = z.object({
    message: z.string(),
  });
  const structuredSchema = z.object({
    message: z.string(),
    nextAction: z.object({
      kind: z.literal('done'),
      label: z.string(),
      receipt: z.object({
        did: z.array(z.string()),
        didNot: z.array(z.string()),
        unverified: z.array(z.string()),
      }),
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const applyWorkbookTool = getApplyWorkbookTool(new DesktopMcpServer());
    expect(applyWorkbookTool.name).toBe('apply-workbook');
    expect(applyWorkbookTool.description).toContain('Apply modified workbook content to Tableau');
    expect(applyWorkbookTool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      workbookFile: expect.any(Object),
    });
    expect(applyWorkbookTool.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
    });
  });

  it('should successfully apply workbook XML in inline mode', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied workbook update');
    expect(resultObj.message).toContain('HOST VERIFICATION — unverified');
    expect(resultObj.message).toContain('full workbook intent NOT re-verified');

    // The text block is unchanged: it still carries only { message }.
    expect(Object.keys(JSON.parse(result.content[0].text))).toEqual(['message']);

    // Superset rule: the structured block carries the full text message plus the
    // receipt, whose claims split observed (dispatch, preflight) from not observed
    // (structural readback — whole-workbook applies have none).
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(resultObj.message);
    expect(structured.nextAction.receipt).toEqual({
      did: [
        'Desktop accepted the workbook XML apply command',
        'preflight validation returned 0 warning(s)',
      ],
      didNot: [],
      unverified: [
        'whether the applied workbook retained its intended structure — no structural readback ran (whole workbook applies have none)',
      ],
    });
  });

  it('should successfully apply workbook XML in file mode', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const mockFilePath = '/path/to/workbook.twb';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied workbook update');

    expect(existsSync).toHaveBeenCalledWith(mockFilePath);
    expect(readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
  });

  it('refuses a file-mode apply when the cache sidecar fingerprint mismatches the session (W9)', async () => {
    const mockFilePath = '/path/to/workbook.twb';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<?xml version="1.0"?><workbook></workbook>');
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecar').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const loadSpy = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({
      session: '12345',
      workbookFile: mockFilePath,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('different Desktop session');
    // The guard must short-circuit BEFORE the workbook is applied.
    expect(loadSpy).not.toHaveBeenCalled();

    // vi.clearAllMocks() resets call history but not this spy's implementation, so
    // restore it explicitly to keep the fail-open default for the other file-mode tests.
    sidecarSpy.mockRestore();
  });

  it('should default to file mode when mode is not specified', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const mockFilePath = '/path/to/workbook.twb';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(false);
    expect(existsSync).toHaveBeenCalled();
  });

  it('should return error when no workbookFile is given', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('A non-empty workbook file path is required');
  });

  it('should return error when workbook file does not exist', async () => {
    const mockFilePath = '/nonexistent/workbook.twb';
    vi.mocked(existsSync).mockReturnValue(false);

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached workbook file not found');
  });

  it('should return error when file read fails', async () => {
    const mockFilePath = '/path/to/workbook.twb';
    const readError = new Error('Permission denied');

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookFile: mockFilePath,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when loadWorkbookXml command fails', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };

    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should return error when XML load fails', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const error = {
      type: 'load-workbook-xml-error' as const,
      error: { type: 'invalid-xml' as const },
    };

    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new WorkbookXmlLoadFailedError(error.error).message);
  });

  it('reports actionable failure text when Desktop rejected the load', async () => {
    // Bug 1 (P0): apply must not lie. When loadWorkbookXml surfaces Desktop's actual
    // load rejection, the tool must return isError with that error text — never the
    // canned "Successfully applied" message. This tool-level test exercises the
    // McpToolError message passthrough (xmlLoadErrorMessage): the command layer's
    // load-rejected message is surfaced verbatim, no longer JSON.stringify-wrapped.
    // (The classifier is NOT exercised here — the mock injects at the loadWorkbookXml
    // boundary, so the message it carries is what the tool must present unwrapped.)
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const deskError =
      'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
      'Invalid input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]';
    const error = {
      type: 'load-workbook-xml-error' as const,
      error: { type: 'load-rejected' as const, message: deskError },
    };

    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(Err(error));

    const mockExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '12345',
      workbookXml: mockXml,
      mockExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('Successfully applied');
    expect(result.content[0].text).toContain('Qualified Name Parse Error');
    // Presentation change: the message is surfaced as-is, not JSON.stringify-wrapped.
    expect(result.content[0].text).not.toMatch(/^\{/);
  });

  it('does not append the note for an under-cap inline apply', async () => {
    const smallXml = '<?xml version="1.0"?><workbook></workbook>';
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const result = await getToolResult({
      session: '12345',
      workbookXml: smallXml,
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).not.toContain('inline cap');
  });

  it('should pass the abort signal to loadWorkbookXml command', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const mockLoadWorkbookXml = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const mockExecutor = vi.fn().mockResolvedValue({});
    const customSignal = new AbortController().signal;

    await getToolResult({
      session: '12345',
      workbookXml: mockXml,
      mockExecutor,
      customSignal,
    });

    expect(mockLoadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        xml: mockXml,
        signal: customSignal,
      }),
    );
  });
});

async function getToolResult({
  session,
  workbookFile,
  workbookXml,
  mockExecutor,
  customSignal,
}: {
  session: string;
  workbookFile?: string;
  workbookXml?: string;
  mockExecutor: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const applyWorkbookTool = getApplyWorkbookTool(new DesktopMcpServer());
  const callback = await Provider.from(applyWorkbookTool.callback);

  // The tool no longer takes a document. Tests that supplied XML directly now get a
  // synthetic cache path backed by the fs mock, so they still exercise the apply leg.
  if (workbookXml !== undefined && workbookFile === undefined) {
    workbookFile = '/cache/synthetic-workbook.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(workbookXml);
  }

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session, workbookFile }, extra);
}
