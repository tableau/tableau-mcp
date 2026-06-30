import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { AppApprovalEvidence, DEFAULT_PENDING_DELETION_TAG } from '../_lib/evidence.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getConfirmDeleteDatasourceTool } from './confirmDeleteDatasource.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call rather than written to stderr.
vi.mock('../../../logging/logger.js');

function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const log = logger.log as MockedFunction<typeof logger.log>;
  const auditEntries = log.mock.calls.map((c) => c[0]).filter((e) => e.logger === 'audit');
  expect(auditEntries).toHaveLength(1);
  return auditRecordSchema.parse(auditEntries[0].data);
}

const mockDatasource = {
  id: 'ds-1',
  name: 'Sales Extract',
  project: { id: 'proj-1', name: 'Finance' },
  owner: { id: 'owner-1' },
  tags: {},
};

// A data source through the preview phase: carries the pending-deletion tag the confirm phase
// re-fetches and verifies before deleting.
const mockTaggedDatasource = {
  ...mockDatasource,
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
};

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockDeleteDatasource: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/featureGate.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        deleteDatasource: mocks.mockDeleteDatasource,
      },
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

// Records a genuine in-iframe human approval in the module-scoped AppApprovalEvidence cache under the
// SAME namespace ('delete-datasource') and key (site+user+target) the preview tool would establish —
// so the confirm tool's verify finds it. userLuid mirrors getMockRequestHandlerExtra().getUserLuid().
async function establishApproval(datasourceId: string): Promise<void> {
  await new AppApprovalEvidence('delete-datasource').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: datasourceId, kind: 'datasource' },
    tool: 'confirm-delete-datasource',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

describe('confirmDeleteDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    // Default: tag PRESENT (the preview ran) so the tag half of AllEvidence passes; tests that need a
    // missing tag override this.
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
    });
    mocks.mockDeleteDatasource.mockResolvedValue(undefined);
    // The confirm tool is gated on mcp-apps ON (+ admin); registration tests flip this.
    mocks.mockIsFeatureEnabled.mockReturnValue(true);
  });

  it('is a model-invisible app-only tool gated on adminToolsEnabled && mcp-apps', () => {
    const tool = getConfirmDeleteDatasourceTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-delete-datasource');
    expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });
    expect(tool.paramsSchema).toHaveProperty('datasourceId');
    expect(tool.annotations).toEqual({
      title: 'Confirm Delete Datasource',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('is disabled when admin tools are not enabled (even with mcp-apps ON)', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmDeleteDatasourceTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the mcp-apps flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockReturnValue(false);
    const tool = getConfirmDeleteDatasourceTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  // --- Happy path: tag present + approval present → deletes once ---

  it('deletes the datasource when the tag is present AND a human approval was recorded', async () => {
    await establishApproval('ds-1');
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('Deleted');
    expect(text).toContain(mockDatasource.name);
    expect(text).toContain('recycle_bin');
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledTimes(1);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
    });
    const record = getAuditRecord();
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('confirm');
    // AllEvidence surfaces the registry-nonce (human-gesture) descriptor for the audit.
    expect(record.confirmationEvidence.kind).toBe('registry-nonce');
  });

  // --- Missing approval → PreviewNotRunError, no delete ---

  it('rejects with PreviewNotRunError when no human approval was recorded (tag alone is not enough)', async () => {
    // Tag is present (default) but NO approval established → AllEvidence fails on the approval half.
    const result = await getToolResult({ datasourceId: 'ds-no-approval' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(result.content[0].text).toContain('cannot be bypassed by computing a token');
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  // --- Missing tag → rejected, no delete (even with a fresh approval) ---

  it('rejects when the live datasource is no longer tagged pending-deletion (approval alone is not enough)', async () => {
    await establishApproval('ds-1');
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource); // live: untagged
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(true);
    expect(mocks.mockQueryDatasource).toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    expect(getAuditRecord().result).toBe('denied');
  });

  // --- Single-use: a consumed approval cannot delete twice ---

  it('single-use: a recorded approval deletes once, then a replay is rejected', async () => {
    await establishApproval('ds-1');
    const first = await getToolResult({ datasourceId: 'ds-1' });
    expect(first.isError).toBe(false);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledTimes(1);

    vi.mocked(logger.log).mockClear();
    const second = await getToolResult({ datasourceId: 'ds-1' });
    expect(second.isError).toBe(true);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledTimes(1);
  });

  // --- AuthZ: admin gate ---

  it('rejects and performs no delete when the user is not an admin', async () => {
    await establishApproval('ds-1');
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
  });

  // --- resourceAccessChecker denies → not-allowed, no mutation ---

  it('rejects when the datasource is out of bounded scope and performs no delete', async () => {
    mocks.mockIsDatasourceAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the datasource with LUID ds-1 is not allowed.',
    });
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // --- Error path on the destructive call ---

  it('surfaces a delete API error and does not mask it', async () => {
    await establishApproval('ds-err');
    mocks.mockDeleteDatasource.mockRejectedValue(new Error('Datasource delete failed'));
    const result = await getToolResult({ datasourceId: 'ds-err' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Datasource delete failed');
  });
});

async function getToolResult(args: { datasourceId: string }): Promise<CallToolResult> {
  const tool = getConfirmDeleteDatasourceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ datasourceId: args.datasourceId }, getMockRequestHandlerExtra());
}
