import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomBytes } from 'crypto';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { MAX_SINGLE_REQUEST_BYTES } from '../_lib/publishShared.js';
import { buildWorkspaceTwbx } from '../createAndPublishWorkbook/buildWorkspaceTwbx.js';
import { FakeWorkspaceStore } from '../dataApps/workspaceStore.mock.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookPackageTool } from './validateWorkbookPackage.js';

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra() (stdio transport,
// config.server from the stubbed SERVER env var, no authenticated Tableau identity).
const SCOPE = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

// A minimal, self-consistent scaffold: index.html references only sibling files that ARE present.
const GOOD_FILES = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head>' +
      '<body><div id="app"></div><script src="src/data.js"></script>' +
      '<script src="src/app.js"></script></body></html>',
  },
  { path: 'src/app.js', content: 'console.log("app");' },
  { path: 'src/styles.css', content: 'body{margin:0}' },
  { path: 'src/data.js', content: 'var DATA_APP_ROWS=[];' },
  { path: 'dataapp.json', content: '{"schemaVersion":1,"appName":"My App"}' },
];

type ValidateResult = {
  ok: boolean;
  validationId?: string;
  digest?: string;
  warnings: string[];
  checksPerformed: string[];
  byteLength: number;
  expiresAt?: string;
};

describe('validateWorkbookPackageTool', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
  });

  async function createApp(
    files: Array<{ path: string; content: string | Uint8Array }> = GOOD_FILES,
    packageId = 'com.example.myapp',
  ): Promise<string> {
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId,
      template: 'static-html',
      files,
    });
    return workspace.appId;
  }

  it('creates a tool instance that accepts appId (not html/publish params)', async () => {
    const tool = getValidateWorkbookPackageTool(new WebMcpServer());
    expect(tool.name).toBe('validate-workbook-package');
    expect(tool.requiredApiScopes).toEqual([]);
    expect(tool.paramsSchema).toHaveProperty('appId');
    expect(tool.paramsSchema).toHaveProperty('workbookName');
    // The raw-HTML contract is gone; no publish-target params either.
    expect(tool.paramsSchema).not.toHaveProperty('html');
    expect(tool.paramsSchema).not.toHaveProperty('assets');
    expect(tool.paramsSchema).not.toHaveProperty('packageId');
    expect(tool.paramsSchema).not.toHaveProperty('projectId');
    // Plain-JSON tool: neither app nor meta.
    expect(tool.app).toBeUndefined();
    expect(tool.meta).toBeUndefined();
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(false);
  });

  it.each(['', 'abc', '0'.repeat(31), '0'.repeat(33), 'A'.repeat(32), '../escape'])(
    'rejects malformed appId %j at the schema boundary before any provider call',
    async (appId) => {
      const tool = getValidateWorkbookPackageTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.appId.safeParse(appId).success).toBe(false);
    },
  );

  it('accepts exactly 32 lowercase hexadecimal appId characters', async () => {
    const tool = getValidateWorkbookPackageTool(new WebMcpServer());
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.appId.safeParse('0123456789abcdef'.repeat(2)).success).toBe(true);
  });

  it('returns ok:true with a validationId and the SHA-256 digest of the stored TWBX', async () => {
    const appId = await createApp();
    const snapshot = await store.snapshot(SCOPE, appId);
    const expectedDigest = createHash('sha256')
      .update(
        buildWorkspaceTwbx(snapshot, { packageId: 'com.example.myapp', workbookName: 'My App' })
          .bytes,
      )
      .digest('hex');

    const payload = await getData(await run({ appId, workbookName: 'My App' }));
    expect(payload.ok).toBe(true);
    expect(payload.validationId).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.digest).toBe(expectedDigest);
    expect(payload.byteLength).toBeGreaterThan(0);
    expect(payload.warnings).toEqual([]);
    expect(payload.checksPerformed).toEqual(['structure', 'asset-references', 'size']);
    expect(typeof payload.expiresAt).toBe('string');
  });

  it('never returns the package bytes to the model', async () => {
    const appId = await createApp();
    const result = await run({ appId, workbookName: 'My App' });
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text) as ValidateResult & { bytes?: unknown };
    expect(payload).not.toHaveProperty('bytes');
    // The receipt is a small JSON handle, not a serialized archive.
    expect(result.content[0].text.length).toBeLessThan(2000);
  });

  it('stores the exact validated bytes: changing workspace files afterward does not change them', async () => {
    const appId = await createApp();
    const originalSnapshot = await store.snapshot(SCOPE, appId);
    const expectedBytes = buildWorkspaceTwbx(originalSnapshot, {
      packageId: 'com.example.myapp',
      workbookName: 'My App',
    }).bytes;
    const first = await getData(await run({ appId, workbookName: 'My App' }));
    invariant(first.validationId);

    // Mutate the workspace after validation.
    await store.upsertFiles(SCOPE, appId, [
      { path: 'src/app.js', content: 'console.log("CHANGED");' },
    ]);
    const newSnapshotDigest = (await store.snapshot(SCOPE, appId)).digest;

    const stored = await store.getValidation(SCOPE, first.validationId);
    expect(stored.bytes).toEqual(expectedBytes);
    expect(createHash('sha256').update(stored.bytes).digest('hex')).toBe(first.digest);
    expect(stored.digest).toBe(createHash('sha256').update(expectedBytes).digest('hex'));
    // ...and it was built from the ORIGINAL snapshot, which now differs from current source.
    expect(stored.sourceDigest).not.toBe(newSnapshotDigest);
  });

  it('returns ok:false with no validationId when the HTML references an unpackaged asset', async () => {
    const appId = await createApp([
      { path: 'index.html', content: '<!doctype html><script src="chart-lib.js"></script>' },
      { path: 'dataapp.json', content: '{}' },
    ]);
    const payload = await getData(await run({ appId, workbookName: 'My App' }));
    expect(payload.ok).toBe(false);
    expect(payload.validationId).toBeUndefined();
    expect(payload.warnings.some((w) => w.includes('chart-lib.js'))).toBe(true);
    expect(payload.checksPerformed).toEqual(['structure', 'asset-references', 'size']);
  });

  it('reports all checks and issues no validationId for an over-64-MiB package', async () => {
    const bigBytes = new Uint8Array(randomBytes(MAX_SINGLE_REQUEST_BYTES + 1024 * 1024));
    const appId = await createApp(
      [
        { path: 'index.html', content: '<!doctype html><title>hi</title>' },
        { path: 'big.png', content: bigBytes },
        { path: 'dataapp.json', content: '{}' },
      ],
      'com.example.big',
    );
    const payload = await getData(await run({ appId, workbookName: 'Big App' }));
    expect(payload.ok).toBe(false);
    expect(payload.validationId).toBeUndefined();
    expect(payload.byteLength).toBeGreaterThan(MAX_SINGLE_REQUEST_BYTES);
    expect(payload.warnings.some((w) => w.includes('64 MB'))).toBe(true);
    expect(payload.checksPerformed).toEqual(['structure', 'asset-references', 'size']);
  });

  it('reports a structural failure (illegal packageId) as ok:false without a receipt', async () => {
    const appId = await createApp(GOOD_FILES, '1bad id!');
    const payload = await getData(await run({ appId, workbookName: 'My App' }));
    expect(payload.ok).toBe(false);
    expect(payload.validationId).toBeUndefined();
    expect(payload.warnings.some((w) => w.includes('legal extension id'))).toBe(true);
    expect(payload.checksPerformed).toEqual(['structure']);
  });

  it.each([
    ['encoded traversal', '<script src="%2e%2e/escape.js"></script>', 'escape.js'],
    [
      'mismatched literal encoding',
      '<img src="images/hero%20image.png">',
      'images/hero%20image.png',
    ],
    ['malformed encoding', '<img src="images/bad%2.png">', 'images/bad%2.png'],
    ['encoded forward slash', '<img src="images%2Fsecret.png">', 'images%2Fsecret.png'],
    ['encoded backslash', '<img src="images%5Csecret.png">', 'images%5Csecret.png'],
    ['encoded NUL', '<img src="images%00secret.png">', 'images%00secret.png'],
  ])('does not issue a receipt for %s', async (_case, html, assetPath) => {
    const appId = await createApp([
      { path: 'index.html', content: html },
      { path: assetPath, content: 'x' },
      { path: 'dataapp.json', content: '{}' },
    ]);

    const payload = await getData(await run({ appId, workbookName: 'My App' }));
    expect(payload.ok).toBe(false);
    expect(payload.validationId).toBeUndefined();
    expect(payload.checksPerformed).toEqual(['structure', 'asset-references', 'size']);
  });

  it('preserves an advisory extension warning while still issuing a receipt (ok:true)', async () => {
    // A .parquet asset is off the serve-time allow-list -> advisory (non-blocking) warning. It is
    // referenced from nowhere, so it is not a hard reference failure.
    const appId = await createApp([
      { path: 'index.html', content: '<!doctype html><title>hi</title>' },
      { path: 'data.parquet', content: 'x' },
      { path: 'dataapp.json', content: '{}' },
    ]);
    const payload = await getData(await run({ appId, workbookName: 'My App' }));
    expect(payload.ok).toBe(true);
    expect(payload.validationId).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.warnings.some((w) => w.includes('data.parquet'))).toBe(true);
  });

  it('returns a not-found error for an unknown appId rather than throwing', async () => {
    const result = await run({ appId: '0'.repeat(32), workbookName: 'My App' });
    expect(result.isError).toBe(true);
  });

  it('cannot validate a workspace created under a different actor scope', async () => {
    const otherScope = resolveWorkspaceScope({
      transport: 'stdio',
      server: 'https://my-tableau-server.com',
      siteId: 'other-site',
      userId: 'other-user',
    }).unwrap();
    const otherWorkspace = await store.create(otherScope, {
      appName: 'Other',
      packageId: 'com.example.other',
      template: 'static-html',
      files: GOOD_FILES,
    });
    const result = await run({ appId: otherWorkspace.appId, workbookName: 'Other' });
    expect(result.isError).toBe(true);
  });

  it('rejects the call when no trusted actor scope can be resolved', async () => {
    const appId = await createApp();
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getValidateWorkbookPackageTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { appId, workbookName: 'My App', toolbarLabel: undefined },
      extra,
    );
    expect(result.isError).toBe(true);
  });
});

async function run(args: {
  appId: string;
  workbookName: string;
  toolbarLabel?: string;
}): Promise<CallToolResult> {
  const tool = getValidateWorkbookPackageTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ toolbarLabel: undefined, ...args }, getMockRequestHandlerExtra());
}

async function getData(result: CallToolResult): Promise<ValidateResult> {
  invariant(result.content[0].type === 'text');
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text) as ValidateResult;
}
