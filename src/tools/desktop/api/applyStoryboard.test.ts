import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cachePathModule from '../../../desktop/cachePath.js';
import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import * as loadDashboardXmlModule from '../../../desktop/wrappers/loadDashboardXml.js';
import { DesktopCommandExecutionError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockContainedCacheReadFromFs } from './applyPreamble.testUtils.js';
import { getApplyStoryboardTool } from './applyStoryboard.js';

vi.mock('../../../desktop/wrappers/loadDashboardXml.js');
vi.mock('../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof cachePathModule>()),
  readContainedCacheTextFile: vi.fn(),
}));
vi.mock('fs');

describe('applyStoryboardTool', () => {
  const resultSchema = z.object({ message: z.string() });
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
    mockContainedCacheReadFromFs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getApplyStoryboardTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-storyboard');
    expect(tool.description).toContain('Apply modified storyboard document to Tableau');
    expect(tool.description).toContain('freshness check');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      storyboardName: expect.any(Object),
      storyboardFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('applies the storyboard document via loadStoryboardXml', async () => {
    const mockXml = '<dashboard name="QBR Story" type="storyboard"><zones></zones></dashboard>';
    const loadSpy = vi
      .spyOn(loadDashboardXmlModule, 'loadStoryboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({ storyboardXml: mockXml });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied storyboard update');
    expect(resultObj.message).toContain('HOST VERIFICATION — unverified');
    expect(loadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ storyboardName: 'QBR Story', xml: mockXml }),
    );

    // The text block is unchanged: it still carries only { message }.
    expect(Object.keys(JSON.parse(result.content[0].text))).toEqual(['message']);

    // Superset rule: the structured block carries the full text message plus the
    // receipt, whose claims split observed (dispatch, preflight) from not observed
    // (structural readback — storyboard applies have none).
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(resultObj.message);
    expect(structured.nextAction.receipt).toEqual({
      did: [
        'Desktop accepted the storyboard XML apply for "QBR Story"',
        'preflight validation returned 0 warning(s)',
      ],
      didNot: [],
      unverified: [
        'whether the applied storyboard retained its intended structure — no structural readback ran (storyboard applies have none)',
      ],
    });
  });

  it('passes the cached source hash to the storyboard apply', async () => {
    const mockXml = '<dashboard name="QBR Story" type="storyboard"><zones></zones></dashboard>';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: true,
      sourceHash: 'c'.repeat(64),
    });
    const loadSpy = vi
      .spyOn(loadDashboardXmlModule, 'loadStoryboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({ storyboardFile: '/path/to/storyboard.xml' });

    expect(result.isError).toBe(false);
    expect(loadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSourceHash: 'c'.repeat(64) }),
    );
    sidecarSpy.mockRestore();
  });

  it('refuses a file-mode apply when the cache sidecar fingerprint mismatches the session (W9)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '<dashboard name="QBR Story" type="storyboard"></dashboard>',
    );
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const loadSpy = vi
      .spyOn(loadDashboardXmlModule, 'loadStoryboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({ storyboardFile: '/path/to/storyboard.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('different Desktop session');
    expect(loadSpy).not.toHaveBeenCalled();
    // Restore so the fail-open default holds for the other file-mode tests.
    expect(sidecarSpy).toHaveBeenCalledWith(
      '/path/to/storyboard.xml',
      expect.any(String),
      'storyboard',
      { type: 'missing' },
    );
    sidecarSpy.mockRestore();
  });

  it('should return error when no storyboardFile is given', async () => {
    const result = await getToolResult({});

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('A non-empty storyboard file path is required');
  });

  it('should return error when storyboard file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getToolResult({ storyboardFile: '/nonexistent.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached storyboard file not found');
  });

  it('should return error when file read fails', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getToolResult({ storyboardFile: '/path/to/storyboard.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when loadStoryboardXml command fails', async () => {
    const mockXml = '<dashboard name="QBR Story" type="storyboard"><zones></zones></dashboard>';
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadDashboardXmlModule, 'loadStoryboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ storyboardXml: mockXml });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should pass the abort signal to loadStoryboardXml', async () => {
    const mockXml = '<dashboard name="QBR Story" type="storyboard"><zones></zones></dashboard>';
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadStoryboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));
    const customSignal = new AbortController().signal;

    await getToolResult({ storyboardXml: mockXml, customSignal });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ xml: mockXml, signal: customSignal }),
    );
  });
});

async function getToolResult({
  session = '12345',
  storyboardName = 'QBR Story',
  storyboardFile,
  storyboardXml,
  mockExecutor = vi.fn().mockResolvedValue({}),
  customSignal,
}: {
  session?: string;
  storyboardName?: string;
  storyboardFile?: string;
  storyboardXml?: string;
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getApplyStoryboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  // The tool takes no inline document. Tests that supply XML directly get a synthetic cache path
  // backed by the fs mock, so they still exercise the apply leg.
  if (storyboardXml !== undefined && storyboardFile === undefined) {
    storyboardFile = '/cache/synthetic-storyboard.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(storyboardXml);
  }

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  return await callback({ session, storyboardName, storyboardFile }, extra);
}
