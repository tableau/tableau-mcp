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
import { getListSiteDatasourcesTool } from './listSiteDatasources.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  datasources: z.array(
    z.object({
      id: z.string().optional(),
      luid: z.string().optional(),
      name: z.string().optional(),
      contentUrl: z.string().optional(),
    }),
  ),
});

describe('listSiteDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a read-only tool with an optional session arg', () => {
    const tool = getListSiteDatasourcesTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-site-datasources');
    expect(tool.description).toContain('List datasources PUBLISHED to the connected site');
    expect(tool.description).toContain('contentUrl when build provides it');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
      title: 'List Site Datasources',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('includes contentUrl when the build provides it', async () => {
    const server = await startMockExternalApiServer();
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    try {
      const tool = getListSiteDatasourcesTool(new DesktopMcpServer());
      const callback = await Provider.from(tool.callback);
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      };

      const result = await callback({ session: undefined }, extra);

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.datasources).toEqual([
        {
          id: 'ds-superstore',
          luid: 'luid-superstore',
          name: 'Sample - Superstore',
          contentUrl: 'sample-superstore',
        },
        {
          id: 'ds-quota',
          luid: 'luid-quota',
          name: 'Quota Targets',
          contentUrl: 'quota-targets',
        },
      ]);

      const last = server.requests.at(-1);
      expect(last?.method).toBe('GET');
      expect(last?.path).toBe('/v0/site/datasources');
    } finally {
      executor.stop();
      await server.close();
    }
  });

  it('omits contentUrl when the build does not provide it', async () => {
    const server = await startMockExternalApiServer();
    server.setOverride('GET /v0/site/datasources', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        datasources: [
          { id: 'ds-superstore', luid: 'luid-superstore', name: 'Sample - Superstore' },
        ],
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    try {
      const tool = getListSiteDatasourcesTool(new DesktopMcpServer());
      const callback = await Provider.from(tool.callback);
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      };

      const result = await callback({ session: undefined }, extra);

      expect(result.isError).toBe(false);
      expect(parseResult(result).datasources).toEqual([
        { id: 'ds-superstore', luid: 'luid-superstore', name: 'Sample - Superstore' },
      ]);
    } finally {
      executor.stop();
      await server.close();
    }
  });
});

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-site-datasources',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
