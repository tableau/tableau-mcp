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
import { getConfirmDeleteWorkbookTool } from './confirmDeleteWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call rather than written to stderr.
vi.mock('../../../logging/logger.js');

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field. A confirmed delete emits two (the
// allowed authorization decision, then the terminal completed/failed outcome); denied paths emit one.
function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

// Convenience for the single-audit-record assertions (denied paths emit exactly one).
function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const records = getAuditRecords();
  expect(records).toHaveLength(1);
  return records[0];
}

// A workbook that has been through the preview phase: carries the pending-deletion tag the confirm
// phase re-fetches and verifies before deleting.
const mockTaggedWorkbook = {
  ...mockWorkbook,
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
};

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockDeleteWorkbook: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsWorkbookAllowed: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        deleteWorkbook: mocks.mockDeleteWorkbook,
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
    isWorkbookAllowed: mocks.mockIsWorkbookAllowed,
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

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

// Establishes the in-iframe human approval that the confirm tool's AppApprovalEvidence verifies.
// The registry is module-scoped and keyed by site+user+tool+target, so we establish with the same
// coordinates the tool resolves: site 'test-site-luid', user 'test-user-luid' (from the mock extra),
// tool 'confirm-delete-workbook', target the workbook id.
async function establishApproval(workbookId: string): Promise<void> {
  const extra = getMockRequestHandlerExtra();
  await new AppApprovalEvidence().establish({
    restApi: {} as never,
    siteId: 'test-site-id',
    target: { id: workbookId, kind: 'workbook' },
    tool: 'confirm-delete-workbook',
    userLuid: extra.getUserLuid(),
  });
}

describe('confirmDeleteWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
    });
    mocks.mockDeleteWorkbook.mockResolvedValue(undefined);
    mocks.mockIsFeatureEnabled.mockReturnValue(true);
  });

  it('creates a tool instance with the app-only confirm name and workbookId param', () => {
    const tool = getConfirmDeleteWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-delete-workbook');
    expect(tool.paramsSchema).toHaveProperty('workbookId');
    // No confirm/tag knobs — the human gesture IS the confirmation.
    expect(tool.paramsSchema).not.toHaveProperty('confirm');
  });

  it('is model-invisible (visibility: ["app"]) so the LLM can never call it', () => {
    const tool = getConfirmDeleteWorkbookTool(new WebMcpServer());
    expect(tool.meta?.ui?.visibility).toEqual(['app']);
    // Mutually exclusive with app — an app-only confirm carries meta, not an AppDetails.
    expect(tool.app).toBeUndefined();
  });

  it('is disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      adminToolsEnabled: false,
    } as ReturnType<typeof getConfig>);
    const tool = getConfirmDeleteWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the mcp-apps feature flag is off', async () => {
    mocks.mockIsFeatureEnabled.mockReturnValue(false);
    const tool = getConfirmDeleteWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('deletes the workbook when a human approval exists AND the tag is present', async () => {
    await establishApproval('wb-1');
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Deleted');
    expect(result.content[0].text).toContain('recycle_bin');
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledWith({
      workbookId: 'wb-1',
      siteId: 'test-site-id',
    });
    // A confirmed delete emits two records: the allowed authorization decision, then the terminal
    // 'completed' outcome once the REST delete succeeds (audit reflects outcome, not just intent).
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['allowed', 'completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.tool === 'confirm-delete-workbook')).toBe(true);
    // The audit surfaces the human-gesture evidence, never a secret.
    expect(records.every((r) => r.confirmationEvidence.kind === 'registry-nonce')).toBe(true);
    expect(records[0].confirmationEvidence.detail).toContain('app-approval');
  });

  it('rejects (no delete) when there was no human approval, even though the tag is present', async () => {
    // No establishApproval() — i.e. the agent tried to invoke confirm directly with no iframe gesture.
    const result = await getToolResult({ workbookId: 'wb-noapproval' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  it('rejects (no delete) when the approval exists but the tag was removed (narrowing check)', async () => {
    await establishApproval('wb-notag');
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook); // live: only 'tag-1', no pending-deletion
    const result = await getToolResult({ workbookId: 'wb-notag' });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    expect(getAuditRecord().result).toBe('denied');
  });

  it('consumes the approval (single-use): a second confirm for the same workbook is rejected', async () => {
    await establishApproval('wb-once');
    const first = await getToolResult({ workbookId: 'wb-once' });
    expect(first.isError).toBe(false);
    vi.mocked(logger.log).mockClear();
    const second = await getToolResult({ workbookId: 'wb-once' });
    expect(second.isError).toBe(true);
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledTimes(1);
  });

  it('fails when the user is not an admin and performs no delete', async () => {
    await establishApproval('wb-1');
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    expect(getAuditRecord().denyReason).toBe('not-admin');
  });

  it('rejects an out-of-scope workbook and performs no delete', async () => {
    await establishApproval('wb-1');
    mocks.mockIsWorkbookAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the workbook with LUID wb-1 is not allowed.',
    });
    const result = await getToolResult({ workbookId: 'wb-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
  });

  // --- Error path on the destructive call ---

  it('surfaces a delete API error and records the terminal failed outcome', async () => {
    await establishApproval('wb-err');
    mocks.mockGetWorkbook.mockResolvedValue({ ...mockTaggedWorkbook, id: 'wb-err' });
    mocks.mockDeleteWorkbook.mockRejectedValue(new Error('Workbook delete failed'));
    const result = await getToolResult({ workbookId: 'wb-err' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Workbook delete failed');
    // An authorized-but-failed delete records the terminal 'failed' outcome (with detail) so the
    // audit trail never claims a deletion that did not happen.
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['allowed', 'failed']);
    const failed = records.find((r) => r.result === 'failed');
    invariant(failed, 'expected a failed audit record');
    expect(failed.failureDetail).toContain('Workbook delete failed');
  });
});

async function getToolResult(args: { workbookId: string }): Promise<CallToolResult> {
  const tool = getConfirmDeleteWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookId: args.workbookId }, getMockRequestHandlerExtra());
}
