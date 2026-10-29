import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import * as logger from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import FavoritesMethods from '../../../sdks/tableau/methods/favoritesMethods.js';
import ProjectsMethods from '../../../sdks/tableau/methods/projectsMethods.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceId = '11111111-1111-4111-8111-111111111111';
const siteId = 'authenticated-site';

const mocks = vi.hoisted(() => ({
  queryFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  session: vi.fn(),
  resourceAllowed: vi.fn(),
  projects: vi.fn(),
  identity: { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(async ({ callback }) =>
    callback({
      siteId: 'authenticated-site',
      userId: mocks.identity.userId,
      authenticatedServerMethods: { getCurrentServerSession: mocks.session },
      favoritesMethods: {
        queryFavorites: mocks.queryFavorites,
        addFavorite: mocks.addFavorite,
        removeFavorite: mocks.removeFavorite,
      },
      projectsMethods: { queryProjects: mocks.projects },
    }),
  ),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isWorkbookAllowed: mocks.resourceAllowed,
    isViewAllowed: mocks.resourceAllowed,
    isDatasourceAllowed: mocks.resourceAllowed,
    isFlowAllowed: mocks.resourceAllowed,
  },
}));

function prepare(): void {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  stubDefaultEnvVars();
  mocks.identity.userId = userId;
  mocks.session.mockResolvedValue(Ok({ site: { id: siteId }, user: { id: userId } }));
  mocks.resourceAllowed.mockResolvedValue({ allowed: true });
  mocks.projects.mockResolvedValue({
    projects: [{ id: resourceId }],
    pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 1 },
  });
  mocks.queryFavorites.mockResolvedValue({
    favorites: [{ resourceType: 'workbook', resourceId, label: 'Sales' }],
    rawCount: 1,
  });
  mocks.addFavorite.mockResolvedValue(undefined);
  mocks.removeFavorite.mockResolvedValue(undefined);
}

function payload(result: Awaited<ReturnType<typeof invoke>>): Record<string, unknown> {
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text content');
  return JSON.parse(content.text);
}

import { OverridableConfig } from '../../../overridableConfig.js';
import { getListFavoritesTool } from './listFavorites.js';

async function invoke(
  args: { pageNumber?: number; limit?: number } = {},
  config = new OverridableConfig({}),
): Promise<CallToolResult> {
  const tool = getListFavoritesTool(new WebMcpServer());
  return (await Provider.from(tool.callback))(
    { pageNumber: args.pageNumber, limit: args.limit },
    getMockRequestHandlerExtra({ getConfigWithOverrides: vi.fn().mockResolvedValue(config) }),
  );
}

describe('list-favorites', () => {
  beforeEach(prepare);
  afterEach(() => vi.unstubAllEnvs());

  it('declares read-only Viewer and a schema with no user selector', async () => {
    const tool = getListFavoritesTool(new WebMcpServer());
    expect(tool.name).toBe('list-favorites');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    const schema = await Provider.from(tool.paramsSchema);
    expect(Object.keys(schema)).toEqual(['pageNumber', 'limit']);
    expect(schema.pageNumber.safeParse(0).success).toBe(false);
    expect(schema.limit.safeParse(1001).success).toBe(false);
  });

  it('reads only self, projects output fields, and makes completeness unknown without metadata', async () => {
    mocks.queryFavorites.mockResolvedValue({
      favorites: [
        { resourceType: 'workbook', resourceId, label: 'Sales', privateOwner: 'do-not-return' },
      ],
      rawCount: 1,
    });
    const result = await invoke();
    expect(result.isError).toBe(false);
    expect(mocks.queryFavorites).toHaveBeenCalledWith({
      siteId,
      userId,
      pageSize: 1000,
      pageNumber: 1,
    });
    expect(payload(result)).toMatchObject({
      favorites: [{ resourceType: 'workbook', resourceId, label: 'Sales' }],
      pageNumber: 1,
      hasMore: null,
      nextPageNumber: 2,
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({ disableLogging: true, jwtScopes: ['tableau:content:read'] }),
    );
  });

  it('omits denied favorites and labels, while retaining server-page continuation', async () => {
    mocks.resourceAllowed.mockResolvedValue({ allowed: false, message: 'Secret' });
    mocks.queryFavorites.mockResolvedValue({
      favorites: [{ resourceType: 'workbook', resourceId, label: 'Private favorite' }],
      rawCount: 1,
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 1001 },
    });
    const result = await invoke();
    expect(payload(result)).toMatchObject({ favorites: [], hasMore: true, nextPageNumber: 2 });
    expect(JSON.stringify(result)).not.toContain('Private favorite');
    expect(JSON.stringify(result)).not.toContain(resourceId);
    expect(JSON.stringify(result)).not.toContain('1001');
  });

  it('keeps completeness unknown if returned pagination does not match the request', async () => {
    mocks.queryFavorites.mockResolvedValue({
      favorites: [],
      rawCount: 0,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
    });
    expect(payload(await invoke({ pageNumber: 2 }))).toMatchObject({ hasMore: null });
  });

  it('reports a final page only when server metadata supports it', async () => {
    mocks.queryFavorites.mockResolvedValue({
      favorites: [],
      rawCount: 0,
      pagination: { pageNumber: 2, pageSize: 1000, totalAvailable: 1000 },
    });
    expect(payload(await invoke({ pageNumber: 2 }))).toMatchObject({
      favorites: [],
      pageNumber: 2,
      hasMore: false,
    });
    expect(payload(await invoke({ pageNumber: 2 }))).not.toHaveProperty('nextPageNumber');
  });

  it('applies per-page limit after access filtering', async () => {
    mocks.queryFavorites.mockResolvedValue({
      favorites: [
        { resourceType: 'workbook', resourceId, label: 'Denied' },
        { resourceType: 'view', resourceId, label: 'Allowed' },
        { resourceType: 'flow', resourceId, label: 'Extra' },
      ],
      rawCount: 3,
    });
    mocks.resourceAllowed
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValue({ allowed: true });
    expect(payload(await invoke({ limit: 1 })).favorites).toEqual([
      { resourceType: 'view', resourceId, label: 'Allowed' },
    ]);
  });

  it('respects the configured page ceiling before issuing a favorites read', async () => {
    const config = new OverridableConfig({ MAX_RESULT_LIMIT: '1000' });
    expect((await invoke({ pageNumber: 2 }, config)).isError).toBe(true);
    expect(mocks.queryFavorites).not.toHaveBeenCalled();
  });

  it('never exposes malformed raw favorite responses in the tool error or logs', async () => {
    const sentinel = 'PRIVATE_UNBOUNDED_LABEL_SENTINEL';
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const methods = new FavoritesMethods(
      'https://tableau.test/api/3.29',
      { type: 'Bearer', token: 'fixture' },
      {
        adapter: async (config) => ({
          config,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: { favorites: { favorite: sentinel } },
        }),
      },
    );
    mocks.queryFavorites.mockImplementation((args) => methods.queryFavorites(args));
    try {
      const result = await invoke();
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  it('never exposes malformed project visibility responses in the tool error or logs', async () => {
    const sentinel = 'PRIVATE_UNBOUNDED_PROJECT_LABEL_SENTINEL';
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const methods = new ProjectsMethods(
      'https://tableau.test/api/3.29',
      { type: 'Bearer', token: 'fixture' },
      {
        adapter: async (config) => ({
          config,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          data: {
            pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 1 },
            projects: { project: [{ id: resourceId, name: sentinel, owner: 'invalid' }] },
          },
        }),
      },
    );
    mocks.queryFavorites.mockResolvedValue({
      favorites: [{ resourceType: 'project', resourceId, label: 'Allowed target label' }],
      rawCount: 1,
    });
    mocks.projects.mockImplementation((args) => methods.queryProjects(args));
    try {
      const result = await invoke();
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain(
        'The project visibility response could not be validated',
      );
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    } finally {
      log.mockRestore();
    }
  });

  it('fails closed on missing self identity, without listing any favorites', async () => {
    mocks.identity.userId = '';
    mocks.session.mockResolvedValue(Ok({ site: { id: 'different-site' }, user: { id: userId } }));
    expect((await invoke()).isError).toBe(true);
    expect(mocks.queryFavorites).not.toHaveBeenCalled();
  });
});
