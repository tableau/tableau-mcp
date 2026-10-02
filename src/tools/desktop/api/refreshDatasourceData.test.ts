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
import { getRefreshDatasourceDataTool } from './refreshDatasourceData.js';

vi.mock('../../../desktop/session/sessionResolution.js');

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

function refreshPosts(
  server: MockExternalApiServer,
  datasourceId: string,
): Array<{ body: string }> {
  const path = `/v0/datasources/${encodeURIComponent(datasourceId)}:refreshData`;
  return server.requests.filter((r) => r.method === 'POST' && r.path === path);
}

describe('refresh-datasource-data tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('POSTs the datasource refreshData route by id and reports the refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'ds-1' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Refreshed the live data for datasource "ds-1".');
      expect(refreshPosts(harness.server, 'ds-1')).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('percent-encodes a datasource id with special characters in the route', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'a b/c' });
      expect(result.isError).toBeFalsy();
      expect(refreshPosts(harness.server, 'a b/c')).toHaveLength(1);
    } finally {
      await harness.close();
    }
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
  const tool = getRefreshDatasourceDataTool(new DesktopMcpServer());
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
    instanceId: 'inst-refresh-data',
    apiVersion: '1.0',
  };
}
