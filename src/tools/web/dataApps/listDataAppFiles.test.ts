import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListDataAppFilesTool, ListDataAppFilesResult } from './listDataAppFiles.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra().
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

describe('listDataAppFilesTool', () => {
  let store: FakeWorkspaceStore;
  let appId: string;

  beforeEach(async () => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [
        { path: 'index.html', content: '<html></html>' },
        { path: 'src/app.js', content: 'console.log(1);' },
      ],
    });
    appId = workspace.appId;
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getListDataAppFilesTool(new WebMcpServer());
    expect(tool.name).toBe('list-data-app-files');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it.each(['', 'abc', '0'.repeat(31), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any store lookup',
    async (badAppId) => {
      const tool = getListDataAppFilesTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(badAppId).success).toBe(false);
    },
  );

  it('lists every file currently in the workspace with path and byte size', async () => {
    const result = await getToolResult({ appId });
    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.files.map((f) => f.path).sort()).toEqual(['index.html', 'src/app.js']);
    expect(data.files.find((f) => f.path === 'index.html')?.bytes).toBe(
      Buffer.byteLength('<html></html>', 'utf8'),
    );
  });

  it('never exposes a filesystem path in the result', async () => {
    store.localPathFor = () => '/tmp/data-app-workspaces/secret';
    const result = await getToolResult({ appId });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('/tmp');
  });

  it('returns a clean error for an unknown appId rather than throwing', async () => {
    const result = await getToolResult({ appId: '0'.repeat(32) });
    expect(result.isError).toBe(true);
  });

  it('cannot list files from a workspace created under a different actor scope', async () => {
    const otherScope = resolveWorkspaceScope({
      transport: 'stdio',
      server: 'https://my-tableau-server.com',
      siteId: 'other-site',
      userId: 'other-user',
    }).unwrap();
    const otherWorkspace = await store.create(otherScope, {
      appName: 'Other App',
      packageId: 'com.example.other',
      template: 'static-html',
      files: [{ path: 'index.html', content: 'x' }],
    });

    const result = await getToolResult({ appId: otherWorkspace.appId });
    expect(result.isError).toBe(true);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getListDataAppFilesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback({ appId }, extra);

    expect(result.isError).toBe(true);
  });
});

async function getToolResult(args: { appId: string }): Promise<CallToolResult> {
  const tool = getListDataAppFilesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}

function getData(result: CallToolResult): ListDataAppFilesResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ListDataAppFilesResult;
}
