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
import { getRefreshDatasourceExtractTool } from './refreshDatasourceExtract.js';

vi.mock('../../../desktop/session/sessionResolution.js');

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

function refreshPosts(
  server: MockExternalApiServer,
  datasourceId: string,
): Array<{ body: string }> {
  const path = `/v0/datasources/${encodeURIComponent(datasourceId)}:refreshExtract`;
  return server.requests.filter((r) => r.method === 'POST' && r.path === path);
}

describe('refresh-datasource-extract tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('omits isFullRefresh from the body when the caller does not pass it', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'ds-1' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Refreshed the extract for datasource "ds-1".');

      const posted = refreshPosts(harness.server, 'ds-1');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({});
    } finally {
      await harness.close();
    }
  });

  it('forwards isFullRefresh to the body when the caller passes it', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'ds-1', isFullRefresh: true });
      expect(result.isError).toBeFalsy();

      const posted = refreshPosts(harness.server, 'ds-1');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ isFullRefresh: true });
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
  const tool = getRefreshDatasourceExtractTool(new DesktopMcpServer());
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
    instanceId: 'inst-refresh-extract',
    apiVersion: '1.0',
  };
}
