import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { DataAppSnapshot } from '../../../dataApps/types.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { buildWorkspaceTwbx } from '../createAndPublishWorkbook/buildWorkspaceTwbx.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { EditDataAppResult, getEditDataAppTool } from './editDataApp.js';
import { FakeWorkspaceStore } from './workspaceStore.mock.js';

const mocks = vi.hoisted(() => ({
  mockDownloadWorkbook: vi.fn(),
  mockIsWorkbookAllowed: vi.fn(),
}));

// useRestApi is the only network boundary: its callback receives the fake restApi below, whose
// downloadWorkbook returns the packaged bytes the tool inverts.
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-1',
      workbooksMethods: {
        downloadWorkbook: mocks.mockDownloadWorkbook,
      },
    }),
  ),
}));

// The access gate is exercised by its own tests; here we stub it so we can drive allow/deny directly
// without a second useRestApi round trip.
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isWorkbookAllowed: mocks.mockIsWorkbookAllowed },
  exportedForTesting: {
    resetResourceAccessCheckerSingleton: vi.fn(),
    createResourceAccessChecker: vi.fn(),
  },
}));

// A real scaffold build — the exact package the edit flow inverts. Mirrors reconstructWorkspaceFromTwbx.test.ts.
const MANIFEST = {
  schemaVersion: 2,
  appName: 'My App',
  packageId: 'com.example.myapp',
  entrypoint: 'index.html',
  template: 'live-extension',
  datasources: [
    {
      luid: '00c07e8d-62a8-4bb0-96fd-a3227b610253',
      contentUrl: 'WorldCupSongs',
      name: 'World Cup Songs',
      sqlproxyName: 'sqlproxy.abc123',
      host: 'tableau.example.com',
      port: '8080',
      field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
    },
  ],
};

const SCAFFOLD: Record<string, string> = {
  'index.html':
    '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head>' +
    '<body><div id="app"></div><script src="src/tableau.extensions.1.latest.js"></script>' +
    '<script src="src/app.js"></script></body></html>',
  'src/app.js': 'console.log("app");',
  'src/styles.css': 'body{margin:0}',
  'dataapp.json': JSON.stringify(MANIFEST),
};

function snapshot(files: Record<string, string>): DataAppSnapshot {
  const entries = Object.entries(files)
    .map(([path, content]) => ({ path, content: new TextEncoder().encode(content) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { appId: 'a'.repeat(32), files: entries, digest: 'source-digest', createdAt: new Date() };
}

function dataAppBytes(): Uint8Array {
  return buildWorkspaceTwbx(snapshot(SCAFFOLD), {
    workbookName: 'My App',
    packageId: 'com.example.myapp',
  }).bytes;
}

const WORKBOOK_ID = '11111111-2222-3333-4444-555555555555';

describe('editDataAppTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    setDataAppWorkspaceStore(new FakeWorkspaceStore());

    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.mockDownloadWorkbook.mockResolvedValue(dataAppBytes());
  });

  it('requires workbook download + content read scopes', () => {
    const tool = getEditDataAppTool(new WebMcpServer());
    expect(tool.name).toBe('edit-data-app');
    expect([...tool.requiredApiScopes]).toContain('tableau:workbooks:download');
    expect([...tool.requiredApiScopes]).toContain('tableau:content:read');
  });

  it('reopens the app as a fresh editable workspace (appId + inverted files)', async () => {
    const data = getData(await getToolResult());

    expect(data.appId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.files.map((f) => f.path).sort()).toEqual(
      ['dataapp.json', 'index.html', 'src/app.js', 'src/styles.css'].sort(),
    );
  });

  it('rejects a workbook that is not a data-app package', async () => {
    mocks.mockDownloadWorkbook.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    const result = await getToolResult();
    expect(result.isError).toBe(true);
  });

  it('rejects when the access check denies the workbook (no download)', async () => {
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: false, message: 'nope' });

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(mocks.mockDownloadWorkbook).not.toHaveBeenCalled();
  });
});

async function getToolResult(extra = getMockRequestHandlerExtra()): Promise<CallToolResult> {
  const tool = getEditDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookId: WORKBOOK_ID }, extra);
}

function getData(result: CallToolResult): EditDataAppResult {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as EditDataAppResult;
}
