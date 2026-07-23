/**
 * CI-safe, in-memory integration test for the full LIVE data-app workflow:
 *
 *   scaffold (REST/VDS wiring) -> batch upsert (authored live app) -> read preview resource ->
 *   validate (receipt) -> mutate source -> publish (mocked REST)
 *
 * It drives the REAL tool callbacks and the REAL preview resource against a REAL
 * `FileSystemWorkspaceStore` rooted in a throwaway temp directory, mocking only the Tableau REST/VDS
 * boundary (`useRestApi`). No live service is contacted and nothing is written outside the temp root.
 *
 * The app is a bundled dashboard extension that queries its published datasource LIVE via
 * `readMetadataAsync`/`queryAsync` — there is NO embedded data snapshot. Visual review of the live
 * result happens in Tableau after publish (a live query cannot run outside the Tableau host), so this
 * test asserts the mechanical package/receipt/publish contract, not runtime rendering.
 *
 * PLACEMENT DEVIATION: the true end-to-end publish (against the local API build, asserting the
 * extension renders + `queryAsync` returns rows) is a deliberate, out-of-`agent-check` e2e concern.
 * This colocated unit-suite integration test exercises the CI-safe portion of the flow.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { FileSystemWorkspaceStore } from '../../../dataApps/fileSystemWorkspaceStore.js';
import { resetDataAppWorkspaceStore, setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { WorkspaceScope } from '../../../dataApps/types.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import {
  buildDataAppPreviewUri,
  getDataAppPreviewResource,
  PREVIEW_META_KEY,
} from '../../../resources/dataApps/dataAppPreviewResource.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getCreateAndPublishWorkbookTool } from '../createAndPublishWorkbook/createAndPublishWorkbook.js';
import { buildScaffoldFiles, EXTENSIONS_LIB_REF } from '../dataApps/templates.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookPackageTool } from '../validateWorkbookPackage/validateWorkbookPackage.js';
import { getScaffoldDataAppTool, ScaffoldDataAppResult } from './scaffoldDataApp.js';
import { getUpsertDataAppFilesTool, UpsertDataAppFilesResult } from './upsertDataAppFiles.js';

const DS_LUID = '00c07e8d-62a8-4bb0-96fd-a3227b610253';

const mocks = vi.hoisted(() => ({
  mockUseRestApi: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockReadMetadata: vi.fn(),
  mockQueryProjects: vi.fn(),
  mockPublishWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: mocks.mockUseRestApi,
}));

// The stdio actor scope produced by getMockRequestHandlerExtra() (stdio transport + config.server
// from the stubbed SERVER env var, no authenticated Tableau identity). Used to inspect the real
// store directly in assertions.
const SCOPE: WorkspaceScope = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

// Authored (real) LIVE app content the agent writes via upsert-data-app-files. It loads the injected
// Extensions API library, then a live app.js that queries via queryAsync — NO data.js snapshot.
const AUTHORED_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Quarterly Sales</title>
    <link rel="stylesheet" href="src/styles.css" />
  </head>
  <body>
    <h1>Quarterly Sales</h1>
    <div id="app"></div>
    <script src="${EXTENSIONS_LIB_REF}"></script>
    <script src="src/app.js"></script>
  </body>
</html>
`;
const AUTHORED_APP_JS = `(function () {
  'use strict';
  var root = document.getElementById('app');
  function extractData(result) {
    var p = result && result.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return []; } }
    return (p && p.data) || (result && result.data) || [];
  }
  tableau.extensions.initializeAsync().then(function () {
    var dc = tableau.extensions.dashboardContent;
    return dc.dashboard.getAllDataSourcesAsync();
  }).then(function (list) {
    var ds = list[0];
    return ds.queryAsync({ fields: [{ fieldCaption: 'Category' }, { fieldCaption: 'Sales', function: 'SUM' }] });
  }).then(function (result) {
    root.textContent = JSON.stringify(extractData(result));
  });
})();
`;
const AUTHORED_STYLES_CSS = 'body { font-family: system-ui, sans-serif; }\n';

function authoredFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'index.html', content: AUTHORED_INDEX_HTML },
    { path: 'src/app.js', content: AUTHORED_APP_JS },
    { path: 'src/styles.css', content: AUTHORED_STYLES_CSS },
  ];
}

let root: string;
let storeRef: FileSystemWorkspaceStore;

describe('live data-app workflow (in-memory integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'data-app-flow-'));
    storeRef = new FileSystemWorkspaceStore({
      root,
      workspaceTtlMs: 60_000,
      validationTtlMs: 60_000,
      maxFileCount: 50,
      maxFileBytes: 5_000_000,
      maxWorkspaceBytes: 20_000_000,
    });
    setDataAppWorkspaceStore(storeRef);

    // Wire the mocked Tableau REST/VDS boundary: scaffold uses datasources/vizql; publish uses
    // projects/publishing. isDatasourceAllowed short-circuits (no bounded context) without REST.
    mocks.mockUseRestApi.mockImplementation(async ({ callback }: { callback: any }) =>
      callback({
        datasourcesMethods: { queryDatasource: mocks.mockQueryDatasource },
        vizqlDataServiceMethods: { readMetadata: mocks.mockReadMetadata },
        projectsMethods: { queryProjects: mocks.mockQueryProjects },
        publishingMethods: { publishWorkbook: mocks.mockPublishWorkbook },
        siteId: 'test-site-id',
        userId: 'test-user-id',
      }),
    );
    mocks.mockQueryDatasource.mockResolvedValue({
      id: DS_LUID,
      name: 'Quarterly Sales DS',
      contentUrl: 'QuarterlySalesDS',
      project: { id: 'p1', name: 'default' },
      tags: {},
    });
    mocks.mockReadMetadata.mockResolvedValue(
      new Ok({
        data: [
          {
            fieldName: 'category',
            fieldCaption: 'Category',
            dataType: 'STRING',
            fieldRole: 'DIMENSION',
          },
          { fieldName: 'sales', fieldCaption: 'Sales', dataType: 'REAL', fieldRole: 'MEASURE' },
        ],
      }),
    );
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [{ id: 'default-project-id', name: 'Default', topLevelProject: true }],
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      id: 'wb-123',
      name: 'Quarterly Sales',
      contentUrl: 'QuarterlySales',
      webpageUrl: 'https://test.tableau.com/#/workbooks/wb-123',
    });
  });

  afterEach(() => {
    resetDataAppWorkspaceStore();
    rmSync(root, { recursive: true, force: true });
  });

  it('publishes the exact validated bytes even after the source is mutated post-validation', async () => {
    const { appId } = await scaffoldApp();
    expect(appId).toMatch(/^[0-9a-f]{32}$/);

    const upsert = await upsertFiles(appId, authoredFiles());
    expect(upsert.files.map((f) => f.path).sort()).toEqual(
      ['index.html', 'src/app.js', 'src/styles.css'].sort(),
    );

    const previewText = await readPreview(appId);
    expect(previewText).toContain('Quarterly Sales');

    // validate -> receipt. No REST call happens during validation.
    const restCallsBeforeValidate = mocks.mockUseRestApi.mock.calls.length;
    const validation = await validate(appId, 'Quarterly Sales');
    expect(validation.ok).toBe(true);
    invariant(validation.validationId, 'expected a validationId on a successful validation');
    invariant(validation.digest, 'expected a digest on a successful validation');
    expect(mocks.mockUseRestApi.mock.calls.length).toBe(restCallsBeforeValidate);
    const receiptDigest = validation.digest;

    // mutate the source AFTER validation. The receipt must be unaffected.
    await upsertFiles(appId, [
      { path: 'index.html', content: AUTHORED_INDEX_HTML.replace('Quarterly Sales', 'MUTATED') },
    ]);

    const publish = await publishReceipt(validation.validationId);
    expect(publish.isError).toBe(false);

    const uploaded = uploadedBytes();
    expect(sha256(uploaded)).toBe(receiptDigest);

    const stored = await storeRef.getValidation(SCOPE, validation.validationId);
    expect(sha256(uploaded)).toBe(sha256(stored.bytes));

    const publishPayload = JSON.parse(textOf(publish)) as { digest: string; validationId: string };
    expect(publishPayload.digest).toBe(receiptDigest);
    expect(publishPayload.validationId).toBe(validation.validationId);
  });

  it('does not confuse the scaffold placeholder with later authored content', async () => {
    const { appId } = await scaffoldApp();

    const placeholder = await readPreview(appId);
    expect(placeholder).toContain('My App'); // the scaffold title
    expect(placeholder).not.toContain('Quarterly Sales');
    const placeholderDigest = await previewDigest(appId);

    await upsertFiles(appId, authoredFiles());

    const authored = await readPreview(appId);
    expect(authored).toContain('Quarterly Sales');
    const authoredDigest = await previewDigest(appId);

    expect(authoredDigest).not.toBe(placeholderDigest);
  });

  it('transmits HTML only through upsert — validate and publish carry no source/HTML params', () => {
    const validateTool = getValidateWorkbookPackageTool(new WebMcpServer());
    expect(validateTool.paramsSchema).toHaveProperty('appId');
    expect(validateTool.paramsSchema).not.toHaveProperty('html');
    expect(validateTool.paramsSchema).not.toHaveProperty('assets');
    expect(validateTool.paramsSchema).not.toHaveProperty('files');

    const publishTool = getCreateAndPublishWorkbookTool(new WebMcpServer());
    expect(publishTool.paramsSchema).toHaveProperty('validationId');
    expect(publishTool.paramsSchema).not.toHaveProperty('html');
    expect(publishTool.paramsSchema).not.toHaveProperty('assets');
    expect(publishTool.paramsSchema).not.toHaveProperty('workbookName');

    const upsertTool = getUpsertDataAppFilesTool(new WebMcpServer());
    expect(upsertTool.paramsSchema).toHaveProperty('files');
  });

  it('blocks receipt issuance when a referenced local asset is missing', async () => {
    const { appId } = await scaffoldApp();
    await upsertFiles(appId, [
      {
        path: 'index.html',
        content: AUTHORED_INDEX_HTML.replace(
          '<div id="app"></div>',
          '<img src="missing-chart.png" />',
        ),
      },
      ...authoredFiles().filter((f) => f.path !== 'index.html'),
    ]);

    const validation = await validate(appId, 'Quarterly Sales');
    expect(validation.ok).toBe(false);
    expect(validation.validationId).toBeUndefined();
    expect(validation.warnings.join(' ')).toContain('missing-chart.png');
  });

  it('does NOT flag the injected Extensions API library as a missing asset', async () => {
    const { appId } = await scaffoldApp();
    // The scaffold index.html references EXTENSIONS_LIB_REF, which is injected by the builder and is
    // NOT present in the workspace source. Validation must still succeed.
    const validation = await validate(appId, 'My App');
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => w.includes(EXTENSIONS_LIB_REF))).toBe(false);
  });

  it('requires re-validation to publish changed content (receipts are snapshot-bound)', async () => {
    const { appId } = await scaffoldApp();
    await upsertFiles(appId, authoredFiles());

    const first = await validate(appId, 'Quarterly Sales');
    invariant(first.validationId && first.digest);
    const firstStored = await storeRef.getValidation(SCOPE, first.validationId);

    await upsertFiles(appId, [
      { path: 'src/app.js', content: AUTHORED_APP_JS.replace('Category', 'Region') },
    ]);
    const second = await validate(appId, 'Quarterly Sales');
    invariant(second.validationId && second.digest);
    const secondStored = await storeRef.getValidation(SCOPE, second.validationId);

    expect(second.validationId).not.toBe(first.validationId);
    expect(secondStored.sourceDigest).not.toBe(firstStored.sourceDigest);
    expect(second.digest).not.toBe(first.digest);

    await publishReceipt(first.validationId);
    expect(sha256(uploadedBytes())).toBe(first.digest);

    mocks.mockPublishWorkbook.mockClear();
    await publishReceipt(second.validationId);
    expect(sha256(uploadedBytes())).toBe(second.digest);
  });

  it('produces a live scaffold (no data.js snapshot) that queries via the Extensions API', async () => {
    await scaffoldApp();

    const scaffold = buildScaffoldFiles({
      appName: 'My App',
      packageId: 'com.example.app',
      datasources: [],
    });
    const paths = scaffold.map((f) => f.path).sort();
    expect(paths).toEqual(['dataapp.json', 'index.html', 'src/app.js', 'src/styles.css'].sort());
    expect(paths).not.toContain('src/data.js');

    const appJs = scaffold.find((f) => f.path === 'src/app.js')!.content;
    expect(appJs).toContain('initializeAsync');
    expect(appJs).toContain('readMetadataAsync');
    expect(appJs).toContain('extractData');
    // The live boot skeleton must not embed a static row snapshot.
    expect(appJs).not.toContain('DATA_APP_ROWS');

    const indexHtml = scaffold.find((f) => f.path === 'index.html')!.content;
    expect(indexHtml).toContain(EXTENSIONS_LIB_REF);
  });

  it('distinguishes a terminal publish failure from a recoverable validation outcome and a missing receipt', async () => {
    const { appId } = await scaffoldApp();
    await upsertFiles(appId, authoredFiles());

    // (a) A recoverable validation outcome is ok:false — NOT a thrown/terminal error.
    const missingAsset = await validateRaw(appId, 'Quarterly Sales', [
      { path: 'index.html', content: '<!doctype html><img src="nope.png" />' },
    ]);
    expect(missingAsset.isError).toBe(false);
    const missingAssetPayload = JSON.parse(textOf(missingAsset));
    expect(missingAssetPayload.ok).toBe(false);

    // Restore valid source, then produce a good receipt for the terminal-failure cases below.
    await upsertFiles(appId, [{ path: 'index.html', content: AUTHORED_INDEX_HTML }]);
    const validation = await validate(appId, 'Quarterly Sales');
    invariant(validation.validationId);

    // (b) A terminal publish failure surfaces as isError with the publish failure text.
    mocks.mockPublishWorkbook.mockRejectedValueOnce(
      new Error('403 Forbidden from Tableau publish'),
    );
    const publishFailure = await publishReceipt(validation.validationId);
    expect(publishFailure.isError).toBe(true);
    expect(textOf(publishFailure)).toMatch(/forbidden/i);

    // (c) A missing/expired receipt is a distinct not-found signal, raised BEFORE any publish call.
    mocks.mockPublishWorkbook.mockClear();
    const missingReceipt = await publishReceipt('f'.repeat(32));
    expect(missingReceipt.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });
});

// --- helpers ---------------------------------------------------------------------------------------

async function scaffoldApp(): Promise<ScaffoldDataAppResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback(
    {
      appName: 'My App',
      packageId: 'com.example.app',
      datasources: [{ luid: DS_LUID, contentUrl: 'QuarterlySalesDS', name: 'Quarterly Sales DS' }],
      template: undefined,
    },
    getMockRequestHandlerExtra(),
  );
  expect(result.isError).toBe(false);
  return JSON.parse(textOf(result)) as ScaffoldDataAppResult;
}

async function upsertFiles(
  appId: string,
  files: Array<{ path: string; content: string }>,
): Promise<UpsertDataAppFilesResult> {
  const tool = getUpsertDataAppFilesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback({ appId, files }, getMockRequestHandlerExtra());
  expect(result.isError).toBe(false);
  return JSON.parse(textOf(result)) as UpsertDataAppFilesResult;
}

type ValidateResult = {
  ok: boolean;
  validationId?: string;
  digest?: string;
  warnings: string[];
};

async function validate(appId: string, workbookName: string): Promise<ValidateResult> {
  const result = await validateRaw(appId, workbookName);
  return JSON.parse(textOf(result)) as ValidateResult;
}

async function validateRaw(
  appId: string,
  workbookName: string,
  preUpsert?: Array<{ path: string; content: string }>,
): Promise<CallToolResult> {
  if (preUpsert) {
    await upsertFiles(appId, preUpsert);
  }
  const tool = getValidateWorkbookPackageTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return callback({ appId, workbookName }, getMockRequestHandlerExtra());
}

async function publishReceipt(validationId: string): Promise<CallToolResult> {
  const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return callback(
    { validationId, projectId: undefined, showTabs: undefined, overwrite: undefined },
    getMockRequestHandlerExtra(),
  );
}

async function readPreview(appId: string): Promise<string> {
  const resource = getDataAppPreviewResource(new WebMcpServer());
  const uri = new URL(buildDataAppPreviewUri(appId));
  const result = await resource.read(uri, { appId }, resourceExtra());
  const [content] = result.contents;
  if (!('text' in content) || typeof content.text !== 'string') {
    throw new Error('expected a text preview content');
  }
  return content.text;
}

async function previewDigest(appId: string): Promise<string> {
  const resource = getDataAppPreviewResource(new WebMcpServer());
  const uri = new URL(buildDataAppPreviewUri(appId));
  const result = await resource.read(uri, { appId }, resourceExtra());
  const meta = result.contents[0]._meta?.[PREVIEW_META_KEY] as { digest: string } | undefined;
  invariant(meta?.digest, 'expected a preview digest');
  return meta.digest;
}

function resourceExtra(): any {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
    authInfo: undefined,
    sessionId: undefined,
  };
}

function uploadedBytes(): Uint8Array {
  const call = mocks.mockPublishWorkbook.mock.calls[0]?.[0];
  invariant(call, 'expected a publishWorkbook call');
  return new Uint8Array(call.fileContents as Buffer);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function textOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
