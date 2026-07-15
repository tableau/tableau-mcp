import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { auditRecordSchema } from './auditRecord.js';
import { getDeleteContentTool } from './deleteContent.js';
import { AppApprovalEvidence, DEFAULT_PENDING_DELETION_TAG } from './evidence.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call rather than written to stderr.
vi.mock('../../../logging/logger.js');

function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

const mockTaggedWorkbook = {
  ...mockWorkbook,
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
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
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
};

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockAddTagsToWorkbook: vi.fn(),
  mockDeleteWorkbook: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockAddTagsToDatasource: vi.fn(),
  mockDeleteDatasource: vi.fn(),
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
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        addTagsToDatasource: mocks.mockAddTagsToDatasource,
        deleteDatasource: mocks.mockDeleteDatasource,
      },
      tasksMethods: {
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
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('deleteContentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
    mocks.mockGraphql.mockResolvedValue({ publishedDatasources: [] });
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
  });

  it('exposes the tool name and paramsSchema', async () => {
    const tool = await getDeleteContentTool(new WebMcpServer());
    expect(tool.name).toBe('delete-content');
    expect(tool.paramsSchema).toHaveProperty('resourceType');
    expect(tool.paramsSchema).toHaveProperty('resourceId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('tag');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it('is disabled when adminToolsEnabled is false', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      adminToolsEnabled: false,
    } as ReturnType<typeof getConfig>);
    const tool = await getDeleteContentTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

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
      expect(text).toContain(DEFAULT_PENDING_DELETION_TAG);
      expect(mocks.mockAddTagsToWorkbook).toHaveBeenCalledWith({
        workbookId: 'wb-1',
        siteId: 'test-site-id',
        tagLabels: [DEFAULT_PENDING_DELETION_TAG],
      });
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
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
      expect(text).toContain(DEFAULT_PENDING_DELETION_TAG);
      expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
        datasourceId: 'ds-1',
        siteId: 'test-site-id',
        tagLabels: [DEFAULT_PENDING_DELETION_TAG],
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
  });

  // --- MCP-Apps flag ON: preview returns LEGACY namespace panel + records approval under legacy ---

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
      const result = await getToolResult({ resourceType: 'workbook', resourceId: 'wb-app' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      // LEGACY panel kind so the existing iframe machinery keeps working end-to-end.
      expect(payload.data.kind).toBe('delete-workbook-confirm');
      expect(payload.data.workbookId).toBe('wb-app');
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
      const result = await getToolResult({ resourceType: 'datasource', resourceId: 'ds-app' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.data.kind).toBe('delete-datasource-confirm');
      expect(payload.data.datasourceId).toBe('ds-app');
    });

    it('extract-refresh-task preview returns the LEGACY delete-extract-refresh-task-confirm panel', async () => {
      const result = await getToolResult({
        resourceType: 'extract-refresh-task',
        resourceId: validTaskId,
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
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Mutation blocked');
      expect(mocks.mockDeleteWorkbook).not.toHaveBeenCalled();
    });
  });
});

async function getToolResult(args: {
  resourceType: 'workbook' | 'datasource' | 'extract-refresh-task';
  resourceId: string;
  confirm?: boolean;
  tag?: string;
  confirmationToken?: string;
}): Promise<CallToolResult> {
  const tool = await getDeleteContentTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      confirm: args.confirm,
      tag: args.tag,
      confirmationToken: args.confirmationToken,
    },
    getMockRequestHandlerExtra(),
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

// silence unused: getAuditRecords wired up in case future tests want to assert audit rows.
void getAuditRecords;
