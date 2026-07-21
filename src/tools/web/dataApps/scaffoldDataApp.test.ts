import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getScaffoldDataAppTool, ScaffoldDataAppResult } from './scaffoldDataApp.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

const base: { appName: string; packageId: string; template: 'static-html' | undefined } = {
  appName: 'My App',
  packageId: 'com.example.myapp',
  template: undefined,
};

describe('scaffoldDataAppTool', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
  });

  it('creates a tool instance requiring no Tableau REST API scopes', () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
    expect(tool.name).toBe('scaffold-data-app');
    expect(tool.requiredApiScopes).toEqual([]);
  });

  it('creates a deterministic minimal static app and returns appId/files/previewUri/expiresAt', async () => {
    const result = await getToolResult(base);
    expect(result.isError).toBe(false);
    const data = getData(result);

    expect(data.appId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.files.map((f) => f.path).sort()).toEqual(
      ['dataapp.json', 'index.html', 'src/app.js', 'src/data.js', 'src/styles.css'].sort(),
    );
    expect(data.previewUri).toBe(`data-app://workspace/${data.appId}/preview`);
    expect(typeof data.expiresAt).toBe('string');
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('gives duplicate app names distinct opaque appIds', async () => {
    const first = getData(await getToolResult(base));
    const second = getData(await getToolResult(base));
    expect(first.appId).not.toBe(second.appId);
  });

  it('never exposes a localPath unless local-path mode is explicitly enabled', async () => {
    store.localPathFor = (appId) => `/tmp/data-app-workspaces/${appId}`;
    const result = await getToolResult(base);
    const data = getData(result);
    expect(data.localPath).toBeUndefined();
  });

  it('does not expose an injected provider localPath over HTTP even when config enables it', async () => {
    store.localPathFor = (appId) => `/tmp/data-app-workspaces/${appId}`;
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.config.dataApps.exposeLocalPath = true;
    extra.sessionId = 'session-1';

    const data = getData(await getToolResult(base, extra));
    expect(data.localPath).toBeUndefined();
  });

  it('includes localPath only when stdio transport and config explicitly enable it', async () => {
    store.localPathFor = (appId) => `/tmp/data-app-workspaces/${appId}`;
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'stdio';
    extra.config.dataApps.exposeLocalPath = true;

    const data = getData(await getToolResult(base, extra));
    expect(data.localPath).toBe(`/tmp/data-app-workspaces/${data.appId}`);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getScaffoldDataAppTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback({ ...base }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text.toLowerCase()).toContain('scope');
  });
});

async function getToolResult(
  args: {
    appName: string;
    packageId: string;
    template: 'static-html' | undefined;
  },
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}

function getData(result: CallToolResult): ScaffoldDataAppResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ScaffoldDataAppResult;
}
