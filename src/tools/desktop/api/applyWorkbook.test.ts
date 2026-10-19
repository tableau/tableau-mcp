import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cachePathModule from '../../../desktop/cachePath.js';
import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import * as loadWorkbookXmlModule from '../../../desktop/wrappers/loadWorkbookXml.js';
import { READBACK_POLL_INTERVAL_MS } from '../../../desktop/wrappers/pollReadback.js';
import {
  DesktopCommandExecutionError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.desktop.js';
import { FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockContainedCacheReadFromFs } from './applyPreamble.testUtils.js';
import { getApplyWorkbookTool } from './applyWorkbook.js';

vi.mock('../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof cachePathModule>()),
  readContainedCacheTextFile: vi.fn(),
}));
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
    mockContainedCacheReadFromFs();
  });

  it('should create a tool instance with correct properties', () => {
    const applyWorkbookTool = getApplyWorkbookTool(new DesktopMcpServer());
    expect(applyWorkbookTool.name).toBe('apply-workbook');
    expect(applyWorkbookTool.description).toContain('Apply modified workbook content to Tableau');
    expect(applyWorkbookTool.description).toContain('freshness check');
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
      Ok({ validationWarnings: [], documentWarnings: [] }),
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

  it('returns aggregate diagnostics and document warnings without claiming a partial workbook check passed', async () => {
    const diagnostics = {
      worksheets: [
        { worksheetId: 'sheet-valid', status: 'complete' as const, invalidFields: [] },
        {
          worksheetId: 'sheet-partial',
          status: 'partial' as const,
          invalidFields: [],
          message: 'Some fields could not be checked.',
        },
      ],
    };
    const warnings = [{ code: 'document-warning', message: 'Dropped unsupported formatting.' }];
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: warnings, diagnostics }),
    );

    const result = await getToolResult({
      session: '12345',
      workbookXml: '<?xml version="1.0"?><workbook></workbook>',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({ diagnostics, warnings });
    expect(body.message.toLowerCase()).toContain('partial');
    expect(body.message.toLowerCase()).not.toContain('all worksheet diagnostics passed');
    expect(body.message).not.toContain('Successfully applied');
    expect(body.message).toContain('document-warning: Dropped unsupported formatting.');
    expect(result.structuredContent).toMatchObject({
      diagnostics,
      warnings,
      nextAction: { kind: 'prefill' },
    });
  });

  it('shows Desktop warnings and does not mark a warned apply done', async () => {
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: warnings }),
    );

    const result = await getToolResult({
      session: '12345',
      workbookXml: '<?xml version="1.0"?><workbook></workbook>',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toContain('Desktop reported 1 warning(s)');
    expect(body.message).toContain('dropped-node: Removed an unsupported zone.');
    expect(body.message).toContain("Desktop's warnings are host evidence");
    expect(body.warnings).toEqual(warnings);
    expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
  });

  it('names Desktop warnings in the next action when invalid fields are also reported', async () => {
    const diagnostics = {
      worksheets: [
        {
          worksheetId: 'sheet-invalid',
          status: 'complete' as const,
          invalidFields: [
            {
              fieldName: '[none:Missing Sales:qk]',
              shelf: 'rows',
              marksSpecificationId: 'marks-1',
              encodingType: 'text',
              reason: 'Field is unavailable.',
            },
          ],
        },
      ],
    };
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: warnings, diagnostics }),
    );

    const result = await getToolResult({
      session: '12345',
      workbookXml: '<?xml version="1.0"?><workbook></workbook>',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toContain('dropped-node: Removed an unsupported zone.');
    expect(result.structuredContent).toMatchObject({
      nextAction: {
        kind: 'prefill',
        label: 'Fix invalid fields; tell the user what Desktop warned about',
      },
    });
  });

  it.each(['complete', 'partial'] as const)(
    'keeps an accepted apply actionable when %s diagnostics report invalid fields',
    async (status) => {
      const diagnostics = {
        worksheets: [
          {
            worksheetId: 'sheet-invalid',
            status,
            invalidFields: [
              {
                fieldName: '[none:Missing Sales:qk]',
                shelf: 'rows',
                marksSpecificationId: 'marks-1',
                encodingType: 'text',
                reason: 'Field is unavailable.',
              },
            ],
            ...(status === 'partial' ? { message: 'Some fields could not be checked.' } : {}),
          },
        ],
      };
      const loadSpy = vi
        .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
        .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [], diagnostics }));

      const result = await getToolResult({
        session: '12345',
        workbookXml: '<?xml version="1.0"?><workbook></workbook>',
        mockExecutor: vi.fn().mockResolvedValue({}),
      });

      expect(result.isError).toBe(false);
      expect(loadSpy).toHaveBeenCalledTimes(1);
      invariant(result.content[0].type === 'text');
      const body = JSON.parse(result.content[0].text);
      expect(body).toMatchObject({ diagnostics });
      expect(body.message).toContain('Successfully applied workbook update');
      expect(body.message).toContain(
        'address the reported invalid fields without replaying the apply',
      );
      expect(body.message).toContain(
        'Static diagnostics do not establish query execution or rendering success',
      );
      expect(body.message).toContain('HOST VERIFICATION — unverified');
      if (status === 'partial') {
        expect(body.message).toContain(
          'Diagnostics are partial; not all worksheet diagnostics completed',
        );
      }
      expect(result.structuredContent).toMatchObject({
        ...body,
        nextAction: {
          kind: 'prefill',
          label: 'Address invalid fields reported in diagnostics',
        },
      });
    },
  );

  it('reports malformed diagnostics as unavailable without calling them document warnings', async () => {
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: [], diagnosticsInvalid: true }),
    );

    const result = await getToolResult({
      session: '12345',
      workbookXml: '<?xml version="1.0"?><workbook></workbook>',
      mockExecutor: vi.fn().mockResolvedValue({}),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({ diagnosticsInvalid: true });
    expect(body).not.toHaveProperty('warnings');
    expect(body.message).toContain('Diagnostics are unavailable');
    expect(result.structuredContent).toMatchObject({
      diagnosticsInvalid: true,
      nextAction: {
        kind: 'done',
        receipt: {
          unverified: expect.arrayContaining(['static field diagnostics were unavailable']),
        },
      },
    });
  });

  it('should successfully apply workbook XML in file mode', async () => {
    const mockXml = '<?xml version="1.0"?><workbook></workbook>';
    const mockFilePath = '/path/to/workbook.twb';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockXml);
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: true,
      sourceHash: 'a'.repeat(64),
    });
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: [] }),
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
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.nextAction.receipt.did).toContain(
      'preflight validation returned 0 warning(s)',
    );
    expect(structured.nextAction.receipt.did).not.toContain(
      'preflight validation returned 1 warning(s)',
    );

    expect(existsSync).toHaveBeenCalledWith(mockFilePath);
    expect(readFileSync).toHaveBeenCalledWith(mockFilePath, 'utf-8');
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSourceHash: 'a'.repeat(64),
        cachedLiveRelative: true,
      }),
    );
    sidecarSpy.mockRestore();
  });

  it('refuses a file-mode apply when the cache sidecar fingerprint mismatches the session', async () => {
    const mockFilePath = '/path/to/workbook.twb';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('<?xml version="1.0"?><workbook></workbook>');
    const sidecarSpy = vi.spyOn(cacheFingerprintModule, 'checkSidecarInput').mockReturnValue({
      ok: false,
      message: 'Cache produced by a different Desktop session — re-read in the current session.',
    });
    const loadSpy = vi
      .spyOn(loadWorkbookXmlModule, 'loadWorkbookXml')
      .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [] }));

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
      Ok({ validationWarnings: [], documentWarnings: [] }),
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
      Ok({ validationWarnings: [], documentWarnings: [] }),
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
      .mockResolvedValue(Ok({ validationWarnings: [], documentWarnings: [] }));

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

describe('applyWorkbookTool color map readback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContainedCacheReadFromFs();
  });
  afterEach(() => vi.useRealTimers());

  // `fs` is mocked in this file, so live-shaped fixtures come through the real module.
  async function colorFixture(name: string): Promise<string> {
    const fs = await vi.importActual<typeof import('fs')>('fs');
    return fs.readFileSync(
      `${process.cwd()}/src/desktop/validation/__fixtures__/color-map/${name}`,
      'utf8',
    );
  }

  async function workbookWithL1aDatasource(): Promise<string> {
    const datasource = (await colorFixture('apply-L1a-ds.xml')).replace(/^<!--.*-->\n/, '');
    return `<?xml version='1.0' encoding='utf-8' ?><workbook><datasources>${datasource}</datasources></workbook>`;
  }

  it('fails verification when the datasource readback lacks the map, and that next action wins over invalid fields', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const diagnostics = {
      worksheets: [
        {
          worksheetId: 'sheet-invalid',
          status: 'complete' as const,
          invalidFields: [
            {
              fieldName: '[none:Missing:nk]',
              shelf: 'rows',
              marksSpecificationId: 'marks-1',
              encodingType: 'text',
              reason: 'Field is unavailable.',
            },
          ],
        },
      ],
    };
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: [], diagnostics }),
    );
    const readback = await colorFixture('rb-L1a-ds.xml');
    const executor = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn()
        .mockResolvedValue(Ok({ datasources: [{ id: 'superstore', name: 'superstore' }] })),
      getDatasourceDocument: vi
        .fn()
        .mockResolvedValue(
          Ok({ xml: readback, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
    });

    const pending = getToolResult({
      session: '12345',
      workbookXml: await workbookWithL1aDatasource(),
      mockExecutor: vi.fn().mockResolvedValue(executor),
    });
    let settled = false;
    void pending.finally(() => (settled = true));
    while (!settled) await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS);
    const result = await pending;

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.message).toMatch(
      /^Desktop accepted the workbook update, but 3 requested member color\(s\) did not take: \[none:Category:nk\]: Furniture expected #59a14f, found missing;/,
    );
    expect(body.message).toContain('Do not tell the user these colors are set.');
    expect(body.message).toContain(
      'The datasource needs a <column-instance> for [none:Category:nk] next to its <style>.',
    );
    expect(body.message).toContain(
      'address the reported invalid fields without replaying the apply',
    );
    expect(body.verification).toMatchObject({ ok: false, status: 'failed' });
    expect(result.structuredContent).toMatchObject({
      nextAction: { kind: 'prefill', label: 'Verification failed — diagnose listed findings' },
    });
    expect(executor.getDatasourceDocument).toHaveBeenCalledWith('superstore', expect.anything());
  });

  async function workbookWithSheet(name: string): Promise<string> {
    const sheet = (await colorFixture(name)).replace(/^<!--.*-->\n/, '');
    return `<?xml version='1.0' encoding='utf-8' ?><workbook><worksheets>${sheet}</worksheets></workbook>`;
  }

  async function applyColorWorkbook(
    workbookXml: string,
    live: string | undefined,
    readback: string,
  ): Promise<Record<string, any>> {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: [] }),
    );
    const executor = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn()
        .mockResolvedValue(Ok({ datasources: [{ id: 'superstore', name: 'superstore' }] })),
      getDatasourceDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: await colorFixture(readback),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValue(
          live === undefined
            ? Err({ type: 'command-timed-out', error: 'timeout' })
            : Ok({ xml: live, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
    });
    const pending = getToolResult({
      session: '12345',
      workbookXml,
      mockExecutor: vi.fn().mockResolvedValue(executor),
    });
    let settled = false;
    void pending.finally(() => (settled = true));
    while (!settled) await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS);
    const result = await pending;
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    body.getWorkbookDocumentCalls = vi.mocked(executor.getWorkbookDocument).mock.calls.length;
    return body;
  }

  it("fails Andy's worksheet-style map with the placement hint", async () => {
    const andy = await workbookWithSheet('apply-ws-table-fq-ws.xml');
    const body = await applyColorWorkbook(
      andy,
      andy.replace(/<style>.*<\/style>/, '<style />'),
      'rb-ws-table-fq-ds.xml',
    );

    expect(body.getWorkbookDocumentCalls).toBe(1);
    expect(body.verification).toMatchObject({ ok: false, status: 'failed' });
    expect(body.message).toContain('[none:Calculation_B002:nk]: true expected #ff0000');
    expect(body.message).toContain(
      "Desktop keeps member colors written in a worksheet's own <style>",
    );
  });

  it('makes no claim, only a note, for a stale worksheet map already in the live workbook', async () => {
    const live = await workbookWithSheet('ok-L1-ws.xml');
    const body = await applyColorWorkbook(live, live, 'rb-ok-L1-before-ds.xml');

    expect(body.verification.status).toBe('skipped');
    expect(body.message).toContain(
      "Applied, but the member colors in the worksheet's own <style> are not shown on the chart and are not set. Details: the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Office Supplies #00aa00 (not in the datasource), Technology #d4c37a (not in the datasource), Furniture #ff0000 (not in the datasource). Do not tell the user they are set. To color the chart, put them in the datasource <style> with a datasource-level <column-instance> (apply-datasource). ",
    );
    expect(body.message).toMatch(/^Applied, but the member colors in the worksheet's own <style>/);
    expect(body.message).not.toContain('every requested member color matched');
    expect(body.message).not.toContain('not verified');
    expect(body.message).not.toContain('could not be read before the apply');
  });

  it('passes with the note when a stale map sits beside datasource colors that match', async () => {
    const live = await workbookWithSheet('ok-L1-ws.xml');
    const applied = live.replace(
      '</datasource-dependencies>',
      "<style><style-rule element='mark'><encoding attr='color' field='[none:Category:nk]' type='palette'><map to='#4e79a7'><bucket>&quot;Furniture&quot;</bucket></map></encoding></style-rule></style></datasource-dependencies>",
    );
    const body = await applyColorWorkbook(applied, live, 'rb-ok-L1-dirty-ds.xml');

    expect(body.verification.status).toBe('passed');
    expect(body.message).toContain('every requested member color matched.');
    expect(body.message).toContain(
      "Applied, but the member colors in the worksheet's own <style> are not shown on the chart and are not set.",
    );
  });

  it('fails a new sheet missing from the baseline, with the placement hint', async () => {
    const body = await applyColorWorkbook(
      await workbookWithSheet('apply-ws-table-fq-ws.xml'),
      '<workbook><worksheets /></workbook>',
      'rb-ws-table-fq-ds.xml',
    );

    expect(body.verification).toMatchObject({ ok: false, status: 'failed' });
    expect(body.message).toContain(
      "Desktop keeps member colors written in a worksheet's own <style>",
    );
  });

  it('treats a failed baseline read as no baseline: a note with the unread line, no failure', async () => {
    const body = await applyColorWorkbook(
      await workbookWithSheet('apply-ws-table-fq-ws.xml'),
      undefined,
      'rb-ws-table-fq-ds.xml',
    );

    expect(body.verification.status).toBe('skipped');
    expect(body.message).toContain(
      'The sheet could not be read before the apply, so some of these may be new.',
    );
  });

  it('makes no extra Desktop call when the workbook carries no color map', async () => {
    vi.spyOn(loadWorkbookXmlModule, 'loadWorkbookXml').mockResolvedValue(
      Ok({ validationWarnings: [], documentWarnings: [] }),
    );
    const executor = makeExecutorMock();

    const result = await getToolResult({
      session: '12345',
      workbookXml:
        "<workbook><datasources><datasource name='superstore' /></datasources></workbook>",
      mockExecutor: vi.fn().mockResolvedValue(executor),
    });

    expect(result.isError).toBe(false);
    expect(executor.listWorkbookDatasources).not.toHaveBeenCalled();
    expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
    expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
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
