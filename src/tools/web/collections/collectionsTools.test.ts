import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getTableauServerInfo } from '../../../getTableauServerInfo.js';
import { useRestApi } from '../../../restApiInstance.js';
import fixtures from '../../../sdks/tableau/fixtures/collections.json';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getRequiredApiScopesForTool } from '../../../server/oauth/scopes.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolGroups } from '../toolName.js';
import { webToolFactories } from '../tools.js';
import { getAddCollectionItemsTool } from './addCollectionItems.js';
import { getCreateCollectionTool } from './createCollection.js';
import { getListCollectionItemsTool } from './listCollectionItems.js';
import { getListCollectionsTool } from './listCollections.js';
import { getRemoveCollectionItemsTool } from './removeCollectionItems.js';

const mocks = vi.hoisted(() => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  listCollectionItems: vi.fn(),
  getCollection: vi.fn(),
  queryCollectionOwner: vi.fn(),
  addCollectionItems: vi.fn(),
  removeCollectionItems: vi.fn(),
  getCurrentServerSession: vi.fn(),
  isWorkbookAllowed: vi.fn(),
  isViewAllowed: vi.fn(),
  isDatasourceAllowed: vi.fn(),
  isFlowAllowed: vi.fn(),
  userId: '55555555-5555-4555-8555-555555555555',
  siteId: '66666666-6666-4666-8666-666666666666',
  serverOrigin: 'https://my-tableau-server.com',
}));
vi.mock('../../../getTableauServerInfo.js', () => ({ getTableauServerInfo: vi.fn() }));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      collectionsMethods: mocks,
      collectionPermissionsMethods: mocks,
      serverOrigin: mocks.serverOrigin,
      authenticatedServerMethods: mocks,
      userId: mocks.userId,
      siteId: mocks.siteId,
    }),
  ),
}));
vi.mock('../resourceAccessChecker.js', () => ({ resourceAccessChecker: mocks }));

const collectionId = fixtures.create.luid;
const member = {
  contentLuid: '22222222-2222-4222-8222-222222222222',
  contentType: 'workbook',
  contentName: 'Sales',
};
const factories = [
  getListCollectionsTool,
  getCreateCollectionTool,
  getListCollectionItemsTool,
  getAddCollectionItemsTool,
  getRemoveCollectionItemsTool,
];

async function call<S extends z.ZodRawShape>(
  tool: WebTool<S>,
  args: z.infer<z.ZodObject<S>>,
): Promise<CallToolResult> {
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
function payload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text content');
  return JSON.parse(content.text);
}
function message(result: CallToolResult): string {
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text content');
  return content.text;
}

describe('Collections web tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.mocked(getTableauServerInfo).mockResolvedValue({
      restApiVersion: '3.29',
      productVersion: { value: '2026.2.0', build: 'release' },
    });
    mocks.userId = fixtures.create.userId;
    mocks.siteId = fixtures.create.siteId;
    mocks.serverOrigin = 'https://my-tableau-server.com';
    mocks.listCollections.mockResolvedValue(fixtures.page);
    mocks.createCollection.mockResolvedValue(fixtures.create);
    mocks.listCollectionItems.mockResolvedValue(fixtures.itemsPage);
    mocks.getCollection.mockResolvedValue({ collection: fixtures.create });
    mocks.queryCollectionOwner.mockResolvedValue({ collectionId, ownerId: fixtures.create.userId });
    mocks.addCollectionItems.mockResolvedValue({ response: 1 });
    mocks.removeCollectionItems.mockResolvedValue({ response: 1 });
    mocks.getCurrentServerSession.mockResolvedValue(
      new Ok({ user: { id: mocks.userId }, site: { id: mocks.siteId } }),
    );
    for (const check of [
      mocks.isWorkbookAllowed,
      mocks.isViewAllowed,
      mocks.isDatasourceAllowed,
      mocks.isFlowAllowed,
    ])
      check.mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('registers all five factories, group members, roles and annotations', async () => {
    const server = new WebMcpServer();
    expect(webToolGroups.collections).toEqual([
      'list-collections',
      'create-collection',
      'list-collection-items',
      'add-collection-items',
      'remove-collection-items',
    ]);
    for (const factory of factories) {
      expect(webToolFactories).toContain(factory);
      const tool = factory(server);
      expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
      expect(await Provider.from(tool.annotations)).toMatchObject({
        openWorldHint: false,
        readOnlyHint: tool.name.startsWith('list-'),
        destructiveHint: tool.name === 'remove-collection-items',
      });
    }
  });
  it('declares collection scopes without source-content delete scope', () => {
    expect(getRequiredApiScopesForTool('create-collection')).toEqual([
      'tableau:collections:create',
    ]);
    expect(getRequiredApiScopesForTool('list-collections')).toEqual([
      'tableau:collections:read',
      'tableau:mcp_site_settings:read',
    ]);
    for (const name of ['add-collection-items', 'remove-collection-items'] as const) {
      const scopes = getRequiredApiScopesForTool(name);
      expect(scopes).toEqual(
        expect.arrayContaining([
          'tableau:collections:read',
          'tableau:collections:update',
          'tableau:permissions:read',
          'tableau:content:read',
          'tableau:mcp_site_settings:read',
        ]),
      );
      expect(scopes.some((scope) => scope.endsWith(':delete'))).toBe(false);
    }
  });
  it('lists a single page and retains moreItems, errors and raw count', async () => {
    const result = await call(getListCollectionsTool(new WebMcpServer()), {
      pageNumber: 1,
      pageSize: 100,
      filter: 'favorite:eq:true',
      sort: 'name:asc',
    });
    expect(result.isError).toBe(false);
    expect(payload(result)).toMatchObject({
      moreItems: true,
      totalCount: 2,
      resultInfo: { completeness: 'unverified', pageMetadataMatchesRequest: true },
    });
    expect(mocks.listCollections).toHaveBeenCalledOnce();
    expect(mocks.listCollections).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 100,
      filter: 'favorite:eq:true',
      sort: 'name:asc',
    });
    // A cache miss may issue a separate site-settings probe before this primary read.
    expect(useRestApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:collections:read'] }),
    );
  });
  it('marks ignored or contradictory pagination incomplete without fetching again', async () => {
    mocks.listCollections.mockResolvedValue({ ...fixtures.page, totalCount: 3 });
    const result = payload(
      await call(getListCollectionsTool(new WebMcpServer()), { pageNumber: 2, pageSize: 100 }),
    );
    expect(result.resultInfo).toMatchObject({
      completeness: 'unverified',
      pageMetadataMatchesRequest: false,
    });
    expect(JSON.stringify(result)).toContain('disagree');
    expect(mocks.listCollections).toHaveBeenCalledOnce();
  });
  it('preserves an empty page with unverified metadata', async () => {
    mocks.listCollections.mockResolvedValue(fixtures.emptyPage);
    expect(payload(await call(getListCollectionsTool(new WebMcpServer()), {}))).toMatchObject({
      items: [],
      moreItems: false,
      resultInfo: { pageMetadataMatchesRequest: false },
    });
  });
  it('does not claim an omitted items array proves an empty inventory', async () => {
    mocks.listCollections.mockResolvedValue({ moreItems: false });
    expect(
      JSON.stringify(payload(await call(getListCollectionsTool(new WebMcpServer()), {}))),
    ).toContain('omitted items');
  });
  it('retains numeric item identity without returning invented content LUIDs', async () => {
    const result = payload(
      await call(getListCollectionItemsTool(new WebMcpServer()), { collectionId }),
    );
    expect(result.items).toEqual(fixtures.itemsPage.items);
    expect(JSON.stringify(result)).not.toContain('contentLuid');
    expect(useRestApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:collections:read'] }),
    );
  });
  it.each([
    'INCLUDE_PROJECT_IDS',
    'INCLUDE_WORKBOOK_IDS',
    'INCLUDE_DATASOURCE_IDS',
    'INCLUDE_VIEW_IDS',
    'INCLUDE_TAGS',
  ])('refuses both listings under %s before requests', async (variable) => {
    vi.stubEnv(variable, variable === 'INCLUDE_TAGS' ? 'Sales' : member.contentLuid);
    for (const result of [
      await call(getListCollectionsTool(new WebMcpServer()), {}),
      await call(getListCollectionItemsTool(new WebMcpServer()), { collectionId }),
    ]) {
      expect(result.isError).toBe(true);
      expect(message(result)).toContain('numeric internal IDs');
    }
    expect(mocks.listCollections).not.toHaveBeenCalled();
    expect(mocks.listCollectionItems).not.toHaveBeenCalled();
  });
  it('enforces configured list result ceilings before fetching out-of-range pages', async () => {
    vi.stubEnv('MAX_RESULT_LIMIT', '1');
    expect(
      payload(await call(getListCollectionsTool(new WebMcpServer()), { pageSize: 100 })).items,
    ).toHaveLength(1);
    expect(
      (await call(getListCollectionsTool(new WebMcpServer()), { pageNumber: 2, pageSize: 100 }))
        .isError,
    ).toBe(true);
    expect(mocks.listCollections).toHaveBeenCalledOnce();
  });
  it('rejects invalid filters before fetching', async () => {
    const result = await call(getListCollectionsTool(new WebMcpServer()), {
      filter: 'name:eq:Sales',
    });
    expect(result.isError).toBe(true);
    expect(mocks.listCollections).not.toHaveBeenCalled();
  });
  it('creates an empty direct collection and returns the actual duplicate-suffixed name', async () => {
    const result = payload(
      await call(getCreateCollectionTool(new WebMcpServer()), {
        name: 'Quarterly review',
        description: 'Details',
      }),
    );
    expect(result.name).toBe('Quarterly review (2)');
    expect(mocks.createCollection).toHaveBeenCalledWith({
      name: 'Quarterly review',
      description: 'Details',
    });
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:collections:create'] }),
    );
  });
  it('warns of possible creation when no usable LUID is returned', async () => {
    mocks.createCollection.mockResolvedValue({ name: 'Created' });
    const result = await call(getCreateCollectionTool(new WebMcpServer()), { name: 'Review' });
    expect(result.isError).toBe(true);
    expect(message(result)).toContain('Creation may have occurred');
  });
  it('permits empty container creation under content bounds', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', member.contentLuid);
    expect(
      (await call(getCreateCollectionTool(new WebMcpServer()), { name: 'Review' })).isError,
    ).toBe(false);
  });
  it.each(['add', 'remove'] as const)(
    'checks every supported member and ownership before %s',
    async (action) => {
      const items = ['workbook', 'view', 'datasource'].map((contentType) => ({
        ...member,
        contentType,
      }));
      const operation = action === 'add' ? mocks.addCollectionItems : mocks.removeCollectionItems;
      operation.mockResolvedValue({ response: 3 });
      const tool =
        action === 'add'
          ? getAddCollectionItemsTool(new WebMcpServer())
          : getRemoveCollectionItemsTool(new WebMcpServer());
      const result = payload(await call(tool, { collectionId, items }));
      expect(result.status).toBe('completed');
      expect(mocks.isWorkbookAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ workbookId: member.contentLuid }),
      );
      expect(mocks.isViewAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ viewId: member.contentLuid }),
      );
      expect(mocks.isDatasourceAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceLuid: member.contentLuid }),
      );
      expect(mocks.getCollection).toHaveBeenCalledWith(collectionId);
      expect(operation).toHaveBeenCalledWith({ collectionId, items });
      expect(mocks.getCollection.mock.invocationCallOrder[0]).toBeLessThan(
        operation.mock.invocationCallOrder[0],
      );
      expect(useRestApi).toHaveBeenCalledWith(
        expect.objectContaining({
          jwtScopes: ['tableau:collections:read', 'tableau:collections:update'],
        }),
      );
    },
  );
  it('refuses the whole batch if any member check fails', async () => {
    mocks.isViewAllowed.mockResolvedValue({ allowed: false, message: 'Outside allowed project' });
    const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
      collectionId,
      items: [member, { ...member, contentType: 'view' }],
    });
    expect(result.isError).toBe(true);
    expect(message(result)).toContain('could not be verified');
    expect(message(result)).not.toContain('Outside allowed project');
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    expect(mocks.getCollection).not.toHaveBeenCalled();
  });
  it('rejects duplicate batch targets before any authorization or ownership probe', async () => {
    const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
      collectionId,
      items: [member, { ...member }],
    });
    expect(result.isError).toBe(true);
    expect(mocks.isWorkbookAllowed).not.toHaveBeenCalled();
    expect(mocks.getCollection).not.toHaveBeenCalled();
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
  });
  it('rejects unknown content types under bounds', async () => {
    vi.stubEnv('INCLUDE_TAGS', 'Sales');
    const result = await call(getRemoveCollectionItemsTool(new WebMcpServer()), {
      collectionId,
      items: [{ ...member, contentType: 'UnknownType' }],
    });
    expect(result.isError).toBe(true);
    expect(mocks.removeCollectionItems).not.toHaveBeenCalled();
  });
  it('allows a server-specific nonblank type without inventing official casing under no bounds', async () => {
    expect(
      (
        await call(getAddCollectionItemsTool(new WebMcpServer()), {
          collectionId,
          items: [{ ...member, contentType: 'ServerSpecificType' }],
        })
      ).isError,
    ).toBe(false);
  });
  it.each(['different-owner', 'missing-owner', 'wrong-site', 'missing-luid', 'errors'])(
    'rejects %s before mutation',
    async (scenario) => {
      const collection: Record<string, unknown> = { ...fixtures.create };
      if (scenario === 'different-owner') collection.userId = member.contentLuid;
      if (scenario === 'missing-owner') delete collection.userId;
      if (scenario === 'wrong-site') collection.siteId = member.contentLuid;
      if (scenario === 'missing-luid') delete collection.luid;
      mocks.getCollection.mockResolvedValue({
        collection,
        ...(scenario === 'errors' ? { errors: [{}] } : {}),
      });
      const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [member],
      });
      expect(result.isError).toBe(true);
      expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    },
  );
  it('resolves missing signed-in user from a same-site current session', async () => {
    mocks.userId = '';
    expect(
      (await call(getAddCollectionItemsTool(new WebMcpServer()), { collectionId, items: [member] }))
        .isError,
    ).toBe(false);
    // Each independent owner-read/mutation session rechecks identity at entry and after the read.
    expect(mocks.getCurrentServerSession).toHaveBeenCalledTimes(4);
  });
  it('rejects a wrong-site identity fallback', async () => {
    mocks.userId = '';
    mocks.getCurrentServerSession.mockResolvedValue(
      new Ok({ user: { id: fixtures.create.userId }, site: { id: member.contentLuid } }),
    );
    expect(
      (await call(getAddCollectionItemsTool(new WebMcpServer()), { collectionId, items: [member] }))
        .isError,
    ).toBe(true);
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
  });
  it('rejects unresolved identity fallback', async () => {
    mocks.userId = '';
    mocks.getCurrentServerSession.mockResolvedValue(
      new Err({ type: 'unauthorized', message: 'Synthetic failure' }),
    );
    expect(
      (await call(getAddCollectionItemsTool(new WebMcpServer()), { collectionId, items: [member] }))
        .isError,
    ).toBe(true);
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
  });
  it('preserves partial HTTP 200 errors and never retries the batch', async () => {
    mocks.addCollectionItems.mockResolvedValue(fixtures.partial);
    const result = payload(
      await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [
          member,
          {
            ...member,
            contentLuid: fixtures.partial.errors[0].erroredItem.contentLuid,
            contentType: 'view',
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      response: 1,
      errors: fixtures.partial.errors,
      requestedItemCount: 2,
      status: 'partial-failure',
    });
    expect(mocks.addCollectionItems).toHaveBeenCalledOnce();
  });
  it.each([{}, { response: 0 }, { response: 2 }, { response: -1 }])(
    'does not claim complete success for ambiguous counts %s',
    async (response) => {
      mocks.removeCollectionItems.mockResolvedValue(response);
      expect(
        payload(
          await call(getRemoveCollectionItemsTool(new WebMcpServer()), {
            collectionId,
            items: [member],
          }),
        ).status,
      ).toBe('unverified');
    },
  );
  it('refuses unsupported deployments before any Collections call', async () => {
    vi.mocked(getTableauServerInfo).mockResolvedValue({
      restApiVersion: '3.28',
      productVersion: { value: '2026.1.0', build: 'release' },
    });
    expect((await call(getListCollectionsTool(new WebMcpServer()), {})).isError).toBe(true);
    expect(
      (await call(getCreateCollectionTool(new WebMcpServer()), { name: 'Review' })).isError,
    ).toBe(true);
    expect(
      (await call(getAddCollectionItemsTool(new WebMcpServer()), { collectionId, items: [member] }))
        .isError,
    ).toBe(true);
    expect(mocks.listCollections).not.toHaveBeenCalled();
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
  });
  it('preserves a permission failure rather than relabeling it unsupported', async () => {
    mocks.listCollections.mockRejectedValue(new Error('Synthetic permission failure'));
    const result = await call(getListCollectionsTool(new WebMcpServer()), {});
    expect(result.isError).toBe(true);
    expect(message(result)).toContain('Synthetic permission failure');
    expect(message(result)).not.toContain('version-unsupported');
  });

  it.each(['add', 'remove'] as const)(
    'verifies numeric aliases through an isolated permission read before %s',
    async (action) => {
      mocks.getCollection.mockResolvedValue({
        collection: { ...fixtures.create, siteId: '7', userId: '42' },
      });
      const tool =
        action === 'add'
          ? getAddCollectionItemsTool(new WebMcpServer())
          : getRemoveCollectionItemsTool(new WebMcpServer());
      const result = await call(tool, { collectionId, items: [member] });
      expect(result.isError).not.toBe(true);
      expect(payload(result).status).toBe('completed');
      expect(mocks.queryCollectionOwner).toHaveBeenCalledExactlyOnceWith({
        siteId: fixtures.create.siteId,
        collectionId,
      });
      const mutation = action === 'add' ? mocks.addCollectionItems : mocks.removeCollectionItems;
      expect(mocks.queryCollectionOwner.mock.invocationCallOrder[0]).toBeLessThan(
        mutation.mock.invocationCallOrder[0],
      );
      expect(mocks.getCollection).toHaveBeenCalledTimes(2);
      expect(useRestApi).toHaveBeenCalledWith(
        expect.objectContaining({ jwtScopes: ['tableau:permissions:read'], disableLogging: true }),
      );
    },
  );

  it.each(['owner', 'collection'] as const)(
    'refuses a different permission-proof %s without a batch',
    async (field) => {
      mocks.getCollection.mockResolvedValue({
        collection: { ...fixtures.create, siteId: '7', userId: '42' },
      });
      mocks.queryCollectionOwner.mockResolvedValue({
        collectionId: field === 'collection' ? member.contentLuid : collectionId,
        ownerId: field === 'owner' ? member.contentLuid : fixtures.create.userId,
      });
      const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [member],
      });
      expect(result.isError).toBe(true);
      expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    },
  );

  it.each(['siteId', 'userId', 'serverOrigin'] as const)(
    'refuses a changed %s between owner proof and mutation',
    async (field) => {
      mocks.getCollection.mockResolvedValue({
        collection: { ...fixtures.create, siteId: '7', userId: '42' },
      });
      mocks.queryCollectionOwner.mockImplementationOnce(async () => {
        mocks[field] = field === 'serverOrigin' ? 'https://other-tableau.test' : member.contentLuid;
        return { collectionId, ownerId: fixtures.create.userId };
      });
      const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [member],
      });
      expect(result.isError).toBe(true);
      expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    },
  );

  it.each(['siteId', 'userId', 'serverOrigin'] as const)(
    'refuses a changed %s before requesting the permission proof',
    async (field) => {
      mocks.getCollection.mockImplementationOnce(async () => {
        mocks[field] = field === 'serverOrigin' ? 'https://other-tableau.test' : member.contentLuid;
        return { collection: { ...fixtures.create, siteId: '7', userId: '42' } };
      });
      const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [member],
      });
      expect(result.isError).toBe(true);
      expect(mocks.queryCollectionOwner).not.toHaveBeenCalled();
      expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    },
  );

  it.each(['siteId', 'userId'] as const)(
    'refuses mixed numeric/UUID %s without a permission fallback',
    async (field) => {
      mocks.getCollection.mockResolvedValue({ collection: { ...fixtures.create, [field]: '42' } });
      const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
        collectionId,
        items: [member],
      });
      expect(result.isError).toBe(true);
      expect(mocks.queryCollectionOwner).not.toHaveBeenCalled();
      expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    },
  );

  it('withholds failed proof details and never retries a batch', async () => {
    mocks.getCollection.mockResolvedValue({
      collection: { ...fixtures.create, siteId: '7', userId: '42' },
    });
    mocks.queryCollectionOwner.mockRejectedValueOnce(new Error('PRIVATE_PERMISSION_GRANTS'));
    const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
      collectionId,
      items: [member],
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PERMISSION_GRANTS');
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
    expect(mocks.queryCollectionOwner).toHaveBeenCalledOnce();
  });

  it('refuses owner metadata changed before the mutation session', async () => {
    mocks.getCollection
      .mockResolvedValueOnce({ collection: { ...fixtures.create, siteId: '7', userId: '42' } })
      .mockResolvedValueOnce({ collection: { ...fixtures.create, siteId: '7', userId: '43' } });
    const result = await call(getAddCollectionItemsTool(new WebMcpServer()), {
      collectionId,
      items: [member],
    });
    expect(result.isError).toBe(true);
    expect(mocks.addCollectionItems).not.toHaveBeenCalled();
  });
});
