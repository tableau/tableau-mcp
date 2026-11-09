import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
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
import { getWorkspaceExtensionsTool } from './getWorkspaceExtensions.js';
import { getReloadWorkspaceExtensionTool } from './reloadWorkspaceExtension.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('workspace extension tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('gates both tools at External API 0.2.34', () => {
    const server = new DesktopMcpServer();
    const list = getWorkspaceExtensionsTool(server);
    const reload = getReloadWorkspaceExtensionTool(server);
    expect(list.minApiVersion).toBe('0.2.34');
    expect(list.annotations).toMatchObject({ readOnlyHint: true });
    expect(reload.minApiVersion).toBe('0.2.34');
    expect(reload.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true });
  });

  it('GETs /v0/app/extensions', async () => {
    const harness = await startHarness(getWorkspaceExtensionsTool);
    try {
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual({ extensions: [] });
      expect(
        harness.server.requests.filter(
          (r) => r.method === 'GET' && r.path === '/v0/app/extensions',
        ),
      ).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('reports a missing list route as a Desktop update', async () => {
    const tool = getWorkspaceExtensionsTool(new DesktopMcpServer());
    const extra = getMockRequestHandlerExtra();
    const missing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/app/extensions',
        recoverable: false,
      },
    };
    extra.getExecutor = vi.fn().mockResolvedValue({
      listWorkspaceExtensions: vi.fn().mockResolvedValue(new Err(missing)),
    });

    const callback = await Provider.from(tool.callback);
    const result = await callback({ session: '12345' }, extra);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('too old');
  });

  it('POSTs the encoded :reload route with no body', async () => {
    const harness = await startHarness(getReloadWorkspaceExtensionTool);
    try {
      const result = await harness.callTool({ extensionId: 'ab12 cd' });
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).message).toBe(
        'Reloaded workspace extension "ab12 cd".',
      );

      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/app/extensions/ab12%20cd:reload',
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
    } finally {
      await harness.close();
    }
  });
});

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  makeTool: typeof getWorkspaceExtensionsTool | typeof getReloadWorkspaceExtensionTool,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
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
    instanceId: 'inst-workspace-extensions',
    apiVersion: '0.2.34',
  };
}
