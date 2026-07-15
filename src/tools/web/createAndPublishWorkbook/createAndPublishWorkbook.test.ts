import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { strFromU8, unzipSync } from 'fflate';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCreateAndPublishWorkbookTool } from './createAndPublishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockQueryProjects: vi.fn(),
  mockPublishWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      projectsMethods: { queryProjects: mocks.mockQueryProjects },
      publishingMethods: { publishWorkbook: mocks.mockPublishWorkbook },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const base = {
  packageId: 'com.example.myviz',
  workbookName: 'My Viz',
  html: '<!doctype html><title>hi</title>',
};

describe('createAndPublishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [{ id: 'default-project-id', name: 'Default', topLevelProject: true }],
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      id: 'wb-123',
      name: 'My Viz',
      contentUrl: 'MyViz',
      webpageUrl: 'https://test.tableau.com/#/workbooks/wb-123',
    });
  });

  it('creates a tool instance with the correct properties', () => {
    const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('create-and-publish-workbook');
    expect(tool.description).toContain('in memory');
    expect(tool.paramsSchema).toHaveProperty('packageId');
    expect(tool.paramsSchema).toHaveProperty('html');
    expect(tool.paramsSchema).toHaveProperty('projectId');
  });

  it('builds in memory and publishes a .twbx to the default project', async () => {
    const result = await getToolResult(base);
    expect(result.isError).toBe(false);

    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Default',
    });

    // The published bytes are a real .twbx: unzip and confirm the expected layout.
    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    expect(call).toMatchObject({
      siteId: 'test-site-id',
      projectId: 'default-project-id',
      name: 'My Viz',
      fileName: 'My Viz.twbx',
      workbookType: 'twbx',
    });
    expect(Buffer.isBuffer(call.fileContents)).toBe(true);
    const paths = Object.keys(unzipSync(new Uint8Array(call.fileContents)));
    expect(paths).toContain('My Viz.twb');
    expect(paths).toContain('Packages/com.example.myviz/manifest.json');
    expect(paths).toContain('Packages/com.example.myviz/content/index.html');

    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.id).toBe('wb-123');
    expect(payload.projectId).toBe('default-project-id');
    // The resolver knew the default project's display name — surfaced for the card label.
    expect(payload.projectName).toBe('Default');
    // url is the server's webpageUrl passed through verbatim (not reconstructed).
    expect(payload.url).toBe('https://test.tableau.com/#/workbooks/wb-123');
    expect(payload.webpageUrl).toBe('https://test.tableau.com/#/workbooks/wb-123');
    expect(payload.warnings).toEqual([]);
    // MCP-Apps discriminator: tells the shared client bundle to render the published-workbook card.
    expect(payload.appView).toBe('published-workbook-card');
  });

  it('splits an inline-script html into a package containing content/app.js (server-side, model-invisible)', async () => {
    const result = await getToolResult({
      ...base,
      html: '<!doctype html><body><script>render([1,2,3]);</script></body>',
    });
    expect(result.isError).toBe(false);
    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    const files = unzipSync(new Uint8Array(call.fileContents));
    const paths = Object.keys(files);
    // The entrypoint is still present...
    expect(paths).toContain('Packages/com.example.myviz/content/index.html');
    // ...and the inline script has been externalized beside it.
    expect(paths).toContain('Packages/com.example.myviz/content/app.js');
    expect(strFromU8(files['Packages/com.example.myviz/content/app.js'])).toBe('render([1,2,3]);');
    // index.html now references the external file instead of carrying the inline block.
    const indexHtml = strFromU8(files['Packages/com.example.myviz/content/index.html']);
    expect(indexHtml).toContain('<script src="app.js"></script>');
    expect(indexHtml).not.toContain('render([1,2,3]);');
  });

  it('sanitizes Windows-illegal chars in the .twbx fileName while keeping the display name verbatim', async () => {
    const result = await getToolResult({ ...base, workbookName: 'Q3: Sales/Ops' });
    expect(result.isError).toBe(false);
    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    // Display name (the REST `name` param) is passed through untouched...
    expect(call.name).toBe('Q3: Sales/Ops');
    // ...but the derived on-disk fileName is sanitized (colon/slash → underscore) so the server can
    // write it to disk on a Windows host without a 500.
    expect(call.fileName).toBe('Q3_ Sales_Ops.twbx');
  });

  it('omits url when the server returns no webpageUrl', async () => {
    mocks.mockPublishWorkbook.mockResolvedValue({
      id: 'wb-123',
      name: 'My Viz',
      contentUrl: 'MyViz',
    });
    const result = await getToolResult(base);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    // No fabrication: absent webpageUrl → absent url (JSON drops undefined keys).
    expect(payload.url).toBeUndefined();
    expect(payload.contentUrl).toBe('MyViz');
  });

  it('publishes directly to a project when projectId is given', async () => {
    const result = await getToolResult({ ...base, projectId: 'proj-abc' });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-abc' }),
    );
  });

  it('recovers projectName from the publish response on the explicit-projectId path', async () => {
    // With an explicit projectId the resolver doesn't know the name (no query), so it comes from
    // the publish response's project element instead.
    mocks.mockPublishWorkbook.mockResolvedValue({
      id: 'wb-123',
      name: 'My Viz',
      contentUrl: 'MyViz',
      webpageUrl: 'https://test.tableau.com/#/workbooks/wb-123',
      project: { id: 'proj-abc', name: 'Marketing' },
    });
    const result = await getToolResult({ ...base, projectId: 'proj-abc' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.projectId).toBe('proj-abc');
    expect(payload.projectName).toBe('Marketing');
  });

  it('passes showTabs and overwrite through to the publish call', async () => {
    await getToolResult({ ...base, projectId: 'proj-abc', showTabs: false, overwrite: true });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ showTabs: false, overwrite: true }),
    );
  });

  it('surfaces non-fatal build warnings on the success payload', async () => {
    const result = await getToolResult({
      ...base,
      assets: [{ path: 'data.parquet', base64: Buffer.from('x').toString('base64') }],
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.warnings.some((w: string) => w.includes('data.parquet'))).toBe(true);
  });

  it('returns a clean build error (without publishing) on a bad packageId', async () => {
    const result = await getToolResult({ ...base, packageId: '1bad id!' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // Clean McpToolError text, not the generic "requestId: ..., error:" catch line.
    expect(result.content[0].text).toContain('is not a legal extension id');
    expect(result.content[0].text).not.toContain('requestId:');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('rejects a path-traversal asset (without publishing)', async () => {
    const result = await getToolResult({
      ...base,
      assets: [{ path: '../evil.js', base64: Buffer.from('x').toString('base64') }],
    });
    expect(result.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('surfaces a publish API error', async () => {
    mocks.mockPublishWorkbook.mockRejectedValue(new Error('403 Forbidden'));
    const result = await getToolResult({ ...base, projectId: 'proj-abc' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/Forbidden/i);
  });
});

async function getToolResult(args: {
  packageId: string;
  workbookName: string;
  html: string;
  assets?: Array<{ path: string; base64: string }>;
  toolbarLabel?: string;
  projectId?: string;
  showTabs?: boolean;
  overwrite?: boolean;
}): Promise<CallToolResult> {
  const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  // Spell out every key: the tool's arg type maps each optional field to a required key of type
  // `T | undefined`, so a partial object literal doesn't satisfy it.
  return await callback(
    {
      packageId: args.packageId,
      workbookName: args.workbookName,
      html: args.html,
      assets: args.assets,
      toolbarLabel: args.toolbarLabel,
      projectId: args.projectId,
      showTabs: args.showTabs,
      overwrite: args.overwrite,
    },
    getMockRequestHandlerExtra(),
  );
}
