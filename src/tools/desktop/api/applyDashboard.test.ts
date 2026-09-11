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
import { getApplyDashboardTool } from './applyDashboard.js';
import { mockContainedCacheReadFromFs } from './applyPreamble.testUtils.js';

vi.mock('../../../desktop/wrappers/loadDashboardXml.js');
vi.mock('../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof cachePathModule>()),
  readContainedCacheTextFile: vi.fn(),
}));
vi.mock('fs');

describe('applyDashboardTool', () => {
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
    const tool = getApplyDashboardTool(new DesktopMcpServer());
    expect(tool.name).toBe('apply-dashboard');
    expect(tool.description).toContain('Apply modified dashboard layout to Tableau');
    expect(tool.description).toContain('freshness check');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      dashboardFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should successfully apply dashboard XML in inline mode', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const result = await getToolResult({
      dashboardXml: mockXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied dashboard update');
    expect(resultObj.message).toContain('HOST VERIFICATION — unverified');
    expect(resultObj.message).toContain('full dashboard intent NOT re-verified');

    // The text block is unchanged: it still carries only { message }.
    expect(Object.keys(JSON.parse(result.content[0].text))).toEqual(['message']);

    // Superset rule: the structured block carries the full text message plus the
    // receipt, whose claims split observed (dispatch, preflight) from not observed
    // (structural readback — dashboard applies have none).
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(resultObj.message);
    expect(structured.nextAction.receipt).toEqual({
      did: [
        'Desktop accepted the dashboard XML apply for "Sales Dashboard"',
        'preflight validation returned 0 warning(s)',
      ],
      didNot: [],
      unverified: [
        'whether the applied dashboard retained its intended layout — no structural readback ran (dashboard applies have none)',
      ],
    });
  });

  it('should successfully apply dashboard XML in file mode', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const mockFilePath = '/path/to/dashboard.xml';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: true,
      sourceHash: 'b'.repeat(64),
    });
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );

    const result = await getToolResult({ dashboardFile: mockFilePath });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const resultObj = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(resultObj.message).toContain('Successfully applied dashboard update');
    expect(existsSync).toHaveBeenCalledWith(mockFilePath);
    expect(readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
    expect(loadDashboardXmlModule.loadDashboardXml).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSourceHash: 'b'.repeat(64) }),
    );
    sidecarSpy.mockRestore();
  });

  it('refuses a file-mode apply when the cache sidecar fingerprint mismatches the session (W9)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<dashboard name="Sales Dashboard"></dashboard>');
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const loadSpy = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));

    const result = await getToolResult({ dashboardFile: '/path/to/dashboard.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('different Desktop session');
    expect(loadSpy).not.toHaveBeenCalled();

    // vi.clearAllMocks() resets call history but not this spy's implementation, so
    // restore it explicitly to keep the fail-open default for the other file-mode tests.
    sidecarSpy.mockRestore();
  });

  it('should return error when no dashboardFile is given', async () => {
    const result = await getToolResult({});

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('A non-empty dashboard file path is required');
  });

  it('should return error when dashboard file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getToolResult({ dashboardFile: '/nonexistent.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Cached dashboard file not found');
  });

  it('should return error when file read fails', async () => {
    const readError = new Error('Permission denied');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw readError;
    });

    const result = await getToolResult({ dashboardFile: '/path/to/dashboard.xml' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new FileReadError(readError).message);
  });

  it('should return error when loadDashboardXml command fails', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const error = {
      type: 'execute-command-error' as const,
      error: {
        type: 'command-failed' as const,
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      },
    };
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ dashboardXml: mockXml });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error.error).message);
  });

  it('should pass the abort signal to loadDashboardXml', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const mockLoad = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [] }));
    const customSignal = new AbortController().signal;

    await getToolResult({ dashboardXml: mockXml, customSignal });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ xml: mockXml, signal: customSignal }),
    );
  });
});

async function getToolResult({
  session = '12345',
  dashboardName = 'Sales Dashboard',
  dashboardFile,
  dashboardXml,
  mockExecutor = vi.fn().mockResolvedValue({}),
  customSignal,
}: {
  session?: string;
  dashboardName?: string;
  dashboardFile?: string;
  dashboardXml?: string;
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getApplyDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  // The tool no longer takes a document. Tests that supplied XML directly now get a
  // synthetic cache path backed by the fs mock, so they still exercise the apply leg.
  if (dashboardXml !== undefined && dashboardFile === undefined) {
    dashboardFile = '/cache/synthetic-dashboard.xml';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(dashboardXml);
  }

  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };
  return await callback({ session, dashboardName, dashboardFile }, extra);
}
