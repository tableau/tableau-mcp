import { DesktopMcpServer } from '../../server.desktop.js';
import { getGetWorkbookXmlTool } from '../../tools/desktop/api/getWorkbookXml.js';
import { getMockRequestHandlerExtra } from '../../tools/desktop/toolContext.mock.js';
import { Provider } from '../../utils/provider.js';
import { ExternalApiToolExecutor } from './externalApiToolExecutor.js';
import { MockExternalApiServer, startMockExternalApiServer } from './mockExternalApiServer.js';

vi.mock('../../logging/logger.js');

describe('ExternalApiToolExecutor session-fatal errors', () => {
  let server: MockExternalApiServer;
  let executor: ExternalApiToolExecutor;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    server = await startMockExternalApiServer();
    executor = new ExternalApiToolExecutor({
      discover: () => [
        {
          baseUrl: server.baseUrl,
          token: 'valid-token',
          pid: 999,
          instanceId: 'session-fatal-test',
          apiVersion: '0.2.22',
        },
      ],
    });
    await executor.start();
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(['E71AE512', '0xE71AE512', '0xe71ae512'])(
    'classifies a command failure with Tableau code %s as session-fatal',
    async (tableauErrorCode) => {
      server.setOverride('POST /v0/app:invokeCommand', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'failed-command',
          kind: 'command.invoke',
          state: 'FAILED',
          error: { code: 'operation-failed', message: 'Internal Error', tableauErrorCode },
        }),
      });

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.unwrapErr()).toMatchObject({
        type: 'command-failed',
        error: {
          code: 'operation-failed',
          'tableau-error-code': tableauErrorCode,
          recoverable: false,
          sessionFatal: true,
          message: expect.stringContaining('Stop all commands'),
        },
      });
      expect(
        server.requests.filter((request) => request.path === '/v0/app:invokeCommand'),
      ).toHaveLength(1);
    },
  );

  it('preserves failed document-apply evidence alongside the restart instruction', async () => {
    server.setOverride('POST /v0/workbook/worksheets/sheet-sales/document', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'failed-apply',
        kind: 'sheet.applyDocument',
        state: 'FAILED',
        error: {
          code: 'operation-failed',
          message: 'Internal Error',
          'tableau-error-code': 'E71AE512',
        },
        result: { changed: false },
        warnings: [{ code: 'apply-warning', message: 'Desktop warning' }],
      }),
    });

    const result = await executor.applyWorksheetDocument('sheet-sales', '<worksheet />', signal);

    expect(result.unwrapErr()).toMatchObject({
      type: 'command-failed',
      error: {
        sessionFatal: true,
        message: expect.stringContaining('restart Tableau Desktop'),
      },
      result: { changed: false },
      warnings: [{ code: 'apply-warning', message: 'Desktop warning' }],
    });
  });

  it.each(['json', 'xml', 'summary'])(
    'classifies a synchronous %s read without retrying it',
    async (kind) => {
      const path =
        kind === 'json'
          ? '/v0/workbook'
          : kind === 'xml'
            ? '/v0/workbook/document'
            : '/v0/workbook/worksheets/sheet-sales/summaryData';
      server.setOverride(`GET ${path}`, {
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'operation-failed',
          detail: 'Internal Error',
          tableauErrorCode: 'E71AE512',
        }),
      });

      const result =
        kind === 'json'
          ? await executor.getWorkbook(signal)
          : kind === 'xml'
            ? await executor.getWorkbookDocument(signal)
            : await executor.getWorksheetSummaryData('sheet-sales', {}, signal);

      expect(result.unwrapErr()).toMatchObject({
        type: 'command-failed',
        error: {
          sessionFatal: true,
          recoverable: false,
          message: expect.stringContaining('including reads'),
        },
      });
      expect(server.requests.filter((request) => request.path === path)).toHaveLength(1);
    },
  );

  it.each([
    ['json', 'tableauErrorCode'],
    ['xml', 'tableau-error-code'],
  ])('preserves the Tableau code from a failed polled %s read', async (kind, errorKey) => {
    const path = kind === 'json' ? '/v0/workbook' : '/v0/workbook/document';
    server.setOverride(`GET ${path}`, {
      status: 202,
      contentType: 'application/json',
      headers: { location: '/v0/operations/failed-read', 'retry-after': '0' },
      body: JSON.stringify({ id: 'failed-read', kind: 'workbook.read', state: 'RUNNING' }),
    });
    server.setOperation('failed-read', {
      retryAfterSeconds: 0,
      poll: [
        {
          id: 'failed-read',
          kind: 'workbook.read',
          state: 'FAILED',
          error: { code: 'operation-failed', message: 'Internal Error', [errorKey]: 'E71AE512' },
        },
      ],
    });

    const result =
      kind === 'json'
        ? await executor.getWorkbook(signal)
        : await executor.getWorkbookDocument(signal);

    expect(result.unwrapErr()).toMatchObject({
      type: 'command-failed',
      error: {
        sessionFatal: true,
        'tableau-error-code': 'E71AE512',
        message: expect.stringContaining('restart Tableau Desktop'),
      },
    });
    expect(server.requests.filter((request) => request.path === path)).toHaveLength(1);
  });

  it('delivers restart guidance through the MCP error funnel for workbook reads', async () => {
    server.setOverride('GET /v0/workbook/document', {
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        code: 'operation-failed',
        detail: 'Internal Error',
        tableauErrorCode: 'E71AE512',
      }),
    });
    const callback = await Provider.from(getGetWorkbookXmlTool(new DesktopMcpServer()).callback);

    const result = await callback(
      { session: '999', mode: 'inline' },
      {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      },
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('restart Tableau Desktop');
    expect(JSON.stringify(result.content)).toContain('list-instances');
    expect(JSON.stringify(result.content)).not.toContain('retry once');
  });

  it('does not treat a different internal error as session-fatal', async () => {
    server.setOverride('GET /v0/workbook/document', {
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        code: 'operation-failed',
        detail: 'Internal Error',
        tableauErrorCode: '7A1775A4',
      }),
    });

    const result = await executor.getWorkbookDocument(signal);

    expect(result.unwrapErr()).toEqual({
      type: 'command-failed',
      error: {
        code: 'operation-failed',
        message: 'Internal Error',
        recoverable: false,
        'tableau-error-code': '7A1775A4',
      },
    });
  });
});
