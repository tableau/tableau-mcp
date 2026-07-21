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
import { getListSiteWorkbooksTool } from './listSiteWorkbooks.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  workbooks: z.array(
    z.object({
      id: z.string().optional(),
      luid: z.string().optional(),
      name: z.string().optional(),
      project: z.string().optional(),
    }),
  ),
});

describe('listSiteWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a terse full-surface site workbook read tool', () => {
    const tool = getListSiteWorkbooksTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-site-workbooks');
    expect(tool.description).toBe('List workbooks published to the connected site.');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
      title: 'List Site Workbooks',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns published workbook identifiers from the connected site', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool();

      expect(result.isError).toBe(false);
      expect(parseResult(result).workbooks).toEqual([
        {
          id: 'wb-regional-sales',
          luid: 'luid-regional-sales',
          name: 'Regional Sales Analysis',
          project: 'Sales',
        },
        {
          id: 'wb-ops-scorecard',
          luid: 'luid-ops-scorecard',
          name: 'Ops Scorecard',
          project: 'Operations',
        },
      ]);
      expect(harness.server.requests.at(-1)?.path).toBe('/v0/site/workbooks');
    } finally {
      await harness.close();
    }
  });

  it('reports an honest too-new endpoint 404 when the route is missing', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/site/workbooks', {
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
      expect(result.content[0].text).toContain('does not serve the site workbooks endpoint');
      expect(result.content[0].text).toContain('get-app-info');
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
  const tool = getListSiteWorkbooksTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async () => await callback({ session: undefined }, extra),
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
    instanceId: 'inst-site-workbooks',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
