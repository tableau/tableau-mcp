import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';

import { resetDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../dataApps/init.js';
import type { WorkspaceScope } from '../../dataApps/types.js';
import { DataAppWorkspaceNotFoundError } from '../../errors/mcpToolError.js';
import { WebMcpServer } from '../../server.web.js';
import { buildScaffoldFiles } from '../../tools/web/dataApps/templates.js';
import { FakeWorkspaceStore } from '../../tools/web/dataApps/workspaceStore.mock.js';
import { registerResources } from '../index.js';
import {
  buildDataAppPreviewUri,
  DATA_APP_PREVIEW_URI_TEMPLATE,
  getDataAppPreviewResource,
  PREVIEW_META_KEY,
} from './dataAppPreviewResource.js';

const SCOPE_SERVER = 'https://scope-server.example.com';

function bearerAuthInfo(userId: string, siteId = 'site-1', server = SCOPE_SERVER): AuthInfo {
  return {
    token: 'opaque-access-token',
    clientId: 'test-client',
    scopes: [],
    extra: {
      type: 'Bearer',
      username: 'user@example.com',
      server,
      siteId,
      siteName: 'site',
      userId,
      raw: 'jwt',
    },
  } as unknown as AuthInfo;
}

function scopeFor(userId: string, siteId = 'site-1', server = SCOPE_SERVER): WorkspaceScope {
  return { server, siteId, actorId: `user:${userId}` };
}

function extraWith(
  authInfo?: AuthInfo,
  sessionId?: string,
): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
    authInfo,
    sessionId,
  } as unknown as RequestHandlerExtra<ServerRequest, ServerNotification>;
}

async function seedWorkspace(
  store: FakeWorkspaceStore,
  scope: WorkspaceScope,
  appName = 'My App',
): Promise<string> {
  const ws = await store.create(scope, {
    appName,
    packageId: 'com.example.myapp',
    template: 'live-extension',
    files: buildScaffoldFiles({ appName, packageId: 'com.example.myapp', datasources: [] }),
  });
  return ws.appId;
}

function getContentText(content: ReadResourceResult['contents'][number]): string {
  if (!('text' in content) || typeof content.text !== 'string') {
    throw new Error('expected a text resource content, got a blob');
  }
  return content.text;
}

describe('data-app preview resource', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
  });

  afterEach(() => {
    resetDataAppWorkspaceStore();
  });

  it('registers a dynamic template at data-app://workspace/{appId}/preview', () => {
    const resource = getDataAppPreviewResource(new WebMcpServer());
    expect(resource.name).toBe('data-app-preview');
    expect(resource.template).toBeInstanceOf(ResourceTemplate);
    expect(resource.template.uriTemplate.toString()).toBe(DATA_APP_PREVIEW_URI_TEMPLATE);
    expect(DATA_APP_PREVIEW_URI_TEMPLATE).toBe('data-app://workspace/{appId}/preview');
    expect(resource.mimeType).toBe('text/html');
  });

  it('exposes a previewUri builder that matches the template', () => {
    expect(buildDataAppPreviewUri('abc123')).toBe('data-app://workspace/abc123/preview');
  });

  it('returns the workspace entry HTML with an explicit html MIME type and digest', async () => {
    const appId = await seedWorkspace(store, scopeFor('user-a'), 'Sales App');
    const resource = getDataAppPreviewResource(new WebMcpServer());
    const uri = new URL(buildDataAppPreviewUri(appId));

    const result = await resource.read(uri, { appId }, extraWith(bearerAuthInfo('user-a')));

    expect(result.contents).toHaveLength(1);
    const [content] = result.contents;
    expect(content.uri).toBe(uri.href);
    expect(content.mimeType).toBe('text/html');

    const text = getContentText(content);
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('<title>Sales App</title>');

    const meta = (content._meta ?? {})[PREVIEW_META_KEY] as
      | { digest: string; byteLength: number; entrypoint: string }
      | undefined;
    expect(meta).toBeDefined();
    const expectedDigest = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    expect(meta?.digest).toBe(expectedDigest);
    expect(meta?.byteLength).toBe(Buffer.byteLength(text, 'utf8'));
    expect(meta?.entrypoint).toBe('index.html');
  });

  it('resolves the preview only within the caller server-verified actor scope', async () => {
    const appId = await seedWorkspace(store, scopeFor('user-a'));
    const resource = getDataAppPreviewResource(new WebMcpServer());
    const uri = new URL(buildDataAppPreviewUri(appId));

    // Same appId, but a different authenticated actor -> not found (not another scope's source).
    await expect(
      resource.read(uri, { appId }, extraWith(bearerAuthInfo('user-b'))),
    ).rejects.toThrow(/not found|expired/i);
  });

  it('does not serve source through a guessed appId from another scope', async () => {
    const appId = await seedWorkspace(store, scopeFor('user-a'));
    const resource = getDataAppPreviewResource(new WebMcpServer());

    // user-b guesses user-a's real appId. Scope is derived from server-verified signals, not the URI.
    const guessed = new URL(buildDataAppPreviewUri(appId));
    await expect(
      resource.read(guessed, { appId }, extraWith(bearerAuthInfo('user-b'))),
    ).rejects.toBeInstanceOf(DataAppWorkspaceNotFoundError);
  });

  it('fails cleanly when the workspace is expired', async () => {
    const appId = await seedWorkspace(store, scopeFor('user-a'));
    // Simulate expiry: the store collapses expired/wrong-scope/never-existed into one not-found.
    vi.spyOn(store, 'get').mockRejectedValueOnce(new DataAppWorkspaceNotFoundError());

    const resource = getDataAppPreviewResource(new WebMcpServer());
    const uri = new URL(buildDataAppPreviewUri(appId));
    await expect(
      resource.read(uri, { appId }, extraWith(bearerAuthInfo('user-a'))),
    ).rejects.toBeInstanceOf(DataAppWorkspaceNotFoundError);
  });

  it('rejects when no trusted actor scope can be resolved', async () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    try {
      const resource = getDataAppPreviewResource(new WebMcpServer());
      const uri = new URL(buildDataAppPreviewUri('anything'));
      // Multi-user HTTP with neither an authenticated user nor a session id.
      await expect(resource.read(uri, { appId: 'anything' }, extraWith())).rejects.toThrow(
        /scope/i,
      );
    } finally {
      vi.unstubAllEnvs();
      vi.stubEnv('SERVER', 'https://my-tableau-server.com');
      vi.stubEnv('SITE_NAME', 'tc25');
      vi.stubEnv('PAT_NAME', 'sponge');
      vi.stubEnv('PAT_VALUE', 'bob');
      vi.stubEnv('TABLEAU_MCP_TEST', 'true');
      vi.stubEnv('PRODUCT_TELEMETRY_ENABLED', 'false');
    }
  });

  describe('capability metadata', () => {
    it('never claims that every host executes arbitrary JavaScript', () => {
      const resource = getDataAppPreviewResource(new WebMcpServer());
      const description = resource.description;
      expect(description).not.toMatch(/every (host|client)[\s\S]{0,40}execute/i);
      expect(description).not.toMatch(/all (hosts|clients)[\s\S]{0,40}(run|execute)/i);
    });

    it('states that rendering and JavaScript execution are host-dependent', () => {
      const resource = getDataAppPreviewResource(new WebMcpServer());
      const description = resource.description.toLowerCase();
      expect(description).toContain('host-dependent');
      expect(resource.description).toMatch(/not guaranteed|no promise|does not (guarantee|run)/i);
    });
  });
});

describe('registerResources with the preview template', () => {
  beforeEach(() => {
    setDataAppWorkspaceStore(new FakeWorkspaceStore());
  });

  afterEach(() => {
    resetDataAppWorkspaceStore();
  });

  it('registers the preview template exactly once', () => {
    const server = new WebMcpServer();
    server.mcpServer.registerResource = vi.fn();

    registerResources(server, { dataAppWorkspacesEnabled: true });

    const templateCalls = vi
      .mocked(server.mcpServer.registerResource)
      .mock.calls.filter(
        (call) =>
          call[1] instanceof ResourceTemplate &&
          call[1].uriTemplate.toString() === DATA_APP_PREVIEW_URI_TEMPLATE,
      );
    expect(templateCalls).toHaveLength(1);
  });
});
