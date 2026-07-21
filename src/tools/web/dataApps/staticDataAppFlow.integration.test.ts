/**
 * CI-safe, in-memory integration test for the full static data-app workflow:
 *
 *   scaffold -> batch upsert -> read preview resource -> validate (receipt) -> mutate source ->
 *   publish (mocked REST)
 *
 * It drives the REAL tool callbacks and the REAL preview resource against a REAL
 * `FileSystemWorkspaceStore` rooted in a throwaway temp directory, mocking only the Tableau REST
 * boundary (`useRestApi`) at publish time. No live service is contacted and nothing is written
 * outside the temp root.
 *
 * PLACEMENT DEVIATION: the Task 7 brief listed this at `tests/e2e/dataApps/staticDataAppFlow.test.ts`.
 * The `tests/e2e` suite (`vitest.config.e2e.ts`) spawns the built server binary and connects to a
 * live Tableau site, so it is neither CI-safe nor part of `scripts/agent-check` (which runs only the
 * `src/` unit config). Per the task's explicit instruction to "use unit/in-memory integration if the
 * tests/e2e config requires services, documenting placement deviation", the flow lives here as a
 * colocated unit-suite integration test so it is exercised by `scripts/agent-check`.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
import { buildScaffoldFiles } from '../dataApps/templates.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookPackageTool } from '../validateWorkbookPackage/validateWorkbookPackage.js';
import { getScaffoldDataAppTool, ScaffoldDataAppResult } from './scaffoldDataApp.js';
import { getUpsertDataAppFilesTool, UpsertDataAppFilesResult } from './upsertDataAppFiles.js';

const mocks = vi.hoisted(() => ({
  mockUseRestApi: vi.fn(),
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

// Authored (real) app content the agent writes ONCE via upsert-data-app-files. Deliberately distinct
// from the scaffold placeholder so we can prove the two are never conflated.
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
    <script src="src/data.js"></script>
    <script src="src/app.js"></script>
  </body>
</html>
`;
const AUTHORED_DATA_JS = `var DATA_APP_ROWS = [
  { quarter: 'Q1', sales: 120 },
  { quarter: 'Q2', sales: 155 },
  { quarter: 'Q3', sales: 143 }
];
`;
const AUTHORED_APP_JS = `(function () {
  var root = document.getElementById('app');
  if (!root) return;
  root.textContent = JSON.stringify(DATA_APP_ROWS);
})();
`;
const AUTHORED_STYLES_CSS = 'body { font-family: system-ui, sans-serif; }\n';

function authoredFiles(): Array<{ path: string; content: string }> {
  return [
    { path: 'index.html', content: AUTHORED_INDEX_HTML },
    { path: 'src/data.js', content: AUTHORED_DATA_JS },
    { path: 'src/app.js', content: AUTHORED_APP_JS },
    { path: 'src/styles.css', content: AUTHORED_STYLES_CSS },
  ];
}

let root: string;

describe('static data-app workflow (in-memory integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'data-app-flow-'));
    storeRef = new FileSystemWorkspaceStore({
      root,
      workspaceTtlMs: 60_000,
      validationTtlMs: 60_000,
      maxFileCount: 50,
      maxFileBytes: 1_000_000,
      maxWorkspaceBytes: 10_000_000,
    });
    setDataAppWorkspaceStore(storeRef);

    // Wire the mocked Tableau REST boundary used only by publish. Validation never touches this.
    mocks.mockUseRestApi.mockImplementation(async ({ callback }: { callback: any }) =>
      callback({
        projectsMethods: { queryProjects: mocks.mockQueryProjects },
        publishingMethods: { publishWorkbook: mocks.mockPublishWorkbook },
        siteId: 'test-site-id',
        userId: 'test-user-id',
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
    // 1. scaffold
    const scaffold = await scaffoldApp();
    const { appId } = scaffold;
    expect(appId).toMatch(/^[0-9a-f]{32}$/);

    // 2. batch upsert HTML/JS/CSS/data in a single call (source is transmitted exactly once, here).
    const upsert = await upsertFiles(appId, authoredFiles());
    expect(upsert.files.map((f) => f.path).sort()).toEqual(
      ['index.html', 'src/app.js', 'src/data.js', 'src/styles.css'].sort(),
    );

    // 3. read the preview resource — it reflects the AUTHORED content, not the scaffold placeholder.
    const previewText = await readPreview(appId);
    expect(previewText).toContain('Quarterly Sales');

    // 4. validate -> receipt. No REST call happens during validation.
    const validation = await validate(appId, 'Quarterly Sales');
    expect(validation.ok).toBe(true);
    invariant(validation.validationId, 'expected a validationId on a successful validation');
    invariant(validation.digest, 'expected a digest on a successful validation');
    expect(mocks.mockUseRestApi).not.toHaveBeenCalled();
    const receiptDigest = validation.digest;

    // 5. mutate the source AFTER validation. The receipt must be unaffected.
    await upsertFiles(appId, [
      { path: 'index.html', content: AUTHORED_INDEX_HTML.replace('Quarterly Sales', 'MUTATED') },
      { path: 'src/data.js', content: 'var DATA_APP_ROWS = [{ quarter: "MUTATED", sales: 0 }];\n' },
    ]);

    // 6. publish, consuming ONLY the receipt.
    const publish = await publishReceipt(validation.validationId);
    expect(publish.isError).toBe(false);

    // 7. the uploaded bytes are byte-for-byte the validated package: their digest equals the receipt
    // digest, and equals the digest of the immutable bytes the store kept — NOT the mutated source.
    const uploaded = uploadedBytes();
    expect(sha256(uploaded)).toBe(receiptDigest);

    const stored = await currentStore().getValidation(SCOPE, validation.validationId);
    expect(sha256(uploaded)).toBe(sha256(stored.bytes));

    const publishPayload = JSON.parse(textOf(publish)) as { digest: string; validationId: string };
    expect(publishPayload.digest).toBe(receiptDigest);
    expect(publishPayload.validationId).toBe(validation.validationId);
  });

  it('does not confuse the scaffold placeholder with later authored content', async () => {
    const { appId } = await scaffoldApp();

    // Preview of the untouched scaffold shows the placeholder, not the authored app.
    const placeholder = await readPreview(appId);
    expect(placeholder).toContain('My App'); // the scaffold title
    expect(placeholder).not.toContain('Quarterly Sales');
    const placeholderDigest = await previewDigest(appId);

    await upsertFiles(appId, authoredFiles());

    const authored = await readPreview(appId);
    expect(authored).toContain('Quarterly Sales');
    const authoredDigest = await previewDigest(appId);

    // The two snapshots are distinct — a later authored app never inherits the placeholder digest.
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

    // Only upsert-data-app-files accepts file content.
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
    // A validation OUTCOME (ok:false), not a thrown terminal error.
  });

  it('requires re-validation to publish changed content (receipts are snapshot-bound)', async () => {
    const { appId } = await scaffoldApp();
    await upsertFiles(appId, authoredFiles());

    const first = await validate(appId, 'Quarterly Sales');
    invariant(first.validationId && first.digest);
    const firstStored = await currentStore().getValidation(SCOPE, first.validationId);

    // Author a materially different app, then validate again to get a fresh receipt.
    await upsertFiles(appId, [
      { path: 'src/data.js', content: 'var DATA_APP_ROWS = [{ quarter: "Q4", sales: 999 }];\n' },
    ]);
    const second = await validate(appId, 'Quarterly Sales');
    invariant(second.validationId && second.digest);
    const secondStored = await currentStore().getValidation(SCOPE, second.validationId);

    // The change is reflected only in the NEW receipt; the old receipt is frozen.
    expect(second.validationId).not.toBe(first.validationId);
    expect(secondStored.sourceDigest).not.toBe(firstStored.sourceDigest);
    expect(second.digest).not.toBe(first.digest);

    // Publishing the OLD receipt still uploads the OLD bytes; the NEW receipt uploads the NEW bytes.
    await publishReceipt(first.validationId);
    expect(sha256(uploadedBytes())).toBe(first.digest);

    mocks.mockPublishWorkbook.mockClear();
    await publishReceipt(second.validationId);
    expect(sha256(uploadedBytes())).toBe(second.digest);
  });

  it('produces a static app that makes no runtime Tableau data request', async () => {
    const { appId } = await scaffoldApp();
    await upsertFiles(appId, authoredFiles());

    // The scaffold itself carries no live-query shim, proxy, or network fetch.
    const scaffoldText = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.app' })
      .map((f) => f.content)
      .join('\n')
      .toLowerCase();
    for (const forbidden of ['fetch(', 'xmlhttprequest', 'window.tableaudata', '/api/', 'vizql']) {
      expect(scaffoldText).not.toContain(forbidden);
    }

    // The authored data is a static, embedded snapshot (rows literal), not a live request.
    const store = currentStore();
    const dataJs = Buffer.from(await store.readFile(SCOPE, appId, 'src/data.js')).toString('utf8');
    expect(dataJs).toContain('DATA_APP_ROWS');
    expect(dataJs.toLowerCase()).not.toContain('fetch(');

    // Validation is entirely offline — it never reaches the Tableau REST boundary.
    const validation = await validate(appId, 'Quarterly Sales');
    expect(validation.ok).toBe(true);
    expect(mocks.mockUseRestApi).not.toHaveBeenCalled();
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

    // (b) A terminal package/publish failure surfaces as isError with the publish failure text.
    mocks.mockPublishWorkbook.mockRejectedValueOnce(
      new Error('403 Forbidden from Tableau publish'),
    );
    const publishFailure = await publishReceipt(validation.validationId);
    expect(publishFailure.isError).toBe(true);
    expect(textOf(publishFailure)).toMatch(/forbidden/i);

    // (c) A missing/expired receipt is a distinct not-found signal, raised BEFORE any REST call.
    mocks.mockPublishWorkbook.mockClear();
    const missingReceipt = await publishReceipt('f'.repeat(32));
    expect(missingReceipt.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    // The three signals are observably different: ok:false (recoverable) vs a terminal publish error
    // vs a not-found receipt error. A transient datasource-query auth error would arise on the
    // separate query-datasource path (not part of this static flow) and is likewise not conflated
    // with these package/publish terminal failures.
  });
});

// --- helpers ---------------------------------------------------------------------------------------

function currentStore(): FileSystemWorkspaceStore {
  // The store set in beforeEach.
  return storeRef;
}

let storeRef: FileSystemWorkspaceStore;

async function scaffoldApp(): Promise<ScaffoldDataAppResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback(
    { appName: 'My App', packageId: 'com.example.app', template: undefined },
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
  return callback({ appId, workbookName, toolbarLabel: undefined }, getMockRequestHandlerExtra());
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
  // Server-verified request signals only: no auth, no session -> resolves to the stdio actor scope,
  // matching the tool callbacks above.
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
