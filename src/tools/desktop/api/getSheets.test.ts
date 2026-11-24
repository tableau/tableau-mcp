import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSheetsTool } from './getSheets.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('getSheetsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines a read-only tool', async () => {
    const tool = getSheetsTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('get-sheets');
    expect(tool.title).toBe('Get Sheets');
    expect(tool.description).toContain('title, unsaved changes');
    expect(tool.description).toContain(
      'an empty list does not mean the workbook has no connected datasource',
    );
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(paramsSchema.kind.safeParse('table').success).toBe(false);
    expect(paramsSchema.kind.safeParse('storyboard').success).toBe(true);
    expect(paramsSchema.sheetId.safeParse('').success).toBe(false);
  });

  it('returns the workbook inventory without kind', async () => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(false);
      const body = parseResult(result) as {
        worksheets: Array<unknown>;
        dashboards: Array<unknown>;
        storyboards: Array<unknown>;
      };
      expect(body).toMatchObject({
        title: 'Regional Sales Analysis',
        location: '/Users/tableau/Documents/regional-sales.twb',
        unsavedChanges: true,
      });
      expect(body.worksheets[0]).toMatchObject({
        id: 'sheet-sales',
        datasources: ['Sample - Superstore'],
      });
      expect(body.dashboards[0]).toMatchObject({ id: 'dash-exec' });
      expect(body.storyboards[0]).toMatchObject({ id: 'story-qbr' });
      expect(requestPaths(harness.server)).toEqual(['/v0/workbook']);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      kind: 'worksheet',
      expected: { count: 2, worksheets: [{ id: 'sheet-sales' }, { id: 'sheet-profit' }] },
      path: '/v0/workbook/worksheets',
    },
    {
      kind: 'dashboard',
      expected: {
        count: 1,
        dashboards: [{ id: 'dash-exec', containedSheets: ['sheet-sales', 'sheet-profit'] }],
      },
      path: '/v0/workbook/dashboards',
    },
    {
      kind: 'storyboard',
      expected: { count: 1, storyboards: [{ id: 'story-qbr', storyPointCount: 4 }] },
      path: '/v0/workbook/storyboards',
    },
  ])('lists the $kind sheets', async ({ kind, expected, path }) => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({ kind });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject(expected);
      expect(requestPaths(harness.server)).toEqual([path]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      kind: 'worksheet',
      sheetId: 'sheet-sales',
      expected: { kind: 'worksheet', id: 'sheet-sales', datasources: ['Sample - Superstore'] },
      paths: ['/v0/workbook/worksheets', '/v0/workbook/worksheets/sheet-sales'],
    },
    {
      kind: 'dashboard',
      sheetId: 'dash-exec',
      expected: {
        kind: 'dashboard',
        id: 'dash-exec',
        containedSheets: ['sheet-sales', 'sheet-profit'],
      },
      paths: ['/v0/workbook/dashboards', '/v0/workbook/dashboards/dash-exec'],
    },
    {
      kind: 'storyboard',
      sheetId: 'story-qbr',
      expected: { kind: 'storyboard', id: 'story-qbr', storyPointCount: 4 },
      paths: ['/v0/workbook/storyboards', '/v0/workbook/storyboards/story-qbr'],
    },
  ])('reads one $kind by id after resolving it', async ({ kind, sheetId, expected, paths }) => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({ kind, sheetId });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject(expected);
      expect(requestPaths(harness.server)).toEqual(paths);
    } finally {
      await harness.close();
    }
  });

  it('resolves a unique name to its id before reading the sheet', async () => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({ kind: 'worksheet', sheetId: 'Sales by Region' });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject({ kind: 'worksheet', id: 'sheet-sales' });
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('reports a sheet that matches neither an id nor a name of that kind', async () => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({ kind: 'dashboard', sheetId: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('was not found');
    } finally {
      await harness.close();
    }
  });

  it('returns the executor error when the item read fails', async () => {
    const harness = await startHarness(getSheetsTool, (server) =>
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales', {
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
      const result = await harness.callTool({ kind: 'worksheet', sheetId: 'sheet-sales' });

      expect(result.isError).toBe(true);
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('rejects sheetId without kind', async () => {
    const harness = await startHarness(getSheetsTool);
    try {
      const result = await harness.callTool({ sheetId: 'sheet-sales' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('kind is required with sheetId.');
      expect(harness.server.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  factory: (server: DesktopMcpServer) => DesktopTool<any>,
  configure?: (server: MockExternalApiServer) => void,
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = factory(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-get-sheets',
    apiVersion: '0.2.34',
  };
}

function requestPaths(server: MockExternalApiServer): Array<string> {
  return server.requests.map((request) => request.path);
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

function errorText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
