import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileSystemWorkspaceStore } from '../../dataApps/fileSystemWorkspaceStore.js';
import { resetDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../dataApps/init.js';
import type { WorkspaceScope } from '../../dataApps/types.js';
import { DataAppWorkspaceNotFoundError } from '../../errors/mcpToolError.js';
import { WebMcpServer } from '../../server.web.js';
import { buildDataAppPreviewUri, getDataAppPreviewResource } from './dataAppPreviewResource.js';

const scope: WorkspaceScope = {
  server: 'https://my-tableau-server.com',
  siteId: 'no-site',
  actorId: 'local-stdio',
};

function resourceExtra(): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  } as unknown as RequestHandlerExtra<ServerRequest, ServerNotification>;
}

describe('data-app preview resource boundary', () => {
  let root: string;
  let store: FileSystemWorkspaceStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dataapp-preview-'));
    store = new FileSystemWorkspaceStore({
      root,
      workspaceTtlMs: 60_000,
      validationTtlMs: 60_000,
      maxFileCount: 10,
      maxFileBytes: 4096,
      maxWorkspaceBytes: 16_384,
    });
    setDataAppWorkspaceStore(store);
  });

  afterEach(() => {
    resetDataAppWorkspaceStore();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['../escape', 'not-an-opaque-id', 'A'.repeat(32)])(
    'maps malformed appId %s to the same not-found signal',
    async (appId) => {
      const resource = getDataAppPreviewResource(new WebMcpServer());
      const uri = new URL(`data-app://workspace/${encodeURIComponent(appId)}/preview`);

      await expect(resource.read(uri, { appId }, resourceExtra())).rejects.toBeInstanceOf(
        DataAppWorkspaceNotFoundError,
      );
    },
  );

  it('uses only an HTML manifest entrypoint for the static MVP preview', async () => {
    const workspace = await store.create(scope, {
      appName: 'Static App',
      packageId: 'com.example.static',
      files: [
        {
          path: 'dataapp.json',
          content: JSON.stringify({
            schemaVersion: 1,
            appName: 'Static App',
            packageId: 'com.example.static',
            template: 'static-html',
            entrypoint: 'src/app.js',
          }),
        },
        { path: 'index.html', content: '<html><body>safe html</body></html>' },
        { path: 'src/app.js', content: 'globalThis.notHtml = true;' },
      ],
    });
    const resource = getDataAppPreviewResource(new WebMcpServer());
    const uri = new URL(buildDataAppPreviewUri(workspace.appId));

    const result = await resource.read(uri, { appId: workspace.appId }, resourceExtra());

    expect(result.contents[0]).toMatchObject({
      mimeType: 'text/html',
      text: '<html><body>safe html</body></html>',
      _meta: {
        'tableau/dataAppPreview': expect.objectContaining({ entrypoint: 'index.html' }),
      },
    });
  });
});
