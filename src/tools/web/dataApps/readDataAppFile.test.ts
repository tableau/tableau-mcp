import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getReadDataAppFileTool, ReadDataAppFileResult } from './readDataAppFile.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra().
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

describe('readDataAppFileTool', () => {
  let store: FakeWorkspaceStore;
  let appId: string;

  beforeEach(async () => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [{ path: 'src/app.js', content: 'console.log("hi");' }],
    });
    appId = workspace.appId;
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getReadDataAppFileTool(new WebMcpServer());
    expect(tool.name).toBe('read-data-app-file');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it.each(['', 'abc', '0'.repeat(31), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any store lookup',
    async (badAppId) => {
      const tool = getReadDataAppFileTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(badAppId).success).toBe(false);
    },
  );

  it('reads a workspace file back as UTF-8 text without requiring filesystem access', async () => {
    const result = await getToolResult({ appId, path: 'src/app.js' });
    expect(result.isError).toBe(false);
    const data = getData(result);
    expect(data.path).toBe('src/app.js');
    expect(data.content).toBe('console.log("hi");');
    expect(data.bytes).toBe(Buffer.byteLength('console.log("hi");', 'utf8'));
  });

  it('never exposes a filesystem path in the result', async () => {
    const result = await getToolResult({ appId, path: 'src/app.js' });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('/tmp');
    expect(result.content[0].text).not.toMatch(/[A-Za-z]:\\/);
  });

  it('returns a clean error for a file that does not exist in the workspace', async () => {
    const result = await getToolResult({ appId, path: 'src/missing.js' });
    expect(result.isError).toBe(true);
  });

  it('cannot read a workspace created under a different actor scope', async () => {
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
      files: [{ path: 'src/app.js', content: 'secret' }],
    });

    const result = await getToolResult({ appId: otherWorkspace.appId, path: 'src/app.js' });
    expect(result.isError).toBe(true);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getReadDataAppFileTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback({ appId, path: 'src/app.js' }, extra);

    expect(result.isError).toBe(true);
  });
});

async function getToolResult(args: { appId: string; path: string }): Promise<CallToolResult> {
  const tool = getReadDataAppFileTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}

function getData(result: CallToolResult): ReadDataAppFileResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ReadDataAppFileResult;
}
