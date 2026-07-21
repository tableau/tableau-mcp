import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWorkbookInventoryTool } from './getWorkbookInventory.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  title: z.string(),
  location: z.string().nullable().optional(),
  unsavedChanges: z.boolean(),
  worksheets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hidden: z.boolean(),
      datasources: z.array(z.string()).optional(),
    }),
  ),
  dashboards: z.array(z.object({ id: z.string(), name: z.string(), hidden: z.boolean() })),
  storyboards: z.array(z.object({ id: z.string(), name: z.string(), hidden: z.boolean() })),
});

describe('getWorkbookInventoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates an orienting read tool with no public args', () => {
    const tool = getWorkbookInventoryTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-workbook-inventory');
    expect(tool.description).toContain('title, unsaved changes');
    expect(tool.description).toContain('worksheet/dashboard/storyboard inventory');
    expect(tool.paramsSchema).toEqual({});
    expect(tool.annotations).toMatchObject({
      title: 'Get Workbook Inventory',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns workbook metadata and sheet inventory with worksheet datasources', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body).toMatchObject({
        title: 'Regional Sales Analysis',
        location: '/Users/tableau/Documents/regional-sales.twb',
        unsavedChanges: true,
      });
      expect(body.worksheets[0]).toMatchObject({
        id: 'sheet-sales',
        name: 'Sales by Region',
        datasources: ['Sample - Superstore'],
      });
      expect(body.dashboards[0]).toMatchObject({ id: 'dash-exec', name: 'Executive Dashboard' });
      expect(body.storyboards[0]).toMatchObject({ id: 'story-qbr', name: 'QBR Story' });
      expect(harness.server.requests.at(-1)?.path).toBe('/v0/workbook');
    } finally {
      await harness.close();
    }
  });

  it('reports an honest too-new endpoint 404 when the route is missing', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook', {
        status: 404,
        body: JSON.stringify({
          code: 'not-found',
          title: 'No route matches the request path.',
          detail: 'No route matches the request path.',
        }),
      });
    });
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not serve the workbook inventory endpoint');
      expect(result.content[0].text).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<{
  server: MockExternalApiServer;
  callTool: () => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getWorkbookInventoryTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async () => await callback({}, extra),
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
    instanceId: 'inst-workbook-inventory',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
