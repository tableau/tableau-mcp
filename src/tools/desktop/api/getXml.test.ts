import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';

import * as cachePathModule from '../../../desktop/cachePath.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import * as cacheFingerprintModule from '../../../desktop/wrappers/cacheFingerprint.js';
import { GetWorksheetXmlFailedError } from '../../../errors/mcpToolError.desktop.js';
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import * as worksheetEditBufferModule from '../authoring/fields/worksheetEditBuffer.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getXmlTool } from './getXml.js';

vi.mock('../../../desktop/session/sessionResolution.js');
vi.mock('../authoring/fields/worksheetEditBuffer.js');
vi.mock('../../../desktop/wrappers/cacheFingerprint.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../desktop/wrappers/cacheFingerprint.js')>();
  return { ...actual, writeSidecar: vi.fn() };
});
vi.mock('fs');
vi.mock('../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../desktop/cachePath.js')>()),
  writeCacheTextFile: vi.fn(),
}));

const WORKSHEET_LIST = '/v0/workbook/worksheets';
const DASHBOARD_LIST = '/v0/workbook/dashboards';
const STORYBOARD_LIST = '/v0/workbook/storyboards';
const WORKSHEET_DOCUMENT = '/v0/workbook/worksheets/sheet-sales/document';
const DASHBOARD_DOCUMENT = '/v0/workbook/dashboards/dash-exec/document';
const STORYBOARD_DOCUMENT = '/v0/workbook/storyboards/story-qbr/document';

describe('getXmlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines a tool that writes a cache file', async () => {
    const tool = getXmlTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('get-xml');
    expect(tool.description).toContain('EXISTING sheet or datasource');
    expect(tool.description).toContain('resets its edit buffer');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(paramsSchema.kind.safeParse('datasource').success).toBe(true);
    expect(paramsSchema.kind.safeParse('workbook').success).toBe(false);
  });

  it.each([
    {
      kind: 'worksheet',
      sheetId: 'sheet-sales',
      key: 'worksheetXml',
      fragment: '<worksheet name="Sales by Region"',
      paths: [WORKSHEET_LIST, WORKSHEET_DOCUMENT],
    },
    {
      kind: 'dashboard',
      sheetId: 'dash-exec',
      key: 'dashboardXml',
      fragment: '<dashboard name="Executive Dashboard"',
      paths: [DASHBOARD_LIST, DASHBOARD_DOCUMENT],
    },
    {
      kind: 'storyboard',
      sheetId: 'story-qbr',
      key: 'storyboardXml',
      fragment: '<dashboard name="QBR Story" type="storyboard"',
      paths: [STORYBOARD_LIST, STORYBOARD_DOCUMENT],
    },
  ])('reads a $kind by id after resolving it', async ({ kind, sheetId, key, fragment, paths }) => {
    const harness = await startHarness(getXmlTool);
    try {
      const result = await harness.callTool({ kind, sheetId, mode: 'inline' });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body[key]).toContain(fragment);
      expect(body.message).toContain('inline');
      expect(requestPaths(harness.server)).toEqual(paths);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      kind: 'worksheet',
      sheetId: 'Sales by Region',
      paths: [WORKSHEET_LIST, WORKSHEET_DOCUMENT],
    },
    {
      kind: 'dashboard',
      sheetId: 'Executive Dashboard',
      paths: [DASHBOARD_LIST, DASHBOARD_DOCUMENT],
    },
    {
      kind: 'storyboard',
      sheetId: 'QBR Story',
      paths: [STORYBOARD_LIST, STORYBOARD_DOCUMENT],
    },
  ])(
    'resolves a unique $kind name to its id before reading the document',
    async ({ kind, sheetId, paths }) => {
      const harness = await startHarness(getXmlTool);
      try {
        const result = await harness.callTool({ kind, sheetId, mode: 'file' });

        expect(result.isError).toBe(false);
        expect(parseResult(result).message).toContain(sheetId);
        expect(requestPaths(harness.server)).toEqual(paths);
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    {
      kind: 'worksheet',
      sheetId: 'sheet-sales',
      key: 'worksheetXml',
      list: WORKSHEET_LIST,
      path: WORKSHEET_DOCUMENT,
    },
    {
      kind: 'dashboard',
      sheetId: 'dash-exec',
      key: 'dashboardXml',
      list: DASHBOARD_LIST,
      path: DASHBOARD_DOCUMENT,
    },
  ])(
    'falls back to the whole workbook document when the $kind document route is missing',
    async ({ kind, sheetId, key, list, path }) => {
      const harness = await startHarness(
        getXmlTool,
        (server) => setRouteMissing(server, `GET ${path}`),
        {
          workbookXml:
            '<?xml version="1.0"?><workbook><worksheets><worksheet name="Sales by Region"><table /><simple-id uuid="sheet-sales" /></worksheet></worksheets>' +
            '<dashboards><dashboard name="Executive Dashboard"><zones /><simple-id uuid="dash-exec" /></dashboard></dashboards></workbook>',
        },
      );
      try {
        const result = await harness.callTool({ kind, sheetId, mode: 'inline' });

        expect(result.isError).toBe(false);
        expect(parseResult(result)[key]).toBeDefined();
        expect(requestPaths(harness.server)).toEqual([list, path, '/v0/workbook/document']);
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    { kind: 'worksheet', sheetId: 'sheet-sales', list: WORKSHEET_LIST, path: WORKSHEET_DOCUMENT },
    { kind: 'dashboard', sheetId: 'dash-exec', list: DASHBOARD_LIST, path: DASHBOARD_DOCUMENT },
  ])(
    'returns the executor error when the $kind document read fails',
    async ({ kind, sheetId, list, path }) => {
      const harness = await startHarness(getXmlTool, (server) =>
        server.setOverride(`GET ${path}`, {
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'problem',
            title: 'Internal error',
            status: 500,
            instance: '/v0/mock',
            detail: 'boom',
            code: 'internal-error',
          }),
        }),
      );
      try {
        const result = await harness.callTool({ kind, sheetId, mode: 'inline' });

        expect(result.isError).toBe(true);
        expect(requestPaths(harness.server)).toEqual([list, path]);
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    {
      kind: 'worksheet',
      list: WORKSHEET_LIST,
      body: {
        worksheets: [
          {
            id: 'sheet-a',
            name: 'Sales',
            type: 'WORKSHEET',
            hidden: false,
            isActiveSheet: false,
            index: 0,
          },
          {
            id: 'sheet-b',
            name: 'Sales',
            type: 'WORKSHEET',
            hidden: false,
            isActiveSheet: false,
            index: 1,
          },
        ],
      },
      error: 'multiple-worksheets-found',
    },
    {
      kind: 'dashboard',
      list: DASHBOARD_LIST,
      body: {
        dashboards: [
          {
            id: 'dash-a',
            name: 'Sales',
            type: 'DASHBOARD',
            hidden: false,
            isActiveSheet: false,
            index: 0,
          },
          {
            id: 'dash-b',
            name: 'Sales',
            type: 'DASHBOARD',
            hidden: false,
            isActiveSheet: false,
            index: 1,
          },
        ],
      },
      error: 'multiple-dashboards-found',
    },
  ])(
    'reports $error when the $kind name matches more than one sheet',
    async ({ kind, list, body, error }) => {
      const harness = await startHarness(getXmlTool, (server) =>
        server.setOverride(`GET ${list}`, {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        }),
      );
      try {
        const result = await harness.callTool({ kind, sheetId: 'Sales', mode: 'inline' });

        expect(result.isError).toBe(true);
        expect(errorText(result)).toContain(error);
        expect(requestPaths(harness.server)).toEqual([list]);
      } finally {
        await harness.close();
      }
    },
  );

  it.each([
    {
      kind: 'worksheet',
      sheetId: 'Sales by Region',
      calls: ['listWorksheets', 'getWorksheetDocument'],
    },
    {
      kind: 'dashboard',
      sheetId: 'Executive Dashboard',
      calls: ['listDashboards', 'getDashboardDocument'],
    },
    {
      kind: 'storyboard',
      sheetId: 'QBR Story',
      calls: ['listStoryboards', 'getStoryboardDocument'],
    },
  ] as const)(
    'passes the request abort signal to the $kind list and document reads',
    async ({ kind, sheetId, calls }) => {
      const spies = calls.map((method) => vi.spyOn(ExternalApiToolExecutor.prototype, method));
      const harness = await startHarness(getXmlTool);
      try {
        const result = await harness.callTool({ kind, sheetId, mode: 'inline' });

        expect(result.isError).toBe(false);
        for (const spy of spies) {
          expect(spy.mock.calls[0]).toContain(harness.signal);
        }
      } finally {
        spies.forEach((spy) => spy.mockRestore());
        await harness.close();
      }
    },
  );

  it('reports a sheet that matches neither an id nor a name', async () => {
    const harness = await startHarness(getXmlTool);
    try {
      const result = await harness.callTool({ kind: 'dashboard', sheetId: 'Missing' });

      expect(result.isError).toBe(true);
      expect(worksheetEditBufferModule.clearStickyWorksheetFile).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('closes the sticky edit buffer keyed on the fetched fragment simple-id', async () => {
    const harness = await startHarness(getXmlTool);
    try {
      await harness.callTool({ kind: 'worksheet', sheetId: 'sheet-sales', mode: 'inline' });

      expect(worksheetEditBufferModule.clearStickyWorksheetFile).toHaveBeenCalledWith({
        session: '999',
        worksheetId: 'sheet-sales',
      });
    } finally {
      await harness.close();
    }
  });

  it('does not touch the sticky edit buffer when the fetch fails', async () => {
    const harness = await startHarness(getXmlTool);
    try {
      const result = await harness.callTool({ kind: 'worksheet', sheetId: 'Missing' });

      expect(result.isError).toBe(true);
      expect(worksheetEditBufferModule.clearStickyWorksheetFile).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('returns a malformed-document error when the worksheet fragment has no simple-id', async () => {
    const harness = await startHarness(getXmlTool, (server) =>
      setXml(server, WORKSHEET_DOCUMENT, '<worksheet name="Sales by Region"><table /></worksheet>'),
    );
    try {
      const result = await harness.callTool({ kind: 'worksheet', sheetId: 'sheet-sales' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toBe(
        new GetWorksheetXmlFailedError({
          type: 'malformed-worksheet-fragment',
          message:
            'Worksheet "Sales by Region" has no <simple-id>; the workbook document is malformed.',
        }).message,
      );
      expect(worksheetEditBufferModule.clearStickyWorksheetFile).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('errors when the storyboard document has no <dashboard> subtree', async () => {
    const harness = await startHarness(getXmlTool, (server) =>
      setXml(server, STORYBOARD_DOCUMENT, '<empty />'),
    );
    try {
      const result = await harness.callTool({ kind: 'storyboard', sheetId: 'story-qbr' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('No storyboard document subtree found');
    } finally {
      await harness.close();
    }
  });

  it('reports a too-new endpoint error when the storyboard document route is missing', async () => {
    const harness = await startHarness(getXmlTool, (server) =>
      setRouteMissing(server, `GET ${STORYBOARD_DOCUMENT}`),
    );
    try {
      const result = await harness.callTool({ kind: 'storyboard', sheetId: 'story-qbr' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('storyboard document');
      expect(errorText(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it('writes the file and points at the matching apply tool in file mode', async () => {
    const harness = await startHarness(getXmlTool);
    try {
      const result = await harness.callTool({ kind: 'storyboard', sheetId: 'story-qbr' });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.file).toContain('storyboard');
      expect(body.message).toContain('cache file');
      expect(body.instructions).toBe(
        'Use this file path with apply-storyboard instead of passing content directly.',
      );
    } finally {
      await harness.close();
    }
  });

  it('reads the workbook with credentials redacted and calc formulas left alone', async () => {
    const harness = await startHarness(getXmlTool, undefined, {
      workbookXml:
        "<workbook><connection password='hunter2'/><calculation formula='[Token]=1'/></workbook>",
    });
    try {
      const result = await harness.callTool({ mode: 'inline' });

      expect(result.isError).toBe(false);
      const workbookXml = parseResult(result).workbookXml;
      expect(workbookXml).not.toContain('hunter2');
      expect(workbookXml).toContain("password='__TABLEAU_MCP_REDACTED_CREDENTIAL__'");
      expect(workbookXml).toContain("formula='[Token]=1'");
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook/document']);
    } finally {
      await harness.close();
    }
  });

  it('writes the redacted workbook to the cache file and stamps its sidecar', async () => {
    const harness = await startHarness(getXmlTool, undefined, {
      workbookXml: '<?xml version="1.0"?><workbook><worksheets></worksheets></workbook>',
    });
    try {
      const result = await harness.callTool({ mode: 'file' });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.instructions).toBe(
        'Use this file path with apply-workbook instead of passing content directly.',
      );
      expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(
        body.file,
        '999',
        '861123112f48bbfe5df7d79dd5cbd059f88961d9abe07a0aa28f5e998e15c650',
      );
    } finally {
      await harness.close();
    }
  });

  it('keeps secrets out of the cache file', async () => {
    const harness = await startHarness(getXmlTool, undefined, {
      workbookXml: "<workbook><connection password='hunter2'/></workbook>",
    });
    try {
      await harness.callTool({ mode: 'file' });

      const written = vi.mocked(cachePathModule.writeCacheTextFile).mock.calls[0][1];
      expect(written).not.toContain('hunter2');
      expect(written).toContain("password='__TABLEAU_MCP_REDACTED_CREDENTIAL__'");
    } finally {
      await harness.close();
    }
  });

  it('forces file mode and logs a cap-hit receipt when inline XML exceeds the cap', async () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const harness = await startHarness(getXmlTool, (server) =>
      setXml(
        server,
        DASHBOARD_DOCUMENT,
        '<dashboard name="Executive Dashboard"><zones>' +
          'x'.repeat(20000) +
          '</zones></dashboard>',
      ),
    );
    try {
      const result = await harness.callTool({
        kind: 'dashboard',
        sheetId: 'dash-exec',
        mode: 'inline',
      });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.dashboardXml).toBeUndefined();
      expect(body.message).toContain('inline cap');
      expect(body.message).toContain('Executive Dashboard');
      expect(body.instructions).toContain('cache read tool');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          data: expect.objectContaining({ capHit: true, tool: 'get-xml' }),
        }),
      );
    } finally {
      await harness.close();
    }
  });

  it('respects a smaller cap overridden via config', async () => {
    const harness = await startHarness(getXmlTool, undefined, undefined, 8);
    try {
      const result = await harness.callTool({
        kind: 'worksheet',
        sheetId: 'sheet-sales',
        mode: 'inline',
      });

      const body = parseResult(result);
      expect(body.worksheetXml).toBeUndefined();
      expect(body.file).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      args: { sheetId: 'sheet-sales' },
      message: 'sheetId requires kind.',
    },
    { args: { kind: 'worksheet' }, message: 'sheetId is required with kind worksheet.' },
  ])('rejects $args without a request', async ({ args, message }) => {
    const harness = await startHarness(getXmlTool);
    try {
      const result = await harness.callTool(args);

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(message);
      expect(harness.server.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  factory: (server: DesktopMcpServer) => DesktopTool<any>,
  configure?: (server: MockExternalApiServer) => void,
  options?: { workbookXml?: string },
  capBytes?: number,
): Promise<{
  server: MockExternalApiServer;
  signal: AbortSignal;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer(options);
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = factory(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const base = getMockRequestHandlerExtra();
  const extra = {
    ...base,
    getExecutor: vi.fn().mockResolvedValue(executor),
    ...(capBytes !== undefined && { config: { ...base.config, inlineXmlMaxBytes: capBytes } }),
  };

  return {
    server,
    signal: extra.signal,
    callTool: async (args) => await callback({ mode: 'file', ...args }, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function setXml(server: MockExternalApiServer, path: string, xml: string): void {
  server.setOverride(`GET ${path}`, { status: 200, contentType: 'application/xml', body: xml });
}

function setRouteMissing(server: MockExternalApiServer, key: string): void {
  server.setOverride(key, {
    status: 404,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'problem',
      title: `No route matches ${key}`,
      status: 404,
      instance: '/v0/mock',
      detail: `No route matches ${key}`,
      code: 'not-found',
    }),
  });
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-get-xml',
    apiVersion: '0.2.25',
  };
}

function requestPaths(server: MockExternalApiServer): Array<string> {
  return server.requests.map((request) => request.path);
}

function parseResult(result: CallToolResult): Record<string, string | undefined> {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

function errorText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
