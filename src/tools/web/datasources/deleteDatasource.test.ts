import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  computeConfirmationToken,
  DEFAULT_PENDING_DELETION_TAG,
  getDeleteDatasourceTool,
} from './deleteDatasource.js';

const TEST_SITE_ID = 'test-site-id';
const validToken = (datasourceId: string): string =>
  computeConfirmationToken(TEST_SITE_ID, datasourceId);

const mockDatasource = {
  id: 'ds-1',
  name: 'Sales Extract',
  project: { id: 'proj-1', name: 'Finance' },
  owner: { id: 'owner-1' },
  tags: {},
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

  it('should fail when user is not admin and perform no side effects', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      confirmationToken: validToken('ds-1'),
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockAddTagsToDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
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
      confirmationToken: validToken('ds-1'),
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed');
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  // --- Confirmation token gate ---

  it('should return a confirmation token on preview', async () => {
    const result = await getToolResult({ datasourceId: 'ds-1' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(validToken('ds-1'));
  });

  it('should reject delete when confirmationToken is missing', async () => {
    const result = await getToolResult({ datasourceId: 'ds-1', confirm: true });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('confirmationToken');
    expect(mocks.mockDeleteDatasource).not.toHaveBeenCalled();
  });

  it('should reject a token computed for a different datasource', async () => {
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      confirmationToken: validToken('ds-OTHER'),
    });
    expect(result.isError).toBe(true);
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

  it('should delete the datasource when confirm is true and report its identity', async () => {
    const result = await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      confirmationToken: validToken('ds-1'),
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
  });

  it('should wire the tool-mapped API scopes into useRestApi', async () => {
    await getToolResult({
      datasourceId: 'ds-1',
      confirm: true,
      confirmationToken: validToken('ds-1'),
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
        'tableau:users:read',
      ].sort(),
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Datasource not found';
    mocks.mockDeleteDatasource.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      datasourceId: 'nonexistent',
      confirm: true,
      confirmationToken: validToken('nonexistent'),
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(args: {
  datasourceId: string;
  confirm?: boolean;
  confirmationToken?: string;
  tag?: string;
}): Promise<CallToolResult> {
  const tool = getDeleteDatasourceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasourceId: args.datasourceId,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
      tag: args.tag,
    },
    getMockRequestHandlerExtra(),
  );
}
