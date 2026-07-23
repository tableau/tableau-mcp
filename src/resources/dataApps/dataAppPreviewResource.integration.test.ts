import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { resetDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../dataApps/init.js';
import type { WorkspaceScope } from '../../dataApps/types.js';
import { WebMcpServer } from '../../server.web.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import { buildScaffoldFiles } from '../../tools/web/dataApps/templates.js';
import { FakeWorkspaceStore } from '../../tools/web/dataApps/workspaceStore.mock.js';
import { registerResources } from '../index.js';
import { buildDataAppPreviewUri } from './dataAppPreviewResource.js';

// This suite intentionally exercises the real SDK McpServer request dispatcher. The global unit-test
// setup mocks McpServer for registration-focused tests, so opt this file back into the pinned SDK.
vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');

const serverOrigin = 'https://scope-server.example.com';

function authInfoFor(userId: string): AuthInfo {
  return {
    token: 'opaque-access-token',
    clientId: 'integration-client',
    scopes: [],
    extra: {
      type: 'Bearer',
      username: `${userId}@example.com`,
      server: serverOrigin,
      siteId: 'site-1',
      siteName: 'site',
      userId,
      raw: 'verified-jwt',
    },
  } as unknown as AuthInfo;
}

function scopeFor(userId: string): WorkspaceScope {
  return { server: serverOrigin, siteId: 'site-1', actorId: `user:${userId}` };
}

function sessionScopeFor(sessionId: string): WorkspaceScope {
  return {
    server: 'https://my-tableau-server.com',
    siteId: 'no-site',
    actorId: `session:${sessionId}`,
  };
}

async function connectClientWithAuth(
  authInfo: AuthInfo,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalSend = clientTransport.send.bind(clientTransport);

  // InMemoryTransport explicitly supports injecting server-verified AuthInfo for authentication
  // tests. Every client request, including resources/read, reaches the server with this AuthInfo.
  clientTransport.send = (message, options) =>
    originalSend(message, { ...options, authInfo } as Parameters<typeof originalSend>[1]);

  const server = new WebMcpServer();
  registerResources(server, { dataAppWorkspacesEnabled: true });
  await server.mcpServer.connect(serverTransport);

  const client = new Client({ name: 'preview-integration-test', version: '1.0.0' });
  await client.connect(clientTransport as Transport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.mcpServer.close();
    },
  };
}

async function connectClientWithSession(
  sessionId: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Protocol builds RequestHandlerExtra.sessionId from the connected server transport's sessionId.
  // The client cannot supply or override it in resources/read params.
  serverTransport.sessionId = sessionId;

  const server = new WebMcpServer();
  registerResources(server, { dataAppWorkspacesEnabled: true });
  await server.mcpServer.connect(serverTransport);

  const client = new Client({ name: 'preview-session-integration-test', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.mcpServer.close();
    },
  };
}

describe('data-app preview resources/read integration', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
  });

  afterEach(() => {
    resetDataAppWorkspaceStore();
    vi.unstubAllEnvs();
  });

  it('uses server-verified authInfo from MCP resources/read to scope access', async () => {
    const workspace = await store.create(scopeFor('alice'), {
      appName: 'Alice App',
      packageId: 'com.example.alice',
      files: buildScaffoldFiles({
        appName: 'Alice App',
        packageId: 'com.example.alice',
        datasources: [],
      }),
    });
    const connection = await connectClientWithAuth(authInfoFor('alice'));

    try {
      const result = await connection.client.readResource({
        uri: buildDataAppPreviewUri(workspace.appId),
      });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        mimeType: 'text/html',
        text: expect.stringContaining('<title>Alice App</title>'),
      });
    } finally {
      await connection.close();
    }
  });

  it('does not let a different verified actor read the same appId through resources/read', async () => {
    const workspace = await store.create(scopeFor('alice'), {
      appName: 'Alice Secret App',
      packageId: 'com.example.alice',
      files: buildScaffoldFiles({
        appName: 'Alice Secret App',
        packageId: 'com.example.alice',
        datasources: [],
      }),
    });
    const connection = await connectClientWithAuth(authInfoFor('bob'));

    try {
      await expect(
        connection.client.readResource({ uri: buildDataAppPreviewUri(workspace.appId) }),
      ).rejects.toThrow(/not found|expired/i);
    } finally {
      await connection.close();
    }
  });

  it('uses the server transport sessionId fallback for same-session resources/read access', async () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    const workspace = await store.create(sessionScopeFor('session-a'), {
      appName: 'Session App',
      packageId: 'com.example.session',
      files: buildScaffoldFiles({
        appName: 'Session App',
        packageId: 'com.example.session',
        datasources: [],
      }),
    });
    const connection = await connectClientWithSession('session-a');

    try {
      const result = await connection.client.readResource({
        uri: buildDataAppPreviewUri(workspace.appId),
      });

      expect(result.contents[0]).toMatchObject({
        mimeType: 'text/html',
        text: expect.stringContaining('<title>Session App</title>'),
      });
    } finally {
      await connection.close();
    }
  });

  it('denies a different server transport sessionId through resources/read', async () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    const workspace = await store.create(sessionScopeFor('session-a'), {
      appName: 'Session Secret App',
      packageId: 'com.example.session',
      files: buildScaffoldFiles({
        appName: 'Session Secret App',
        packageId: 'com.example.session',
        datasources: [],
      }),
    });
    const connection = await connectClientWithSession('session-b');

    try {
      await expect(
        connection.client.readResource({ uri: buildDataAppPreviewUri(workspace.appId) }),
      ).rejects.toThrow(/not found|expired/i);
    } finally {
      await connection.close();
    }
  });
});
