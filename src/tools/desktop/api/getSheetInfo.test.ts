import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetSheetInfoTool } from './getSheetInfo.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('getSheetInfoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('defines a read-only tool', async () => {
    const tool = getGetSheetInfoTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('get-sheet-info');
    expect(tool.title).toBe('Get Sheet Info');
    expect(paramsSchema).toMatchObject({
      session: expect.any(Object),
      sheet: expect.any(Object),
      kind: expect.any(Object),
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it.each([
    {
      label: 'worksheet by name',
      args: { sheet: 'Sales by Region' },
      expected: { kind: 'worksheet', id: 'sheet-sales', datasources: ['Sample - Superstore'] },
      lastPath: '/v0/workbook/worksheets/sheet-sales',
    },
    {
      label: 'dashboard by id',
      args: { sheet: 'dash-exec' },
      expected: {
        kind: 'dashboard',
        id: 'dash-exec',
        containedSheets: ['sheet-sales', 'sheet-profit'],
      },
      lastPath: '/v0/workbook/dashboards/dash-exec',
    },
    {
      label: 'storyboard by name with kind',
      args: { sheet: 'QBR Story', kind: 'storyboard' },
      expected: { kind: 'storyboard', id: 'story-qbr', storyPointCount: 4 },
      lastPath: '/v0/workbook/storyboards/story-qbr',
    },
  ])('returns the $label', async ({ args, expected, lastPath }) => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool(args);

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toMatchObject(expected);
      expect(requestPaths(harness.server).at(-1)).toBe(lastPath);
    } finally {
      await harness.close();
    }
  });

  it('reports an unknown sheet without reading an item', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: 'Missing' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('was not found');
      expect(requestPaths(harness.server)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/dashboards',
        '/v0/workbook/storyboards',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('does not find a worksheet when the kind is dashboard', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: 'Sales by Region', kind: 'dashboard' });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('returns the executor error when the item read fails', async () => {
    const harness = await startHarness();
    try {
      harness.server.setOverride('GET /v0/workbook/worksheets/sheet-sales', {
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
      });

      const result = await harness.callTool({ sheet: 'sheet-sales' });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('rejects an unknown kind', async () => {
    const tool = getGetSheetInfoTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(paramsSchema.kind.safeParse('table').success).toBe(false);
    expect(paramsSchema.kind.safeParse('dashboard').success).toBe(true);
    expect(paramsSchema.sheet.safeParse(undefined).success).toBe(false);
  });
});

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getGetSheetInfoTool(new DesktopMcpServer());
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
    instanceId: 'inst-sheet-info',
    apiVersion: '0.2.25',
  };
}

function requestPaths(server: MockExternalApiServer): Array<string> {
  return server.requests.map((request) => request.path);
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
