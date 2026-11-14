import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
import { getRefreshDatasourceTool } from './refreshDatasource.js';

vi.mock('../../../desktop/session/sessionResolution.js');

function messageOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return (JSON.parse(result.content[0].text) as { message: string }).message;
}

function refreshPosts(
  server: MockExternalApiServer,
  datasourceId: string,
  route: 'refreshData' | 'refreshExtract',
): Array<{ body: string }> {
  const path = `/v0/datasources/${datasourceId}:${route}`;
  return server.requests.filter((r) => r.method === 'POST' && r.path === path);
}

describe('refresh-datasource tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('requires refreshType', async () => {
    const schema = z.object(
      await Provider.from(getRefreshDatasourceTool(new DesktopMcpServer()).paramsSchema),
    );
    expect(schema.safeParse({ datasourceId: 'ds-1' }).success).toBe(false);
    expect(schema.safeParse({ datasourceId: 'ds-1', refreshType: 'data' }).success).toBe(true);
  });

  it('POSTs refreshData for a data refresh and reports it', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'ds-1', refreshType: 'data' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Refreshed the live data for datasource "ds-1".');
      expect(refreshPosts(harness.server, 'ds-1', 'refreshData')).toHaveLength(1);
      expect(refreshPosts(harness.server, 'ds-1', 'refreshExtract')).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('POSTs refreshExtract without isFullRefresh when the caller omits it', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ datasourceId: 'ds-1', refreshType: 'extract' });
      expect(result.isError).toBeFalsy();
      expect(messageOf(result)).toBe('Refreshed the extract for datasource "ds-1".');

      const posted = refreshPosts(harness.server, 'ds-1', 'refreshExtract');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({});
      expect(refreshPosts(harness.server, 'ds-1', 'refreshData')).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('forwards isFullRefresh on an extract refresh', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        datasourceId: 'ds-1',
        refreshType: 'extract',
        isFullRefresh: true,
      });
      expect(result.isError).toBeFalsy();

      const posted = refreshPosts(harness.server, 'ds-1', 'refreshExtract');
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ isFullRefresh: true });
    } finally {
      await harness.close();
    }
  });

  it('rejects isFullRefresh on a data refresh without calling Desktop', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        datasourceId: 'ds-1',
        refreshType: 'data',
        isFullRefresh: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('isFullRefresh applies only to refreshType extract');
      expect(harness.server.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it.each(['data', 'extract'] as const)(
    'puts an already percent-encoded datasource id in the %s route verbatim',
    async (refreshType) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ datasourceId: 'My%20Data', refreshType });
        expect(result.isError).toBeFalsy();
        const route = refreshType === 'data' ? 'refreshData' : 'refreshExtract';
        expect(refreshPosts(harness.server, 'My%20Data', route)).toHaveLength(1);
      } finally {
        await harness.close();
      }
    },
  );
});

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getRefreshDatasourceTool(new DesktopMcpServer());
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
    instanceId: 'inst-refresh-datasource',
    apiVersion: '1.0',
  };
}
