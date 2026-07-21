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
import { getAppInfoTool } from './getAppInfo.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  applicationVersion: z.string().optional(),
  build: z.string().optional(),
  edition: z.string().optional(),
  os: z.string().optional(),
});

describe('getAppInfoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a terse full-surface Desktop build read tool', () => {
    const tool = getAppInfoTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-app-info');
    expect(tool.description).toBe('Identify the Desktop build when an endpoint 404s as too-new.');
    expect(tool.paramsSchema).toEqual({});
    expect(tool.annotations).toMatchObject({
      title: 'Get App Info',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns application version, build, edition, and OS', async () => {
    const server = await startMockExternalApiServer();
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    try {
      const tool = getAppInfoTool(new DesktopMcpServer());
      const callback = await Provider.from(tool.callback);
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      };

      const result = await callback({}, extra);

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual({
        applicationVersion: '2026.1',
        build: '20261.26.0701.1234',
        edition: 'Professional',
        os: 'macOS',
      });
      expect(server.requests.at(-1)?.path).toBe('/v0/app');
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
    instanceId: 'inst-app-info',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
