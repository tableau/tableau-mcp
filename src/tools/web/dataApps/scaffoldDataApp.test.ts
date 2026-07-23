import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getScaffoldDataAppTool, ScaffoldDataAppResult } from './scaffoldDataApp.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockReadMetadata: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-1',
      datasourcesMethods: { queryDatasource: mocks.mockQueryDatasource },
      vizqlDataServiceMethods: { readMetadata: mocks.mockReadMetadata },
    }),
  ),
}));

type ScaffoldArgs = {
  appName: string;
  packageId: string;
  datasources: Array<{ luid: string; contentUrl?: string; name?: string }>;
  template?: 'live-extension';
};

const base: ScaffoldArgs = {
  appName: 'My App',
  packageId: 'com.example.myapp',
  datasources: [{ luid: '00c07e8d-62a8-4bb0-96fd-a3227b610253' }],
};

describe('scaffoldDataAppTool', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);

    // Default happy-path REST/VDS responses.
    mocks.mockQueryDatasource.mockResolvedValue({
      id: '00c07e8d-62a8-4bb0-96fd-a3227b610253',
      name: 'World Cup Songs',
      contentUrl: 'WorldCupSongs',
      project: { id: 'p1', name: 'default' },
      tags: {},
    });
    mocks.mockReadMetadata.mockResolvedValue(
      new Ok({
        data: [
          {
            fieldName: 'youtube_views',
            fieldCaption: 'Youtube Views',
            dataType: 'REAL',
            fieldRole: 'MEASURE',
          },
          {
            fieldName: 'song_title',
            fieldCaption: 'Song Title',
            dataType: 'STRING',
            fieldRole: 'DIMENSION',
          },
        ],
      }),
    );
  });

  it('creates a tool instance requiring content + viz_data_service read scopes', () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
    expect(tool.name).toBe('scaffold-data-app');
    expect([...tool.requiredApiScopes].sort()).toEqual(
      ['tableau:content:read', 'tableau:viz_data_service:read'].sort(),
    );
  });

  it('creates a deterministic live app and returns appId/files/datasources/previewUri/expiresAt', async () => {
    const result = await getToolResult(base);
    expect(result.isError).toBe(false);
    const data = getData(result);

    expect(data.appId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.files.map((f) => f.path).sort()).toEqual(
      ['dataapp.json', 'index.html', 'src/app.js', 'src/styles.css'].sort(),
    );
    expect(data.datasources).toEqual([
      {
        luid: '00c07e8d-62a8-4bb0-96fd-a3227b610253',
        contentUrl: 'WorldCupSongs',
        name: 'World Cup Songs',
      },
    ]);
    expect(data.previewUri).toBe(`data-app://workspace/${data.appId}/preview`);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('resolves contentUrl/name from REST when the client omits them', async () => {
    await getToolResult(base);
    expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
    expect(mocks.mockReadMetadata).toHaveBeenCalledWith({
      datasource: { datasourceLuid: '00c07e8d-62a8-4bb0-96fd-a3227b610253' },
    });
  });

  it('skips the REST identity lookup when the client supplies contentUrl and name', async () => {
    const result = await getToolResult({
      ...base,
      datasources: [{ luid: 'ds-1', contentUrl: 'MyDs', name: 'My Ds' }],
    });
    const data = getData(result);
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(data.datasources).toEqual([{ luid: 'ds-1', contentUrl: 'MyDs', name: 'My Ds' }]);
  });

  it('gives duplicate app names distinct opaque appIds', async () => {
    const first = getData(await getToolResult(base));
    const second = getData(await getToolResult(base));
    expect(first.appId).not.toBe(second.appId);
  });

  it('fails cleanly when VizQL Data Service metadata is unavailable', async () => {
    mocks.mockReadMetadata.mockResolvedValue(new Err('feature-disabled'));
    const result = await getToolResult(base);
    expect(result.isError).toBe(true);
  });

  it('fails cleanly when the datasource identity cannot be looked up', async () => {
    mocks.mockQueryDatasource.mockRejectedValue(new Error('404'));
    const result = await getToolResult(base);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text.toLowerCase()).toContain('datasource');
  });

  it('never exposes a localPath unless local-path mode is explicitly enabled', async () => {
    store.localPathFor = (appId) => `/tmp/data-app-workspaces/${appId}`;
    const data = getData(await getToolResult(base));
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

    const result = await getToolResult(base, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text.toLowerCase()).toContain('scope');
  });
});

async function getToolResult(
  args: ScaffoldArgs,
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ template: undefined, ...args }, extra);
}

function getData(result: CallToolResult): ScaffoldDataAppResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as ScaffoldDataAppResult;
}
