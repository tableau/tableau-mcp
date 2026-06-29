import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';
import { z } from 'zod';

import * as logger from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { DEFAULT_PENDING_DELETION_TAG, getDeleteDatasourceTool } from './deleteDatasource.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call (AC-6) rather than written to stderr.
vi.mock('../../../logging/logger.js');

// Parse the single mutation-audit record emitted on this call through the authoritative schema so
// the assertion fails if the guard ever drops a required field. Returns the validated record.
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

// A data source that has been through the preview phase: carries the pending-deletion tag the
// confirm phase re-fetches and verifies before deleting.
const mockTaggedDatasource = {
  ...mockDatasource,
  tags: { tag: [{ label: DEFAULT_PENDING_DELETION_TAG }] },
};

// Metadata API reverse-lineage response: ds-1 has 1 downstream workbook + 1 flow.
const downstreamResponse = {
  data: {
    publishedDatasourcesConnection: {
      nodes: [
        {
          luid: 'ds-1',
          downstreamWorkbooks: [{ luid: 'wb-9', name: 'Revenue Dashboard' }],
          downstreamFlows: [{ luid: 'flow-3', name: 'Nightly Prep' }],
        },
      ],
    },
  },
};

const noDownstreamResponse = {
  data: {
    publishedDatasourcesConnection: {
      nodes: [{ luid: 'ds-1', downstreamWorkbooks: [], downstreamFlows: [] }],
    },
  },
};

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockAddTagsToDatasource: vi.fn(),
  mockDeleteDatasource: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockGraphql: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        addTagsToDatasource: mocks.mockAddTagsToDatasource,
        deleteDatasource: mocks.mockDeleteDatasource,
      },
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
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

describe('deleteDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
    });
    mocks.mockGraphql.mockResolvedValue(downstreamResponse);
    mocks.mockAddTagsToDatasource.mockResolvedValue(undefined);
    mocks.mockDeleteDatasource.mockResolvedValue(undefined);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDeleteDatasourceTool(new WebMcpServer());
    expect(tool.name).toBe('delete-datasource');
    expect(tool.description).toContain('deletes a published data source');
    expect(tool.paramsSchema).toHaveProperty('datasourceId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
  });

  it('should be disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      adminToolsEnabled: false,
    } as ReturnType<typeof getConfig>);
    const tool = getDeleteDatasourceTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('should have correct annotations for destructive operation', () => {
    const tool = getDeleteDatasourceTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Delete Datasource',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  // --- AuthZ ---

  it('should call assertAdmin before any action', async () => {
    await getToolResult({ datasourceId: 'ds-1' });
    expect(mocks.mockAssertAdmin).toHaveBeenCalled();
  });

  it('should fail when user is not admin and perform no destructive side effects', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
    // The guard resolves the target before the denial so the audit names it, but never tags or deletes.
    expect(mocks.mockAddTagsToDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // AC-6(c): a denied attempt still emits an authoritative audit record with required fields.
  it('should emit a DENIED audit record when the user is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    await getToolResult({ datasourceId: 'ds-1', confirm: true });
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
    expect(record.tool).toBe('delete-datasource');
    expect(record.action).toBe('delete');
    expect(record.target.id).toBe('ds-1');
  });

  // --- Tool scoping (bounded context) ---

  it('should reject preview when the datasource is out of scope and perform no side effects', async () => {
    mocks.mockIsDatasourceAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the datasource with LUID ds-1 is not allowed.',
    });
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockAddTagsToDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should reject delete when the datasource is out of scope and perform no side effects', async () => {
    mocks.mockIsDatasourceAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the datasource with LUID ds-1 is not allowed.',
    });
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // --- Server-authoritative pending-deletion tag gate ---

  it('should block delete when the datasource is not tagged pending-deletion (bypass closed)', async () => {
    // A caller that jumps straight to confirm: true without previewing. The live re-fetch returns a
    // datasource with no pending-deletion tag, so the destructive path must be rejected. This proves
    // the caller-computable-token bypass is closed: there is no value a caller can supply to delete.
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource); // tags: {}
    const result = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // The guard rejects with the server-authoritative "preview not run" message and explains the
    // gate cannot be bypassed by computing a token.
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(result.content[0].text).toContain('cannot be bypassed by computing a token');
    // Re-fetched to verify state, but never deleted.
    expect(mocks.mockQueryDatasource).toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    // AC-6(c): the rejected confirm is audited as denied/preview-not-run.
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
    expect(record.phase).toBe('confirm');
  });

  it('should verify the tag with a fresh live re-fetch, not the access-check cached content', async () => {
    // The access check may hand back a stale cached datasource; the gate must NOT trust it. Cached
    // content carries the tag, but the authoritative live re-fetch does not → delete is blocked.
    mocks.mockIsDatasourceAllowed.mockResolvedValue({
      allowed: true,
      content: mockTaggedDatasource,
    });
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource); // live: untagged
    const result = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(result.isError).toBe(true);
    expect(mocks.mockQueryDatasource).toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should surface a re-fetch error on confirm and not delete', async () => {
    mocks.mockQueryDatasource.mockRejectedValue(new Error('Datasource not found'));
    const result = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // Match loosely so the test asserts the error is surfaced, not the exact upstream wording.
    expect(result.content[0].text).toMatch(/not found/i);
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // --- Preview phase + dependency warning ---

  it('should warn about dependent workbooks and flows on preview', async () => {
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('Preview');
    expect(text).toContain(mockDatasource.name);
    expect(text).toContain('owner@example.com');
    expect(text).toContain(DEFAULT_PENDING_DELETION_TAG);
    // Dependency warning surfaces counts + names.
    expect(text).toContain('WARNING');
    expect(text).toContain('Revenue Dashboard');
    expect(text).toContain('Nightly Prep');

    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
      tagLabels: [DEFAULT_PENDING_DELETION_TAG],
    });
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should report no dependents when none exist', async () => {
    mocks.mockGraphql.mockResolvedValue(noDownstreamResponse);
    const result = await getToolResult({ datasourceId: 'ds-1' });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No workbooks or flows');
    expect(result.content[0].text).not.toContain('WARNING');
  });

  it('should degrade gracefully when the Metadata API errors', async () => {
    mocks.mockGraphql.mockRejectedValue(new Error('metadata boom'));
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Dependency check unavailable');
    // Preview still tags + does not delete.
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should use a caller-provided tag on preview', async () => {
    const result = await getToolResult({ datasourceId: 'ds-1', tag: 'stale-pending-deletion' });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('stale-pending-deletion');
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
      tagLabels: ['stale-pending-deletion'],
    });
  });

  it('should reject a tag that exceeds the schema length cap', () => {
    const tool = getDeleteDatasourceTool(new WebMcpServer());
    const tagSchema = (tool.paramsSchema as { tag: z.ZodOptional<z.ZodString> }).tag;
    expect(tagSchema.safeParse('a'.repeat(200)).success).toBe(true);
    expect(tagSchema.safeParse('a'.repeat(201)).success).toBe(false);
  });

  it('should reject a tag with characters outside the safe class (prompt-injection guard)', () => {
    const tool = getDeleteDatasourceTool(new WebMcpServer());
    const tagSchema = (tool.paramsSchema as { tag: z.ZodOptional<z.ZodString> }).tag;
    // Allowed: letters, numbers, spaces, underscores, dashes.
    expect(tagSchema.safeParse('stale pending-deletion_2024').success).toBe(true);
    // The tag is interpolated into model-facing preview text; quotes/backticks/newlines that
    // could coerce auto-confirming must be rejected at the schema boundary.
    expect(tagSchema.safeParse('pending"; confirm: true').success).toBe(false);
    expect(tagSchema.safeParse('pending`delete`').success).toBe(false);
    expect(tagSchema.safeParse('pending\ndelete').success).toBe(false);
  });

  it('should fall back to the default tag when the caller passes an empty or whitespace tag', async () => {
    const result = await getToolResult({ datasourceId: 'ds-1', tag: '   ' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(DEFAULT_PENDING_DELETION_TAG);
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalledWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
      tagLabels: [DEFAULT_PENDING_DELETION_TAG],
    });
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should still preview when owner cannot be resolved', async () => {
    mocks.mockQueryUserOnSite.mockRejectedValue(new Error('owner lookup failed'));
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('owner unknown');
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // --- Delete phase ---

  it('should delete the datasource when confirm is true and it is tagged pending-deletion', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('Deleted');
    expect(text).toContain(mockDatasource.name);
    expect(text).toContain('recycle_bin');
    expect(mocks.mockDeleteDatasource).toHaveBeenCalledWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
    });
    // No tagging or dependency check on the confirmed delete.
    expect(mocks.mockAddTagsToDatasource).not.toHaveBeenCalled();
    expect(mocks.mockGraphql).not.toHaveBeenCalled();
    // AC-6(c): the allowed confirm emits an allowed audit with the tag evidence descriptor.
    const record = getAuditRecord();
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('confirm');
    expect(record.denyReason).toBeUndefined();
    expect(record.confirmationEvidence.kind).toBe('tag');
  });

  it('should verify a caller-provided tag on confirm', async () => {
    // The delete is gated on the same custom tag the caller previewed with.
    mocks.mockQueryDatasource.mockResolvedValue({
      ...mockDatasource,
      tags: { tag: [{ label: 'stale-pending-deletion' }] },
    });
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      tag: 'stale-pending-deletion',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalled();
  });

  it('should block confirm when the resource carries a different tag than the one requested', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource); // default tag only
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      tag: 'some-other-tag',
    });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should wire the tool-mapped API scopes into useRestApi', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
    await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
    });
    // Pin the scopes the tool requests so drift in toolScopeMap['delete-datasource'].api
    // (a removed or added scope) fails here instead of silently shipping. Order-independent:
    // requiredApiScopes derives from a Set, whose iteration order is not part of the contract.
    const jwtScopes = vi.mocked(useRestApi).mock.calls[0][0].jwtScopes;
    expect([...jwtScopes].sort()).toEqual(
      [
        'tableau:datasources:delete',
        'tableau:datasource_tags:update',
        'tableau:content:read',
        'tableau:mcp_site_settings:read',
        'tableau:users:read',
      ].sort(),
    );
  });

  it('should reuse the datasource from the access check and not query it again', async () => {
    // When tool scoping (project/tag) forces the access check to fetch the datasource, it returns
    // it as `content` so the tool does not query it a second time. Mirrors delete-workbook.
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true, content: mockDatasource });
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(mockDatasource.name);
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
  });

  it('should cap the dependent name list and report the remaining count', async () => {
    // 12 downstream workbooks → only the first 10 names listed, plus "…and 2 more". The total
    // count (12) is still reported so nothing is silently hidden.
    const workbooks = Array.from({ length: 12 }, (_, i) => ({
      luid: `wb-${i}`,
      name: `Workbook ${i}`,
    }));
    mocks.mockGraphql.mockResolvedValue({
      data: {
        publishedDatasourcesConnection: {
          nodes: [{ luid: 'ds-1', downstreamWorkbooks: workbooks, downstreamFlows: [] }],
        },
      },
    });
    const result = await getToolResult({ datasourceId: 'ds-1' });
    invariant(result.content[0].type === 'text');
    const text = result.content[0].text;
    expect(text).toContain('12 workbook(s)');
    expect(text).toContain('Workbook 0');
    expect(text).toContain('Workbook 9');
    expect(text).not.toContain('Workbook 10');
    expect(text).toContain('…and 2 more');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Datasource delete failed';
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);
    mocks.mockDeleteDatasource.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  // --- AC-6: end-to-end preview→confirm + audit on the in-scope tool ---

  it('AC-6(a): rejects a forged/precomputed confirm (no prior preview) and does not delete', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(mockDatasource); // live: untagged
    const result = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
    expect(getAuditRecord().result).toBe('denied');
  });

  it('AC-6(b): preview then confirm happy path deletes and audits both phases', async () => {
    // Preview: tags the datasource (establishes evidence) and audits an allowed preview.
    const preview = await getToolResult({ datasourceId: 'ds-1' });
    expect(preview.isError).toBe(false);
    expect(mocks.mockAddTagsToDatasource).toHaveBeenCalled();
    const previewRecord = getAuditRecord();
    expect(previewRecord.result).toBe('allowed');
    expect(previewRecord.phase).toBe('preview');

    // Reset the spy so the confirm-phase audit is isolated; simulate the tag now being present.
    vi.mocked(logger.log).mockClear();
    mocks.mockQueryDatasource.mockResolvedValue(mockTaggedDatasource);

    // Confirm: verifies the tag against live state and deletes.
    const confirm = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(confirm.isError).toBe(false);
    expect(mocks.mockDeleteDatasource).toHaveBeenCalled();
    const confirmRecord = getAuditRecord();
    expect(confirmRecord.result).toBe('allowed');
    expect(confirmRecord.phase).toBe('confirm');
  });

  it('AC-6(c): preview emits an allowed audit naming the datasource', async () => {
    await getToolResult({ datasourceId: 'ds-1' });
    const record = getAuditRecord();
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('preview');
    expect(record.target.id).toBe('ds-1');
    expect(record.confirmationEvidence.kind).toBe('tag');
  });
});

async function getToolResult(args: {
  datasourceId: string;
  confirm?: boolean;
  tag?: string;
}): Promise<CallToolResult> {
  const tool = getDeleteDatasourceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasourceId: args.datasourceId,
      confirm: args.confirm,
      tag: args.tag,
    },
    getMockRequestHandlerExtra(),
  );
}
