import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getUpsertDataAppFilesTool, UpsertDataAppFilesResult } from './upsertDataAppFiles.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra() (stdio
// transport, config.server from the stubbed SERVER env var, no authenticated Tableau identity).
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

describe('upsertDataAppFilesTool', () => {
  let store: FakeWorkspaceStore;
  let appId: string;

  beforeEach(async () => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [{ path: 'dataapp.json', content: '{}' }],
    });
    appId = workspace.appId;
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getUpsertDataAppFilesTool(new WebMcpServer());
    expect(tool.name).toBe('upsert-data-app-files');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it.each(['', 'abc', '0'.repeat(31), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any store lookup',
    async (badAppId) => {
      const tool = getUpsertDataAppFilesTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(badAppId).success).toBe(false);
    },
  );

  it('writes each source file once and returns path/size/digest', async () => {
    const upsertFiles = vi.spyOn(store, 'upsertFiles');
    const snapshot = vi.spyOn(store, 'snapshot');
    const files = [
      { path: 'src/app.js', content: 'console.log(1);' },
      { path: 'src/styles.css', content: 'body{}' },
    ];
    const result = await getToolResult({
      appId,
      files,
    });

    expect(result.isError).toBe(false);
    expect(upsertFiles).toHaveBeenCalledTimes(1);
    expect(upsertFiles).toHaveBeenCalledWith(SCOPE, appId, files);
    expect(snapshot).not.toHaveBeenCalled();
    const data = getData(result);
    expect(data.files.map((f) => f.path).sort()).toEqual(['src/app.js', 'src/styles.css']);
    expect(data.files.find((f) => f.path === 'src/app.js')?.bytes).toBe(
      Buffer.byteLength('console.log(1);', 'utf8'),
    );
    expect(typeof data.digest).toBe('string');
    expect(data.digest.length).toBeGreaterThan(0);

    // Written exactly once: reading it back returns exactly what was sent.
    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'src/app.js');
    expect(Buffer.from(bytes).toString('utf8')).toBe('console.log(1);');
  });

  it('protects dataapp.json from being overwritten by an ordinary upsert', async () => {
    const result = await getToolResult({
      appId,
      files: [{ path: 'dataapp.json', content: '{"tampered":true}' }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dataapp.json');

    const bytes = await getDataAppWorkspaceStore().readFile(SCOPE, appId, 'dataapp.json');
    expect(Buffer.from(bytes).toString('utf8')).toBe('{}');
  });

  it.each(['dataapp.json', 'DataApp.json', 'DATAAPP.JSON'])(
    'rejects protected manifest path %s before calling a permissive provider',
    async (path) => {
      const upsertFiles = vi.spyOn(store, 'upsertFiles').mockResolvedValue({
        files: [{ path, bytes: 2 }],
        digest: 'provider-should-not-be-called',
      });

      const result = await getToolResult({
        appId,
        files: [{ path, content: '{}' }],
      });

      expect(result.isError).toBe(true);
      expect(upsertFiles).not.toHaveBeenCalled();
    },
  );

  it('writes nothing when any item in the batch fails validation (atomic preflight)', async () => {
    const result = await getToolResult({
      appId,
      files: [
        { path: 'src/app.js', content: 'console.log(1);' },
        { path: 'dataapp.json', content: '{"tampered":true}' },
      ],
    });

    expect(result.isError).toBe(true);
    const listResult = await store.listFiles(SCOPE, appId);
    expect(listResult.some((f) => f.path === 'src/app.js')).toBe(false);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getUpsertDataAppFilesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback({ appId, files: [{ path: 'src/app.js', content: 'x' }] }, extra);

    expect(result.isError).toBe(true);
  });

  it('returns a not-found error for an unknown appId rather than throwing', async () => {
    const result = await getToolResult({
      appId: '0'.repeat(32),
      files: [{ path: 'src/app.js', content: 'x' }],
    });
    expect(result.isError).toBe(true);
  });
});

async function getToolResult(args: {
  appId: string;
  files: Array<{ path: string; content: string }>;
}): Promise<CallToolResult> {
  const tool = getUpsertDataAppFilesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}

function getData(result: CallToolResult): UpsertDataAppFilesResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as UpsertDataAppFilesResult;
}
