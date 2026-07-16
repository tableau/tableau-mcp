import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { auditRecordSchema } from './auditRecord.js';
import { getConfirmDeleteContentTool } from './confirmDeleteContent.js';
import { AppApprovalEvidence, TagEvidence } from './evidence.js';

vi.mock('../../../logging/logger.js');

vi.mock('../users/resolveOwnerEmail.js', () => ({
  resolveOwnerEmail: vi.fn().mockResolvedValue('owner@test.com'),
}));

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field. A confirmed deletion emits exactly one
// terminal record (completed or failed); denied paths also emit exactly one.
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

const validWorkbookId = 'workbook-luid-1234';
const validDatasourceId = 'datasource-luid-5678';
const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';
const testTag = 'test-deletion-tag';

const mocks = vi.hoisted(() => ({
  mockDeleteWorkbook: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockDeleteDatasource: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockDeleteExtractRefreshTask: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockAddTagsToDatasource: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        deleteWorkbook: mocks.mockDeleteWorkbook,
        addTagsToWorkbook: mocks.mockAddTagsToWorkbook,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        deleteDatasource: mocks.mockDeleteDatasource,
        addTagsToDatasource: mocks.mockAddTagsToDatasource,
      },
      tasksMethods: {
        deleteExtractRefreshTask: mocks.mockDeleteExtractRefreshTask,
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

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

// Mirrors what the delete-content preview does for workbook/datasource: records both TagEvidence and
// AppApprovalEvidence bound to the resource being deleted.
async function establishWorkbookApproval(workbookId: string, tag: string = testTag): Promise<void> {
  const tagContext = {
    restApi: {
      workbooksMethods: { addTagsToWorkbook: mocks.mockAddTagsToWorkbook },
    } as never,
    siteId: 'test-site-id',
    target: { id: workbookId, kind: 'workbook' as const },
    tool: 'confirm-delete-content' as const,
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  };
  await new TagEvidence({ tag, kind: 'workbook' }).establish(tagContext);
  await new AppApprovalEvidence('delete-content').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: workbookId, kind: 'workbook' },
    tool: 'confirm-delete-content',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

async function establishDatasourceApproval(
  datasourceId: string,
  tag: string = testTag,
): Promise<void> {
  const tagContext = {
    restApi: {
      datasourcesMethods: { addTagsToDatasource: mocks.mockAddTagsToDatasource },
    } as never,
    siteId: 'test-site-id',
    target: { id: datasourceId, kind: 'datasource' as const },
    tool: 'confirm-delete-content' as const,
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  };
  await new TagEvidence({ tag, kind: 'datasource' }).establish(tagContext);
  await new AppApprovalEvidence('delete-content').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: datasourceId, kind: 'datasource' },
    tool: 'confirm-delete-content',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

async function establishExtractRefreshTaskApproval(taskId: string): Promise<void> {
  await new AppApprovalEvidence('delete-content').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: taskId, kind: 'extract-refresh-task' },
    tool: 'confirm-delete-content',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

describe('confirmDeleteContentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    mocks.mockGetWorkbook.mockResolvedValue({
      id: validWorkbookId,
      name: 'Test Workbook',
      project: { name: 'Test Project' },
      owner: { id: 'owner-123' },
      tags: { tag: [{ label: testTag }] },
    });
    mocks.mockQueryDatasource.mockResolvedValue({
      id: validDatasourceId,
      name: 'Test Datasource',
      project: { name: 'Test Project' },
      owner: { id: 'owner-456' },
      tags: { tag: [{ label: testTag }] },
    });
    mocks.mockDeleteWorkbook.mockResolvedValue(undefined);
    mocks.mockDeleteDatasource.mockResolvedValue(undefined);
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
    mocks.mockAddTagsToWorkbook.mockResolvedValue(undefined);
    mocks.mockAddTagsToDatasource.mockResolvedValue(undefined);
  });

  it('is a model-invisible app-only tool gated on adminToolsEnabled && mcp-apps', () => {
    const tool = getConfirmDeleteContentTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-delete-content');
    expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });
    expect(tool.paramsSchema).toHaveProperty('resourceType');
    expect(tool.paramsSchema).toHaveProperty('resourceId');
    expect(tool.paramsSchema).toHaveProperty('tag');
  });

  it('is disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmDeleteContentTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the mcp-apps flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getConfirmDeleteContentTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  // --- Happy path: workbook deletion with tag + approval ---

  it('deletes the workbook when both TagEvidence and AppApprovalEvidence are established', async () => {
    await establishWorkbookApproval(validWorkbookId);
    const result = await getToolResult({
      resourceType: 'workbook',
      resourceId: validWorkbookId,
      tag: testTag,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Deleted workbook');
    expect(result.content[0].text).toContain('Test Workbook');
    expect(result.content[0].text).toContain(validWorkbookId);
    expect(result.content[0].text).toContain('recycle bin');
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledTimes(1);
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledWith({
      workbookId: validWorkbookId,
      siteId: 'test-site-id',
    });
    // A confirmed deletion emits exactly one record: the terminal 'completed' outcome once the REST
    // delete succeeds (the confirm's authorization is folded into that terminal record).
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.action === 'delete')).toBe(true);
  });

  // --- Missing approval → PreviewNotRunError, no deletion ---

  it('rejects with PreviewNotRunError when no approval was recorded', async () => {
    const result = await getToolResult({
      resourceType: 'workbook',
      resourceId: validWorkbookId,
      tag: testTag,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  // --- Single-use: second confirm with same evidence rejected ---

  it('single-use: deletes once then a replay is rejected', async () => {
    await establishWorkbookApproval(validWorkbookId);
    const first = await getToolResult({
      resourceType: 'workbook',
      resourceId: validWorkbookId,
      tag: testTag,
    });
    expect(first.isError).toBe(false);
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledTimes(1);

    vi.mocked(logger.log).mockClear();
    const second = await getToolResult({
      resourceType: 'workbook',
      resourceId: validWorkbookId,
      tag: testTag,
    });
    expect(second.isError).toBe(true);
    expect(mocks.mockDeleteWorkbook).toHaveBeenCalledTimes(1);
    expect(getAuditRecord().denyReason).toBe('preview-not-run');
  });

  // --- Target-binding: workbook approval cannot confirm datasource deletion ---

  it('rejects when a workbook approval is used to confirm a datasource deletion', async () => {
    await establishWorkbookApproval(validWorkbookId);
    const result = await getToolResult({
      resourceType: 'datasource',
      resourceId: validDatasourceId,
      tag: testTag,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    expect(getAuditRecord().denyReason).toBe('preview-not-run');
  });

  // --- Happy path: datasource deletion ---

  it('deletes the datasource when both TagEvidence and AppApprovalEvidence are established', async () => {
    await establishDatasourceApproval(validDatasourceId);
    const result = await getToolResult({
      resourceType: 'datasource',
      resourceId: validDatasourceId,
      tag: testTag,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Deleted data source');
    expect(result.content[0].text).toContain('Test Datasource');
    expect(result.content[0].text).toContain(validDatasourceId);
    expect(result.content[0].text).toContain('recycle bin');
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledTimes(1);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledWith({
      datasourceId: validDatasourceId,
      siteId: 'test-site-id',
    });
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.action === 'delete')).toBe(true);
  });

  // --- Happy path: extract-refresh-task deletion (no tag, AppApprovalEvidence only) ---

  it('deletes the extract refresh task when AppApprovalEvidence is established', async () => {
    await establishExtractRefreshTaskApproval(validTaskId);
    const result = await getToolResult({
      resourceType: 'extract-refresh-task',
      resourceId: validTaskId,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Extract refresh task');
    expect(result.content[0].text).toContain(validTaskId);
    expect(result.content[0].text).toContain('successfully deleted');
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
    });
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.action === 'delete')).toBe(true);
  });

  // --- Cross-namespace isolation: an update approval must not unlock a delete ---

  it('rejects an approval established under the update-cloud-extract-refresh-task namespace', async () => {
    await new AppApprovalEvidence('update-cloud-extract-refresh-task').establish({
      restApi: { siteId: 'test-site-id' } as never,
      siteId: 'test-site-id',
      target: { id: validTaskId, kind: 'extract-refresh-task' },
      tool: 'update-cloud-extract-refresh-task',
      userLuid: getMockRequestHandlerExtra().getUserLuid(),
    });
    const result = await getToolResult({
      resourceType: 'extract-refresh-task',
      resourceId: validTaskId,
    });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
  });

  // --- Error path: Tableau-structured error surfaced (approval already consumed before the call) ---

  it('surfaces a Tableau 404 error when the deletion fails', async () => {
    await establishWorkbookApproval(validWorkbookId);
    mocks.mockDeleteWorkbook.mockRejectedValue(
      new Error('Tableau 404 [404001]: Resource not found'),
    );
    const result = await getToolResult({
      resourceType: 'workbook',
      resourceId: validWorkbookId,
      tag: testTag,
    });
    expect(result.isError).toBe(true);
    // An authorized-but-failed deletion records the terminal 'failed' outcome (the sole audit record
    // for the confirm) so the audit trail never claims a deletion that did not happen.
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['failed']);
    const failed = records.find((r) => r.result === 'failed');
    invariant(failed, 'expected a failed audit record');
    expect(failed.failureDetail).toContain('Resource not found');
  });
});

async function getToolResult(args: {
  resourceType: 'workbook' | 'datasource' | 'extract-refresh-task';
  resourceId: string;
  tag?: string;
}): Promise<CallToolResult> {
  const tool = getConfirmDeleteContentTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ tag: undefined, ...args }, getMockRequestHandlerExtra());
}
