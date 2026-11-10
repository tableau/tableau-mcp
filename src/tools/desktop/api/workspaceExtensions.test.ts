import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  MockOverride,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWorkspaceExtensionsTool } from './getWorkspaceExtensions.js';
import { getReloadWorkspaceExtensionTool } from './reloadWorkspaceExtension.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const EXTENSIONS = [
  {
    id: 'ws-ext-enabled',
    extensionKey: {
      id: 'com.example.enabled',
      version: '1.2.0',
      url: 'file:///Packages/a/index.html',
    },
    name: 'Enabled Extension',
    author: 'Example Co',
    isEnabled: true,
  },
  {
    id: 'ws-ext-disabled',
    extensionKey: {
      id: 'com.example.disabled',
      version: '0.1.0',
      url: 'file:///Packages/b/index.html',
    },
    name: 'Disabled Extension',
    author: 'Example Co',
    isEnabled: false,
  },
];

const accepted202 = (operationId: string): MockOverride => ({
  status: 202,
  contentType: 'application/json',
  headers: {
    location: `/v0/operations/${operationId}`,
    'retry-after': '0',
    'x-tableau-operation-id': operationId,
  },
  body: JSON.stringify({ id: operationId, kind: 'reload-workspace-extension', state: 'RUNNING' }),
});

describe('workspace extension tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
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

  it('preserves enabled and disabled extension records', async () => {
    const harness = await startHarness(getWorkspaceExtensionsTool, (server) => {
      server.setOverride('GET /v0/app/extensions', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ extensions: EXTENSIONS }),
      });
    });
    try {
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual({ extensions: EXTENSIONS });
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

  it('reports a synchronous workspace-extension-not-found without claiming success', async () => {
    const harness = await startHarness(getReloadWorkspaceExtensionTool, (server) => {
      server.setOverride('POST /v0/app/extensions/missing:reload', {
        status: 404,
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          code: 'workspace-extension-not-found',
          detail: 'No workspace extension has id missing.',
        }),
      });
    });
    try {
      const result = await harness.callTool({ extensionId: 'missing' });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result);
      expect(text).toContain('No workspace extension has id missing.');
      expect(text).not.toContain('too old');
      expect(text).not.toContain('Reloaded');
    } finally {
      await harness.close();
    }
  });

  it.each([
    [
      'an unknown id',
      'workspace-extension-not-found',
      'No workspace extension has id ws-ext-disabled.',
    ],
    ['a disabled extension', 'operation-failed', 'Workspace extension is disabled.'],
    ['a non-Packages extension', 'operation-failed', 'Not in the Packages folder.'],
  ])('reports a 202 then FAILED operation for %s', async (label, code, message) => {
    const operationId = `op-reload-${label.replaceAll(' ', '-')}`;
    const harness = await startHarness(getReloadWorkspaceExtensionTool, (server) => {
      server.setOverride(
        'POST /v0/app/extensions/ws-ext-disabled:reload',
        accepted202(operationId),
      );
      server.setOperation(operationId, {
        retryAfterSeconds: 0,
        poll: [
          {
            id: operationId,
            kind: 'reload-workspace-extension',
            state: 'FAILED',
            error: { code, message },
          },
        ],
      });
    });
    try {
      const result = await harness.callTool({ extensionId: 'ws-ext-disabled' });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result);
      expect(text).toContain(message);
      expect(text).not.toContain('too old');
      expect(text).not.toContain('Reloaded');
      expect(harness.server.requests.some((r) => r.path === `/v0/operations/${operationId}`)).toBe(
        true,
      );
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
  configure?: (server: MockExternalApiServer) => void,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  configure?.(server);
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
