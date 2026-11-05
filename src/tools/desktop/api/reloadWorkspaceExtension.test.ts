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
import { getReloadWorkspaceExtensionTool } from './reloadWorkspaceExtension.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('reload-workspace-extension tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the External API 0.2.33 floor and idempotent annotations', () => {
    const tool = getReloadWorkspaceExtensionTool(new DesktopMcpServer());
    expect(tool.minApiVersion).toBe('0.2.33');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('POSTs the workspace extension reload route body-less', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ extensionId: 'com.example.extension' });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (request) =>
          request.method === 'POST' &&
          request.path === '/v0/workspace/extensions/com.example.extension:reload',
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).message).toBe(
        'Reloaded workspace extension "com.example.extension".',
      );
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
  const tool = getReloadWorkspaceExtensionTool(new DesktopMcpServer());
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
    instanceId: 'inst-reload-workspace-extension',
    apiVersion: '0.2.33',
  };
}
