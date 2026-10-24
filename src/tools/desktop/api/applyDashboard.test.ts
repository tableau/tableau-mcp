import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cachePathModule from '../../../desktop/cachePath.js';
import * as episodeEvents from '../../../desktop/episode-events.js';
import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import type { LoadDashboardXmlOk } from '../../../desktop/wrappers/loadDashboardXml.js';
import * as loadDashboardXmlModule from '../../../desktop/wrappers/loadDashboardXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.desktop.js';
import { FileReadError } from '../../../errors/mcpToolError.js';
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
      Ok({ validationWarnings: [], documentWarnings: [] }),
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
        'whether the applied dashboard retained its intended layout — no structural readback ran (dashboard applies read back only when they register new worksheet views)',
      ],
    });
  });

  it('shows Desktop warnings and does not mark a warned dashboard apply done', async () => {
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: warnings }),
    );

    const result = await getToolResult({
      dashboardXml: '<dashboard name="Sales Dashboard"><zones></zones></dashboard>',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const { message } = resultSchema.parse(JSON.parse(result.content[0].text));
    expect(message).not.toContain('Successfully applied');
    expect(message).toContain('Desktop reported 1 warning(s)');
    expect(message).toContain('dropped-node: Removed an unsupported zone.');
    expect(message).toContain("Desktop's warnings are host evidence");
    expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
    expect(result.structuredContent).not.toMatchObject({ nextAction: { kind: 'done' } });
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
      Ok({ validationWarnings: [], documentWarnings: [] }),
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

  it('refuses a file-mode apply when the cache sidecar fingerprint mismatches the session', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<dashboard name="Sales Dashboard"></dashboard>');
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const loadSpy = vi
      .spyOn(loadDashboardXmlModule, 'loadDashboardXml')
      .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [] }));

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
      .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [] }));
    const customSignal = new AbortController().signal;

    await getToolResult({ dashboardXml: mockXml, customSignal });

    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ xml: mockXml, signal: customSignal }),
    );
  });

  describe('readback verification', () => {
    const xml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    const readbackLine =
      'Desktop\'s readback of "Applied Name" passed the layout and worksheet view check';
    const residual =
      'whether the dashboard renders as intended — the readback checked the stored layout and worksheet views, not the rendered sheets';

    async function run(
      loaded: Pick<LoadDashboardXmlOk, 'verifiedWorksheetNames' | 'documentWarnings'>,
    ): Promise<{ message: string; outcome: unknown; structured: Record<string, any> }> {
      const eventSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent');
      vi.spyOn(loadDashboardXmlModule, 'loadDashboardXml').mockResolvedValue(
        Ok({ appliedName: 'Applied Name', validationWarnings: [], ...loaded }),
      );
      const result = await getToolResult({ dashboardXml: xml });
      invariant(result.content[0].type === 'text');
      const { message } = resultSchema.parse(JSON.parse(result.content[0].text));
      const applied = eventSpy.mock.calls.find(([, e]) => e.type === 'apply_succeeded');
      return {
        message,
        outcome: (applied?.[1] as { promise_outcome?: unknown } | undefined)?.promise_outcome,
        structured: result.structuredContent as Record<string, any>,
      };
    }

    it.each([[['A']], [[]]])(
      'says verified with a receipt and promise_outcome verified when the readback ran (names %j)',
      async (names) => {
        const { message, outcome, structured } = await run({
          verifiedWorksheetNames: names,
          documentWarnings: [],
        });
        expect(message).toContain(
          `HOST VERIFICATION — verified: preflight clean · ${readbackLine}. It checked the stored layout and views, not rendering; do not report problems without host evidence.`,
        );
        expect(message).not.toContain('NOT re-verified');
        expect(message).not.toContain('unverified');
        expect(message).not.toContain('pixel');
        expect(outcome).toBe('verified');
        const { receipt, kind, label } = structured.nextAction;
        expect(kind).toBe('done');
        expect(label).toContain('read back, check passed');
        expect(receipt.did).toContain(
          'read back the dashboard: layout and worksheet view check passed',
        );
        expect(receipt.unverified).toEqual([residual]);
      },
    );

    it('keeps warnings and promise_outcome unverified when the readback ran but Desktop warned', async () => {
      const { message, outcome, structured } = await run({
        verifiedWorksheetNames: ['A'],
        documentWarnings: warnings,
      });
      expect(message).toContain(
        'Applied dashboard update for "Applied Name", but Desktop reported 1 warning(s)',
      );
      expect(message).toContain('dropped-node: Removed an unsupported zone.');
      expect(message).toContain('HOST VERIFICATION — unverified');
      expect(message).toContain(readbackLine);
      expect(message).toContain('Desktop warnings still need checking');
      expect(message).not.toContain('HOST VERIFICATION — verified');
      expect(outcome).toBe('unverified');
      expect(structured.nextAction.kind).toBe('prefill');
    });

    it('leaves the no-readback text, receipt and promise_outcome unchanged', async () => {
      const { message, outcome, structured } = await run({ documentWarnings: [] });
      expect(message).toContain(
        'HOST VERIFICATION — unverified: preflight clean · apply completed',
      );
      expect(message).toContain('full dashboard intent NOT re-verified');
      expect(outcome).toBe('unverified');
      expect(structured.nextAction.label).toContain('layout not re-read');
      expect(structured.nextAction.receipt).toEqual({
        did: [
          'Desktop accepted the dashboard XML apply for "Applied Name"',
          'preflight validation returned 0 warning(s)',
        ],
        didNot: [],
        unverified: [
          'whether the applied dashboard retained its intended layout — no structural readback ran (dashboard applies read back only when they register new worksheet views)',
        ],
      });
    });

    it.each([
      ['readback, clean', { verifiedWorksheetNames: ['A'], documentWarnings: [] }, true],
      ['empty readback, clean', { verifiedWorksheetNames: [], documentWarnings: [] }, true],
      ['readback, warned', { verifiedWorksheetNames: ['A'], documentWarnings: warnings }, false],
      ['no readback, clean', { documentWarnings: [] }, false],
      ['no readback, warned', { documentWarnings: warnings }, false],
    ] satisfies [
      string,
      Partial<LoadDashboardXmlOk> & Pick<LoadDashboardXmlOk, 'documentWarnings'>,
      boolean,
    ][])('footer, receipt and promise_outcome agree: %s', async (_name, loaded, verified) => {
      const { message, outcome, structured } = await run(loaded);
      const { receipt, kind } = structured.nextAction;
      expect(message.includes('HOST VERIFICATION — verified')).toBe(verified);
      expect(outcome).toBe(verified ? 'verified' : 'unverified');
      if (verified) {
        expect(receipt.unverified).toEqual([residual]);
      } else if (kind === 'done') {
        expect(receipt.unverified.length).toBeGreaterThan(0);
      }
    });
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
