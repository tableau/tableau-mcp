import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';

import { setDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { generateOpaqueId } from '../../../dataApps/opaqueId.js';
import type { WorkspaceScope } from '../../../dataApps/types.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { FakeWorkspaceStore } from '../dataApps/workspaceStore.mock.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCreateAndPublishWorkbookTool } from './createAndPublishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockUseRestApi: vi.fn(),
  mockQueryProjects: vi.fn(),
  mockPublishWorkbook: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: mocks.mockUseRestApi,
}));

// Keep AUDIT_LOGGER real; spy on log so we can assert the safe audit payload.
vi.mock('../../../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../logging/logger.js')>();
  return { ...actual, log: mocks.mockLog };
});

// Must match what resolveScopeFromExtra derives from getMockRequestHandlerExtra() (stdio transport,
// config.server from the stubbed SERVER env var, no authenticated Tableau identity).
const SCOPE: WorkspaceScope = resolveWorkspaceScope({
  transport: 'stdio',
  server: 'https://my-tableau-server.com',
}).unwrap();

// The exact bytes a prior validate-workbook-package call stored in the receipt. Publication must
// upload these verbatim — they are deliberately NOT a real TWBX to prove nothing rebuilds them.
const RECEIPT_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 0, 255, 128]);
const RECEIPT_DIGEST = createHash('sha256').update(RECEIPT_BYTES).digest('hex');

describe('createAndPublishWorkbookTool', () => {
  let store: FakeWorkspaceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new FakeWorkspaceStore();
    setDataAppWorkspaceStore(store);
    mocks.mockUseRestApi.mockImplementation(async ({ callback }) =>
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
      name: 'My Viz',
      contentUrl: 'MyViz',
      webpageUrl: 'https://test.tableau.com/#/workbooks/wb-123',
    });
  });

  // Persist an immutable validation receipt under `scope` and return its opaque id.
  async function saveReceipt(
    overrides: Partial<{
      scope: WorkspaceScope;
      bytes: Uint8Array;
      workbookName: string;
      warnings: string[];
      ttlMs: number;
    }> = {},
  ): Promise<string> {
    const scope = overrides.scope ?? SCOPE;
    const bytes = overrides.bytes ?? RECEIPT_BYTES;
    const validationId = generateOpaqueId();
    if (overrides.ttlMs !== undefined) {
      store.validationTtlMs = overrides.ttlMs;
    }
    await store.saveValidation(scope, {
      validationId,
      appId: 'a'.repeat(32),
      bytes,
      digest: createHash('sha256').update(bytes).digest('hex'),
      sourceDigest: 'src-digest',
      workbookName: overrides.workbookName ?? 'My Viz',
      warnings: overrides.warnings ?? [],
      checksPerformed: ['structure', 'asset-references', 'size'],
      byteLength: bytes.byteLength,
    });
    return validationId;
  }

  it('creates a tool instance that accepts validationId (not html/build params)', () => {
    const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('create-and-publish-workbook');
    expect(tool.paramsSchema).toHaveProperty('validationId');
    expect(tool.paramsSchema).toHaveProperty('projectId');
    expect(tool.paramsSchema).toHaveProperty('showTabs');
    expect(tool.paramsSchema).toHaveProperty('overwrite');
    // The raw-build contract is gone.
    expect(tool.paramsSchema).not.toHaveProperty('html');
    expect(tool.paramsSchema).not.toHaveProperty('assets');
    expect(tool.paramsSchema).not.toHaveProperty('packageId');
    expect(tool.paramsSchema).not.toHaveProperty('workbookName');
    expect(tool.paramsSchema).not.toHaveProperty('toolbarLabel');
  });

  it('publishes the exact stored receipt bytes and derived filename metadata', async () => {
    const validationId = await saveReceipt({ workbookName: 'My Viz' });
    const result = await getToolResult({ validationId });
    expect(result.isError).toBe(false);

    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    expect(call).toMatchObject({
      siteId: 'test-site-id',
      projectId: 'default-project-id',
      name: 'My Viz',
      fileName: 'My Viz.twbx',
      workbookType: 'twbx',
    });
    // The uploaded bytes are byte-for-byte the receipt bytes — nothing was rebuilt.
    expect(Buffer.isBuffer(call.fileContents)).toBe(true);
    expect(new Uint8Array(call.fileContents)).toEqual(RECEIPT_BYTES);
  });

  it('surfaces the /views workbook URL on the card while keeping webpageUrl verbatim', async () => {
    const validationId = await saveReceipt();
    const result = await getToolResult({ validationId });
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    // `url` (the clickable card link) lands on the workbook's Views tab, rebased onto the configured
    // SERVER origin so it's reachable through the same address the client connects with...
    expect(payload.url).toBe('https://my-tableau-server.com/#/workbooks/wb-123/views');
    // ...while the raw server value is preserved verbatim on `webpageUrl`.
    expect(payload.webpageUrl).toBe('https://test.tableau.com/#/workbooks/wb-123');
    expect(payload.appView).toBe('published-workbook-card');
    expect(payload.projectName).toBe('Default');
  });

  it('surfaces the validation package digest for traceability', async () => {
    const validationId = await saveReceipt();
    const result = await getToolResult({ validationId });
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.digest).toBe(RECEIPT_DIGEST);
    expect(payload.validationId).toBe(validationId);
  });

  it('keeps builder warnings from validation visible on the published-workbook card', async () => {
    const validationId = await saveReceipt({
      warnings: ['Asset "data.parquet" may 404 at serve time.'],
    });
    const result = await getToolResult({ validationId });
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.warnings).toEqual(['Asset "data.parquet" may 404 at serve time.']);
  });

  it('sanitizes Windows-illegal chars in the .twbx fileName while keeping the display name verbatim', async () => {
    const validationId = await saveReceipt({ workbookName: 'Q3: Sales/Ops' });
    await getToolResult({ validationId });
    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    expect(call.name).toBe('Q3: Sales/Ops');
    expect(call.fileName).toBe('Q3_ Sales_Ops.twbx');
  });

  it('publishes directly to a project when projectId is given', async () => {
    const validationId = await saveReceipt();
    const result = await getToolResult({ validationId, projectId: 'proj-abc' });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-abc' }),
    );
  });

  it('passes showTabs and overwrite through to the publish call', async () => {
    const validationId = await saveReceipt();
    await getToolResult({ validationId, projectId: 'proj-abc', showTabs: false, overwrite: true });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ showTabs: false, overwrite: true }),
    );
    expect(getAuditEntries()).toHaveLength(1);
    expect(getAuditEntries()[0].data).toMatchObject({ showTabs: false, overwrite: true });
  });

  it('rejects a missing validationId before any REST call', async () => {
    const result = await getToolResult({ validationId: generateOpaqueId() });
    expect(result.isError).toBe(true);
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    expect(getAuditEntries()).toHaveLength(0);
  });

  it('rejects an expired validationId before any REST call', async () => {
    const validationId = await saveReceipt({ ttlMs: -1000 });
    const result = await getToolResult({ validationId });
    expect(result.isError).toBe(true);
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    expect(getAuditEntries()).toHaveLength(0);
  });

  it('rejects a receipt saved under a different actor scope before any REST call', async () => {
    const otherScope = resolveWorkspaceScope({
      transport: 'stdio',
      server: 'https://my-tableau-server.com',
      siteId: 'other-site',
      userId: 'other-user',
    }).unwrap();
    const validationId = await saveReceipt({ scope: otherScope });
    const result = await getToolResult({ validationId });
    expect(result.isError).toBe(true);
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    expect(getAuditEntries()).toHaveLength(0);
  });

  it('rejects the call when no trusted actor scope can be resolved (before REST)', async () => {
    const validationId = await saveReceipt();
    const extra = getMockRequestHandlerExtra();
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { validationId, projectId: undefined, showTabs: undefined, overwrite: undefined },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    expect(getAuditEntries()).toHaveLength(0);
  });

  it('does not modify published bytes when the workspace changes after validation', async () => {
    // A receipt is an immutable snapshot; mutating the (unrelated) workspace store cannot change it.
    const validationId = await saveReceipt({ bytes: RECEIPT_BYTES });
    const workspace = await store.create(SCOPE, {
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
      files: [{ path: 'index.html', content: '<!doctype html><title>hi</title>' }],
    });
    await store.upsertFiles(SCOPE, workspace.appId, [
      { path: 'index.html', content: '<!doctype html><title>CHANGED</title>' },
    ]);

    await getToolResult({ validationId });
    const call = mocks.mockPublishWorkbook.mock.calls[0][0];
    expect(new Uint8Array(call.fileContents)).toEqual(RECEIPT_BYTES);
  });

  it('allows repeated publishes of the same receipt until expiry (reuse policy)', async () => {
    const validationId = await saveReceipt();
    const first = await getToolResult({ validationId, projectId: 'proj-1', overwrite: false });
    const second = await getToolResult({ validationId, projectId: 'proj-2', overwrite: true });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledTimes(2);
    expect(getAuditEntries()).toHaveLength(2);
    // Each call is bound to its own publish-target arguments.
    expect(mocks.mockPublishWorkbook.mock.calls[0][0]).toMatchObject({ projectId: 'proj-1' });
    expect(mocks.mockPublishWorkbook.mock.calls[1][0]).toMatchObject({ projectId: 'proj-2' });
  });

  it('emits a safe publish audit record bound to actor/app/validation/target/outcome', async () => {
    const validationId = await saveReceipt();
    await getToolResult({ validationId, projectId: 'proj-abc', overwrite: true });

    const auditCalls = mocks.mockLog.mock.calls.filter(
      ([entry]) => entry?.logger === 'audit' && entry?.message === 'publish-audit',
    );
    expect(auditCalls).toHaveLength(1);
    const outcome = auditCalls[0][0].data;
    expect(outcome).toMatchObject({
      tool: 'create-and-publish-workbook',
      validationId,
      appId: 'a'.repeat(32),
      digest: RECEIPT_DIGEST,
      projectId: 'proj-abc',
      showTabs: true,
      overwrite: true,
      outcome: 'published',
    });
    // Never leaks bytes/tokens/source content.
    const serialized = JSON.stringify(auditCalls.map(([entry]) => entry));
    expect(serialized).not.toContain('fileContents');
    expect(serialized.toLowerCase()).not.toContain('token');
  });

  it('records a failed audit outcome and surfaces a publish API error', async () => {
    const secret = 'Bearer super-secret-token';
    mocks.mockPublishWorkbook.mockRejectedValue(new Error(`403 Forbidden ${secret}`));
    const validationId = await saveReceipt();
    const result = await getToolResult({ validationId, projectId: 'proj-abc' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/Forbidden/i);

    const audits = getAuditEntries();
    expect(audits).toHaveLength(1);
    expect(audits[0].data).toMatchObject({
      validationId,
      projectId: 'proj-abc',
      showTabs: true,
      overwrite: false,
      outcome: 'failed',
      failureCode: 'publish-workbook-failed',
    });
    expect(JSON.stringify(audits[0])).not.toContain(secret);
    expect(JSON.stringify(audits[0])).not.toContain('403 Forbidden');
  });

  it('records exactly one failed audit when default-project lookup throws', async () => {
    const secret = 'password=do-not-log';
    mocks.mockQueryProjects.mockRejectedValue(new Error(`network failure ${secret}`));
    const validationId = await saveReceipt();

    const result = await getToolResult({ validationId });

    expect(result.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    const audits = getAuditEntries();
    expect(audits).toHaveLength(1);
    expect(audits[0].data).toMatchObject({
      validationId,
      projectId: undefined,
      showTabs: true,
      overwrite: false,
      outcome: 'failed',
      failureCode: 'target-project-query-failed',
    });
    expect(JSON.stringify(audits[0])).not.toContain(secret);
  });

  it('records one bounded audit when REST setup rejects before invoking its callback', async () => {
    const secret = 'Bearer setup-secret-token';
    mocks.mockUseRestApi.mockRejectedValue(new Error(`REST setup failed: ${secret}`));
    const validationId = await saveReceipt();

    const result = await getToolResult({ validationId });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('REST setup failed');
    expect(mocks.mockQueryProjects).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    const audits = getAuditEntries();
    expect(audits).toHaveLength(1);
    expect(audits[0].data).toMatchObject({
      validationId,
      showTabs: true,
      overwrite: false,
      outcome: 'failed',
      failureCode: 'rest-api-setup-failed',
    });
    expect(JSON.stringify(audits[0])).not.toContain(secret);
    expect(JSON.stringify(audits[0])).not.toContain('REST setup failed');
  });

  it('records exactly one failed audit when no default project exists', async () => {
    mocks.mockQueryProjects.mockResolvedValue({ projects: [] });
    const validationId = await saveReceipt();

    const result = await getToolResult({ validationId });

    expect(result.isError).toBe(true);
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
    const audits = getAuditEntries();
    expect(audits).toHaveLength(1);
    expect(audits[0].data).toMatchObject({
      validationId,
      projectId: undefined,
      showTabs: true,
      overwrite: false,
      outcome: 'failed',
      failureCode: 'target-project-not-found',
    });
  });

  it('preserves the original REST failure when durable audit logging throws', async () => {
    mocks.mockPublishWorkbook.mockRejectedValue(new Error('original publish failure'));
    mocks.mockLog.mockImplementation((entry) => {
      if (entry?.logger === 'audit') {
        throw new Error('audit sink unavailable');
      }
    });
    const validationId = await saveReceipt();

    const result = await getToolResult({ validationId, projectId: 'proj-abc' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('original publish failure');
    expect(result.content[0].text).not.toContain('audit sink unavailable');
    expect(getAuditEntries()).toHaveLength(1);
  });
});

function getAuditEntries(): Array<{ data: Record<string, unknown> }> {
  return mocks.mockLog.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry?.logger === 'audit' && entry?.message === 'publish-audit');
}

async function getToolResult(args: {
  validationId: string;
  projectId?: string;
  showTabs?: boolean;
  overwrite?: boolean;
}): Promise<CallToolResult> {
  const tool = getCreateAndPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      validationId: args.validationId,
      projectId: args.projectId,
      showTabs: args.showTabs,
      overwrite: args.overwrite,
    },
    getMockRequestHandlerExtra(),
  );
}
