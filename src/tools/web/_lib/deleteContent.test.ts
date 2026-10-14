import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import { ContentNotStaleError, StalenessUnverifiedError } from '../../../errors/mcpToolError.js';
import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { auditRecordSchema } from './auditRecord.js';
import { getDeleteContentTool } from './deleteContent.js';
import { AppApprovalEvidence } from './evidence.js';
import { checkContentStillStale } from './stalenessCheck.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call rather than written to stderr.
vi.mock('../../../logging/logger.js');

// The staleness precondition is unit-tested on its own (stalenessCheck.test.ts); here it is a spy so
// each test can say whether Admin Insights still sees the item as stale.
vi.mock('./stalenessCheck.js', () => ({ checkContentStillStale: vi.fn() }));
const mockCheckContentStillStale = vi.mocked(checkContentStillStale);

// Every test runs on a fixed UTC day so the batch tag is deterministic.
const TODAY = '2026-09-25';
const TODAY_TAG = `pending-deletion-${TODAY}`;

function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

const mockTaggedWorkbook = {
  ...mockWorkbook,
  tags: { tag: [{ label: TODAY_TAG }] },
};

const mockDatasource = {
  id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45',
  name: 'Superstore Datasource',
  project: { id: 'cbec32db-a4a2-4308-b5f0-4fc67322f359', name: 'Samples' },
  owner: { id: 'owner-1' },
  tags: { tag: [{ label: 'tag-1' }] },
};

const mockTaggedDatasource = {
  ...mockDatasource,
  tags: { tag: [{ label: TODAY_TAG }] },
};

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockDeleteWorkbook: vi.fn(),
  mockDeleteTagFromWorkbook: vi.fn(),
  mockDeleteTagFromDatasource: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockAddTagsToDatasource: vi.fn(),
  mockDeleteDatasource: vi.fn(),
  mockListExtractRefreshTasks: vi.fn(),
  mockDeleteExtractRefreshTask: vi.fn(),
  mockGraphql: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsWorkbookAllowed: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        addTagsToWorkbook: mocks.mockAddTagsToWorkbook,
        deleteWorkbook: mocks.mockDeleteWorkbook,
        deleteTagFromWorkbook: mocks.mockDeleteTagFromWorkbook,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        addTagsToDatasource: mocks.mockAddTagsToDatasource,
        deleteDatasource: mocks.mockDeleteDatasource,
        deleteTagFromDatasource: mocks.mockDeleteTagFromDatasource,
      },
      tasksMethods: {
        listExtractRefreshTasks: mocks.mockListExtractRefreshTasks,
        deleteExtractRefreshTask: mocks.mockDeleteExtractRefreshTask,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
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
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    pendingDeletionMaxAgeDays: 30,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('deleteContentTool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
    mockCheckContentStillStale.mockResolvedValue(Ok.EMPTY);
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
      siteRole: 'SiteAdministratorCreator',
    });
    mocks.mockAddTagsToWorkbook.mockResolvedValue(undefined);
    mocks.mockAddTagsToDatasource.mockResolvedValue(undefined);
    mocks.mockDeleteWorkbook.mockResolvedValue(undefined);
    mocks.mockDeleteDatasource.mockResolvedValue(undefined);
    mocks.mockDeleteTagFromWorkbook.mockResolvedValue(undefined);
    mocks.mockDeleteTagFromDatasource.mockResolvedValue(undefined);
    // Existence check for the extract-refresh-task branch: default to a list that CONTAINS the task
    // id the task tests exercise, so preview/confirm reach the guard as before.
    mocks.mockListExtractRefreshTasks.mockResolvedValue([{ id: validTaskId }]);
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
    mocks.mockGraphql.mockResolvedValue({ publishedDatasources: [] });
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
  });

  it('exposes the tool name and paramsSchema', async () => {
    const tool = await getDeleteContentTool(new WebMcpServer());
    expect(tool.name).toBe('delete-content');
    expect(tool.paramsSchema).toHaveProperty('action');
    expect(tool.paramsSchema).toHaveProperty('resourceType');
    expect(tool.paramsSchema).toHaveProperty('resourceIds');
    expect(tool.paramsSchema).toHaveProperty('resourceId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('cleanupDate');
    expect(tool.paramsSchema).toHaveProperty('minAgeDays');
    expect(tool.paramsSchema).not.toHaveProperty('tag');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it.each([
    [true, true, false],
    [true, false, true],
    [false, true, true],
  ])(
    'ADMIN_TOOLS_ENABLED=%s, admin-tools flag=%s → disabled=%s',
    async (adminToolsEnabled, flag, disabled) => {
      const { getConfig } = await import('../../../config.js');
      vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled } as ReturnType<
        typeof getConfig
      >);
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => flag && featureName === 'admin-tools',
      );
      const tool = await getDeleteContentTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(disabled);
    },
  );

  it('carries destructive annotations', async () => {
    const tool = await getDeleteContentTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Delete Tableau Content',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  // --- Dispatch: workbook branch ---

  describe('resourceType=workbook', () => {
    it('previews by tagging the workbook and not deleting', async () => {
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('Preview');
      expect(text).toContain(mockWorkbook.name);
      expect(text).toContain(TODAY_TAG);
      // Project-name resolution: mockWorkbook lives in project 'Samples', so the preview names it
      // rather than emitting the old misleading "unknown project" wording.
      expect(text).toContain("in project 'Samples'");
      expect(text).not.toContain('unknown project');
      expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
        workbookId: 'wb-1',
        siteId: 'test-site-id',
        tagLabels: [TODAY_TAG],
      });
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });

    it('names "no project" for a project-less (Personal Space) workbook instead of "unknown project"', async () => {
      // A workbook in a user's Personal Space has NO project element in its REST response (verified
      // live). The preview must phrase that as project-less, not as a lookup failure.
      const { project: _omit, ...projectlessWorkbook } = mockWorkbook;
      mocks.mockGetWorkbook.mockResolvedValue(projectlessWorkbook);
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('in no project (e.g. a Personal Space item)');
      expect(text).not.toContain('unknown project');
    });

    it('deletes when confirm:true and the tag is present', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Deleted workbook');
      expect(result.content[0].text).toContain("in project 'Samples'");
      expect(mocks.mockDeleteWorkbook).toHaveBeenCalledWith({
        workbookId: 'wb-1',
        siteId: 'test-site-id',
      });
    });

    it('blocks confirm when the pending-deletion tag is absent', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });

    it('honors resourceAccessChecker.isWorkbookAllowed=false', async () => {
      mocks.mockIsWorkbookAllowed.mockResolvedValue({
        allowed: false,
        message: 'Querying the workbook with LUID wb-1 is not allowed.',
      });
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not allowed');
      expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
    });

    it('denies non-admin callers', async () => {
      mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('site administrator');
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });
  });

  // --- W-24311035: date-stamped batch tags + staleness re-check ---

  describe('cleanup batches (W-24311035)', () => {
    const OLD_BATCH = '2026-09-20';
    const OLD_TAG = `pending-deletion-${OLD_BATCH}`;

    it('stamps the tag with the UTC date, not the local date', async () => {
      // 23:30 at UTC-7 on Sep 25 is already Sep 26 in UTC.
      vi.setSystemTime(new Date('2026-09-25T23:30:00-07:00'));
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(false);
      expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
        workbookId: 'wb-1',
        siteId: 'test-site-id',
        tagLabels: ['pending-deletion-2026-09-26'],
      });
    });

    it('re-checks staleness on preview with the default threshold and today as the batch', async () => {
      await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(mockCheckContentStillStale).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'workbook',
          resourceId: 'wb-1',
          minAgeDays: 90,
          cleanupDate: TODAY,
        }),
      );
    });

    it('passes a caller-supplied minAgeDays to the staleness check', async () => {
      await getToolResult({ resourceType: 'datasource', resourceId: 'ds-1', minAgeDays: 180 });
      expect(mockCheckContentStillStale).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'datasource', minAgeDays: 180 }),
      );
    });

    it('preview of content that is no longer stale writes NO tag and is audited as denied', async () => {
      mockCheckContentStillStale.mockResolvedValue(
        new ContentNotStaleError(
          'Deletion blocked: workbook wb-1 no longer meets the criteria',
        ).toErr(),
      );
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('no longer meets');
      expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
      const records = getAuditRecords();
      expect(records.map((r) => r.result)).toEqual(['denied']);
      expect(records[0].denyReason).toBe('content-not-stale');
    });

    it('confirm of tagged content that is no longer stale does NOT delete', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
      mockCheckContentStillStale.mockResolvedValue(
        new ContentNotStaleError('Deletion blocked: accessed after the batch date').toErr(),
      );
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
      expect(getAuditRecords().map((r) => r.denyReason)).toEqual(['content-not-stale']);
    });

    it('fails closed when staleness cannot be verified', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
      mockCheckContentStillStale.mockResolvedValue(
        new StalenessUnverifiedError('Deletion blocked: Admin Insights unavailable').toErr(),
      );
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
      expect(getAuditRecords().map((r) => r.denyReason)).toEqual(['staleness-unverified']);
    });

    it("rejects a confirm when the item carries only an EARLIER batch's tag", async () => {
      mocks.mockGetWorkbook.mockResolvedValue({
        ...mockWorkbook,
        tags: { tag: [{ label: OLD_TAG }] },
      });
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(OLD_TAG);
      expect(result.content[0].text).toContain('different cleanup batch');
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
      // Evidence fails first, so the staleness check never runs.
      expect(mockCheckContentStillStale).not.toHaveBeenCalled();
    });

    it('rejects a confirm when the item carries only the legacy undated tag', async () => {
      mocks.mockQueryDatasource.mockResolvedValue({
        ...mockDatasource,
        tags: { tag: [{ label: 'pending-deletion' }] },
      });
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-1',
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    });

    it('rejects a confirm naming a batch the item is not tagged for', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
        cleanupDate: OLD_BATCH,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });

    it('deletes on a later day when the confirm names the batch and the item is still stale', async () => {
      mocks.mockGetWorkbook.mockResolvedValue({
        ...mockWorkbook,
        tags: { tag: [{ label: OLD_TAG }] },
      });
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
        cleanupDate: OLD_BATCH,
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockDeleteWorkbook).toHaveBeenCalledOnce();
      expect(mockCheckContentStillStale).toHaveBeenCalledWith(
        expect.objectContaining({ cleanupDate: OLD_BATCH, minAgeDays: 90 }),
      );
      expect(getAuditRecords().map((r) => r.result)).toEqual(['completed']);
    });

    describe('batch expiry (PENDING_DELETION_MAX_AGE_DAYS)', () => {
      // TODAY is 2026-09-25 and the mocked limit is 30 days.
      const AT_LIMIT = '2026-08-26';
      const EXPIRED = '2026-08-25';

      it('rejects a confirm for a batch past the limit before any REST read or delete', async () => {
        mocks.mockGetWorkbook.mockResolvedValue({
          ...mockWorkbook,
          tags: { tag: [{ label: `pending-deletion-${EXPIRED}` }] },
        });
        const result = await getToolResult({
          resourceType: 'workbook',
          resourceId: 'wb-1',
          confirm: true,
          cleanupDate: EXPIRED,
        });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('31 days old, past the 30-day limit');
        expect(result.content[0].text).toContain('remove-pending-tags');
        expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
        expect(mockCheckContentStillStale).not.toHaveBeenCalled();
        expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
        // Expiry writes nothing: the marker is left for an explicit remove-pending-tags action.
        expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
      });

      it('rejects an expired datasource batch too', async () => {
        const result = await getToolResult({
          resourceType: 'datasource',
          resourceId: 'ds-1',
          confirm: true,
          cleanupDate: EXPIRED,
        });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('past the 30-day limit');
        expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
        expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
      });

      it('still deletes a batch exactly at the limit', async () => {
        mocks.mockGetWorkbook.mockResolvedValue({
          ...mockWorkbook,
          tags: { tag: [{ label: `pending-deletion-${AT_LIMIT}` }] },
        });
        const result = await getToolResult({
          resourceType: 'workbook',
          resourceId: 'wb-1',
          confirm: true,
          cleanupDate: AT_LIMIT,
        });
        expect(result.isError).toBe(false);
        expect(mocks.mockDeleteWorkbook).toHaveBeenCalledOnce();
      });

      it('honors a configured limit', async () => {
        const { getConfig } = await import('../../../config.js');
        const base = vi.mocked(getConfig)();
        vi.mocked(getConfig).mockReturnValue({ ...base, pendingDeletionMaxAgeDays: 3 });
        try {
          mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
          const result = await getToolResult({
            resourceType: 'workbook',
            resourceId: 'wb-1',
            confirm: true,
            cleanupDate: '2026-09-21',
          });
          expect(result.isError).toBe(true);
          invariant(result.content[0].type === 'text');
          expect(result.content[0].text).toContain('past the 3-day limit');
        } finally {
          vi.mocked(getConfig).mockReturnValue(base);
        }
      });

      it('does not apply to a preview (which always opens today)', async () => {
        const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
        expect(result.isError).toBe(false);
        expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledOnce();
      });
    });

    it('rejects a back-dated preview without writing a tag', async () => {
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        cleanupDate: OLD_BATCH,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`today's UTC date (${TODAY})`);
      expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
      expect(mockCheckContentStillStale).not.toHaveBeenCalled();
    });

    it('schema rejects a future or malformed cleanupDate', async () => {
      const tool = await getDeleteContentTool(new WebMcpServer());
      const schema = (await Provider.from(tool.paramsSchema)).cleanupDate;
      expect(schema.safeParse(TODAY).success).toBe(true);
      expect(schema.safeParse(OLD_BATCH).success).toBe(true);
      expect(schema.safeParse('2026-09-26').success).toBe(false);
      expect(schema.safeParse('2026-02-30').success).toBe(false);
      expect(schema.safeParse('25-09-2026').success).toBe(false);
    });

    it('preview names an earlier batch marker already on the item', async () => {
      mocks.mockGetWorkbook.mockResolvedValue({
        ...mockWorkbook,
        tags: { tag: [{ label: OLD_TAG }] },
      });
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-1' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain(TODAY_TAG);
      expect(text).toContain(OLD_TAG);
      expect(text).toContain('earlier cleanup batch');
      expect(text).toContain('remove-pending-tags');
    });

    it('preview tells the caller to confirm with the batch cleanupDate', async () => {
      const result = await getToolResult({ resourceType: 'datasource', resourceId: 'ds-1' });
      invariant(result.content[0].type === 'text');
      // The text result is JSON-encoded, so the quotes may be escaped.
      expect(result.content[0].text).toMatch(new RegExp(`cleanupDate: \\\\?"${TODAY}`));
    });
  });

  // --- Dispatch: datasource branch ---

  describe('resourceType=datasource', () => {
    it('previews by tagging the datasource and reports dependents', async () => {
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-1',
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('Preview');
      expect(text).toContain(mockDatasource.name);
      expect(text).toContain(TODAY_TAG);
      expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
        datasourceId: 'ds-1',
        siteId: 'test-site-id',
        tagLabels: [TODAY_TAG],
      });
      expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
      expect(mocks.mockGraphql).toHaveBeenCalled();
    });

    it('deletes when confirm:true and the tag is present', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-1',
        confirm: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Deleted data source');
      expect(result.content[0].text).toContain("in project 'Samples'");
      expect(mocks.mockDeleteDatasource).toHaveBeenCalledWith({
        datasourceId: 'ds-1',
        siteId: 'test-site-id',
      });
    });

    it('honors resourceAccessChecker.isDatasourceAllowed=false', async () => {
      mocks.mockIsDatasourceAllowed.mockResolvedValue({
        allowed: false,
        message: 'Querying the datasource with LUID ds-1 is not allowed.',
      });
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-1',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not allowed');
      expect(mocks.mockAddTagsToDatasource).not.toHaveBeenCalled();
    });
  });

  // --- Dispatch: extract-refresh-task branch ---

  describe('resourceType=extract-refresh-task', () => {
    it('previews by minting a confirmation token', async () => {
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('Preview');
      expect(text).toMatch(/confirmationToken:\s*\\?"[0-9a-fA-F-]+/);
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('deletes when confirm:true and the confirmationToken is valid', async () => {
      const previewText = await previewAndGetText({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
      });
      const match = previewText.match(
        /confirmationToken:\s*\\?"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
      );
      invariant(match, `expected confirmationToken in preview: ${previewText}`);
      const token = match[1];
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
        confirm: true,
        confirmationToken: token,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('successfully deleted');
      expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        taskId: validTaskId,
      });
    });

    // AC-3 / Gap-B: the audit record's target is enriched with the underlying content's
    // name/project/owner, derived from the task's datasource (the task list carries only the id).
    it('enriches the preview audit target with the underlying datasource name/project/owner', async () => {
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        { id: validTaskId, datasource: { id: mockDatasource.id } },
      ]);
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
      });
      expect(result.isError).toBe(false);
      const record = getAuditRecords()[0];
      expect(record.target.id).toBe(validTaskId);
      expect(record.target.kind).toBe('extract-refresh-task');
      expect(record.target.name).toBe(mockDatasource.name);
      expect(record.target.project).toBe('Samples');
      expect(record.target.owner).toBe('owner@example.com');
    });

    it('enriched confirm audit target carries the underlying content identity', async () => {
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        { id: validTaskId, datasource: { id: mockDatasource.id } },
      ]);
      const previewText = await previewAndGetText({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
      });
      const token = extractToken(previewText);
      (logger.log as MockedFunction<typeof logger.log>).mockClear();

      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
        confirm: true,
        confirmationToken: token,
      });
      expect(result.isError).toBe(false);
      const records = getAuditRecords();
      expect(records.map((r) => r.result)).toEqual(['completed']);
      expect(records[0].target.name).toBe(mockDatasource.name);
      expect(records[0].target.project).toBe('Samples');
      expect(records[0].target.owner).toBe('owner@example.com');
    });

    it('rejects a non-UUID resourceId with a clear error', async () => {
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: 'not-a-uuid',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toMatch(/uuid/i);
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('blocks confirm when confirmationToken is missing', async () => {
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    // --- DEFECT 1 (W-23377934): existence check BEFORE minting a nonce ---
    // The task branch has no single-get endpoint, so it list-and-finds. A taskId absent from the
    // list must 404 WITHOUT the guard minting a confirmationToken — symmetric with the
    // workbook/datasource branches whose resolveTarget reads 404 before any evidence is established.
    // Pre-fix, the branch went straight to guardMutation and returned a preview WITH a token for a
    // nonexistent task; these tests pin the no-token behavior.
    describe('DEFECT-1: nonexistent task', () => {
      it('preview returns not-found and mints NO confirmation token', async () => {
        // Task is genuinely absent from this site (list does not contain validTaskId).
        mocks.mockListExtractRefreshTasks.mockResolvedValue([{ id: 'some-other-task-id' }]);
        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
        });

        // (a) It is an ERROR result carrying the 404 not-found message.
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        const text = result.content[0].text;
        expect(text).toContain('not found');
        expect(text).toContain(validTaskId);

        // (b) NO confirmation token / nonce is minted or returned. The preview success text
        // ('Preview —' + confirmationToken) must NOT appear.
        expect(text).not.toContain('Preview —');
        expect(text).not.toMatch(/confirmationToken/i);

        // (c) No delete call, and — because the branch returns before guardMutation — NO audit
        // record at all was emitted (in particular no 'allowed' for a minted token).
        expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
        expect(getAuditRecords()).toHaveLength(0);
      });

      it('preview on an EMPTY task list returns not-found and no token', async () => {
        mocks.mockListExtractRefreshTasks.mockResolvedValue([]);
        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
        });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('not found');
        expect(result.content[0].text).not.toMatch(/confirmationToken/i);
        expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
        expect(getAuditRecords()).toHaveLength(0);
      });

      it('confirm:true on a task absent from the list returns not-found and never deletes', async () => {
        // A caller who forged/replayed a token against a task that no longer exists is 404'd before
        // the guard runs, so nothing is deleted.
        mocks.mockListExtractRefreshTasks.mockResolvedValue([]);
        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
          confirm: true,
          confirmationToken: 'a1b2c3d4-e5f6-4789-9abc-ef1234567890',
        });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('not found');
        expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
        expect(getAuditRecords()).toHaveLength(0);
      });
    });

    // --- DEFECT 2 (W-23377934): a confirm logs EXACTLY ONE audit record ---
    // The shared guard no longer emits 'allowed' on a confirm; the terminal recordOutcome emit is the
    // sole record. Pre-fix a successful confirm logged ['allowed','completed'].
    describe('DEFECT-2: confirm audit fires exactly once', () => {
      it('preview still emits a single ALLOWED audit record (no regression)', async () => {
        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
        });
        expect(result.isError).toBe(false);
        const records = getAuditRecords();
        expect(records.map((r) => r.result)).toEqual(['allowed']);
        expect(records[0].phase).toBe('preview');
      });

      it('a successful confirm delete emits exactly one COMPLETED record (not allowed+completed)', async () => {
        const previewText = await previewAndGetText({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
        });
        const token = extractToken(previewText);
        // Isolate the confirm phase's audit emissions from the preview's 'allowed' record.
        (logger.log as MockedFunction<typeof logger.log>).mockClear();

        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
          confirm: true,
          confirmationToken: token,
        });
        expect(result.isError).toBe(false);
        expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledOnce();

        const records = getAuditRecords();
        expect(records.map((r) => r.result)).toEqual(['completed']);
        expect(records[0].phase).toBe('confirm');
        expect(records[0].action).toBe('delete');
      });

      it('a failed confirm delete emits exactly one FAILED record (not allowed+failed)', async () => {
        const previewText = await previewAndGetText({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
        });
        const token = extractToken(previewText);
        mocks.mockDeleteExtractRefreshTask.mockRejectedValueOnce(new Error('Resource not found'));
        (logger.log as MockedFunction<typeof logger.log>).mockClear();

        const result = await getToolResult({
          resourceType: 'extract-refresh-task',
          resourceId: validTaskId,
          confirm: true,
          confirmationToken: token,
        });
        expect(result.isError).toBe(true);

        const records = getAuditRecords();
        expect(records.map((r) => r.result)).toEqual(['failed']);
        expect(records[0].phase).toBe('confirm');
        const failed = records[0];
        expect(failed.failureDetail).toContain('Resource not found');
      });
    });
  });

  // --- MCP-Apps flag ON: preview returns LEGACY namespace panel + records approval under legacy ---

  describe('action=remove-pending-tags (W-24199845)', () => {
    const taggedWorkbook = {
      ...mockWorkbook,
      tags: { tag: [{ label: TODAY_TAG }, { label: 'finance' }] },
    };

    async function removeTags(
      overrides: Partial<Parameters<typeof getToolResult>[0]> = {},
    ): Promise<CallToolResult> {
      return await getToolResult({
        action: 'remove-pending-tags',
        resourceType: 'workbook',
        resourceIds: ['wb-1'],
        ...overrides,
      });
    }

    it('removes only the marker tag and deletes nothing', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(taggedWorkbook);
      const result = await removeTags();
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual({
        removedCount: 1,
        items: [{ resourceId: 'wb-1', status: 'removed', removedTags: [TODAY_TAG] }],
      });
      expect(mocks.mockDeleteTagFromWorkbook).toHaveBeenCalledExactlyOnceWith({
        workbookId: 'wb-1',
        siteId: 'test-site-id',
        tagLabel: TODAY_TAG,
      });
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
      expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
    });

    it('routes datasources and honors cleanupDate', async () => {
      mocks.mockQueryDatasource.mockResolvedValue({
        ...mockDatasource,
        tags: { tag: [{ label: 'pending-deletion-2026-09-01' }, { label: TODAY_TAG }] },
      });
      const result = await removeTags({
        resourceType: 'datasource',
        resourceIds: ['ds-1'],
        cleanupDate: '2026-09-01',
      });
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).items[0].removedTags).toEqual([
        'pending-deletion-2026-09-01',
      ]);
      expect(mocks.mockDeleteTagFromDatasource).toHaveBeenCalledTimes(1);
    });

    it('audits the removal under delete-content as an update', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(taggedWorkbook);
      await removeTags();
      expect(getAuditRecords()).toHaveLength(1);
      expect(getAuditRecords()[0]).toMatchObject({
        tool: 'delete-content',
        action: 'update',
        result: 'completed',
      });
    });

    it('is not blocked by the app-renderable confirm-closed gate', async () => {
      mocks.mockGetWorkbook.mockResolvedValue(taggedWorkbook);
      const result = await removeTags({ mcpAppToolsRenderable: true });
      expect(result.isError).toBe(false);
      expect(mocks.mockDeleteTagFromWorkbook).toHaveBeenCalledTimes(1);
    });

    it('denies non-admins before reading any item', async () => {
      mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
      const result = await removeTags();
      expect(result.isError).toBe(true);
      expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
      expect(mocks.mockDeleteTagFromWorkbook).not.toHaveBeenCalled();
    });

    it.each([
      ['confirm: true', { confirm: true }, /confirm/],
      ['confirm: false', { confirm: false }, /confirm/],
      ['resourceId', { resourceId: 'wb-1' }, /resourceId/],
      ['minAgeDays', { minAgeDays: 30 }, /minAgeDays/],
      ['confirmationToken', { confirmationToken: 'tok' }, /confirmationToken/],
    ])('rejects %s instead of ignoring it', async (_name, extra, pattern) => {
      const result = await removeTags(extra);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toMatch(pattern);
      expect(result.content[0].text).toContain('never deletes content');
      expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });

    it('rejects extract-refresh-task and missing resourceIds', async () => {
      const task = await removeTags({ resourceType: 'extract-refresh-task' });
      expect(task.isError).toBe(true);
      invariant(task.content[0].type === 'text');
      expect(task.content[0].text).toContain('carry no tags');

      const none = await removeTags({ resourceIds: undefined });
      expect(none.isError).toBe(true);
      invariant(none.content[0].type === 'text');
      expect(none.content[0].text).toContain('requires resourceIds');
    });

    it('rejects resourceIds on the delete action and a delete with no resourceId', async () => {
      const withIds = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        resourceIds: ['wb-2'],
      });
      expect(withIds.isError).toBe(true);
      const noId = await getToolResult({ resourceType: 'workbook' });
      expect(noId.isError).toBe(true);
      invariant(noId.content[0].type === 'text');
      expect(noId.content[0].text).toContain('requires resourceId');
      expect(mocks.mockAddTagsToWorkbook).not.toHaveBeenCalled();
    });

    it('schema bounds resourceIds', async () => {
      const tool = await getDeleteContentTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      expect(schema.resourceIds.safeParse([]).success).toBe(false);
      expect(
        schema.resourceIds.safeParse(Array.from({ length: 101 }, (_, i) => `id-${i}`)).success,
      ).toBe(false);
      expect(schema.action.safeParse('list-pending-tags').success).toBe(false);
    });
  });

  describe('with mcp-apps flag ON', () => {
    beforeEach(() => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    });

    it('carries the delete-content app config', async () => {
      const tool = await getDeleteContentTool(new WebMcpServer());
      expect(tool.app).toBeDefined();
      expect(tool.app?.resourceUri).toContain('delete-content');
    });

    it('workbook preview returns the LEGACY delete-workbook-confirm panel and records approval under delete-content', async () => {
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-app',
        mcpAppToolsRenderable: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      // LEGACY panel kind so the existing iframe machinery keeps working end-to-end.
      expect(payload.data.kind).toBe('delete-workbook-confirm');
      expect(payload.data.workbookId).toBe('wb-app');
      // The panel carries the batch identity so its confirm/cancel target the same batch.
      expect(payload.data.cleanupDate).toBe(TODAY);
      expect(payload.data.minAgeDays).toBe(90);
      // Approval established under the delete-content namespace.
      const extra = getMockRequestHandlerExtra();
      await expect(
        new AppApprovalEvidence('delete-content').verify({
          restApi: { siteId: 'test-site-id' } as never,
          siteId: 'test-site-id',
          target: { id: 'wb-app', kind: 'workbook' },
          tool: 'delete-content',
          userLuid: extra.getUserLuid(),
        }),
      ).resolves.toBe(true);
    });

    it('datasource preview returns the LEGACY delete-datasource-confirm panel', async () => {
      const result = await getToolResult({
        resourceType: 'datasource',
        resourceId: 'ds-app',
        mcpAppToolsRenderable: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.data.kind).toBe('delete-datasource-confirm');
      expect(payload.data.datasourceId).toBe('ds-app');
      expect(payload.data.cleanupDate).toBe(TODAY);
      expect(payload.data.minAgeDays).toBe(90);
    });

    it('extract-refresh-task preview returns the LEGACY delete-extract-refresh-task-confirm panel', async () => {
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
        mcpAppToolsRenderable: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.data.kind).toBe('delete-extract-refresh-task-confirm');
      expect(payload.data.taskId).toBe(validTaskId);
    });

    it('rejects model-driven confirm:true with a PreviewNotRun error (no self-confirm)', async () => {
      const result = await getToolResult({
        resourceType: 'workbook',
        resourceId: 'wb-1',
        confirm: true,
        mcpAppToolsRenderable: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Mutation blocked');
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });

    // --- DEFECT B (W-24212898): flag ON but the client CANNOT render the app card ---
    // A flag-on-but-app-incapable client is registered as a PLAIN tool, so returning the app-card
    // JSON blob would render as unreadable raw JSON. The preview branch keys on the real render
    // capability (mcpAppToolsRenderable), NOT the flag, so such a client falls through to the readable
    // text preview flow and can still complete a model-visible tag-gated confirm.
    describe('DEFECT-B: app-incapable client (flag ON, not renderable)', () => {
      it('workbook preview returns readable TEXT, not an app-card payload', async () => {
        const result = await getToolResult({
          resourceType: 'workbook',
          resourceId: 'wb-1',
          mcpAppToolsRenderable: false,
        });
        expect(result.isError).toBe(false);
        invariant(result.content[0].type === 'text');
        const text = result.content[0].text;
        // Readable preview prose — NOT a JSON app-card blob.
        expect(text).toContain('Preview');
        expect(text).toContain(TODAY_TAG);
        // Not an app-card payload: no confirm-panel kind marker appears in the readable prose.
        expect(text).not.toContain('delete-workbook-confirm');
      });

      it('workbook confirm succeeds via the model-visible tag gate (no app approval needed)', async () => {
        mocks.mockGetWorkbook.mockResolvedValue(mockTaggedWorkbook);
        const result = await getToolResult({
          resourceType: 'workbook',
          resourceId: 'wb-1',
          confirm: true,
          mcpAppToolsRenderable: false,
        });
        expect(result.isError).toBe(false);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('Deleted workbook');
        expect(mocks.mockDeleteWorkbook).toHaveBeenCalled();
      });
    });
  });
});

async function getToolResult(args: {
  action?: 'delete' | 'remove-pending-tags';
  resourceType: 'workbook' | 'datasource' | 'extract-refresh-task';
  resourceId?: string;
  resourceIds?: string[];
  confirm?: boolean;
  cleanupDate?: string;
  minAgeDays?: number;
  confirmationToken?: string;
  // When true, simulate a client that can ACTUALLY render an MCP-Apps confirm card so the tool takes
  // its app-card branch. Defaults false (plain-tool client → readable text preview flow). The
  // `mcp-apps` feature flag alone no longer selects the app path; this render-capability signal does.
  mcpAppToolsRenderable?: boolean;
}): Promise<CallToolResult> {
  const tool = await getDeleteContentTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      resourceIds: args.resourceIds,
      confirm: args.confirm,
      cleanupDate: args.cleanupDate,
      minAgeDays: args.minAgeDays,
      confirmationToken: args.confirmationToken,
    },
    getMockRequestHandlerExtra({ mcpAppToolsRenderable: args.mcpAppToolsRenderable ?? false }),
  );
}

async function previewAndGetText(args: {
  resourceType: 'workbook' | 'datasource' | 'extract-refresh-task';
  resourceId: string;
}): Promise<string> {
  const preview = await getToolResult(args);
  invariant(!preview.isError, `preview should succeed: ${JSON.stringify(preview)}`);
  invariant(preview.content[0].type === 'text');
  return preview.content[0].text;
}

function extractToken(previewText: string): string {
  const match = previewText.match(
    /confirmationToken:\s*\\?"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
  );
  invariant(match, `expected confirmationToken in preview: ${previewText}`);
  return match[1];
}
