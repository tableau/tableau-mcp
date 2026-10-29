import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import * as logger from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import FavoritesMethods from '../../../sdks/tableau/methods/favoritesMethods.js';
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

import { getAddFavoriteTool } from './addFavorite.js';

async function invoke(
  args: {
    resourceType: 'workbook' | 'view' | 'datasource' | 'project';
    resourceId: string;
    label: string;
  } = { resourceType: 'workbook' as const, resourceId, label: 'Sales' },
): Promise<CallToolResult> {
  const tool = getAddFavoriteTool(new WebMcpServer());
  return (await Provider.from(tool.callback))(args, getMockRequestHandlerExtra());
}

describe('add-favorite', () => {
  beforeEach(prepare);
  afterEach(() => vi.unstubAllEnvs());

  it('declares Viewer, write annotations and a self-only, LUID-validated schema', async () => {
    const tool = getAddFavoriteTool(new WebMcpServer());
    expect(tool.name).toBe('add-favorite');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    const schema = await Provider.from(tool.paramsSchema);
    expect(Object.keys(schema)).toEqual(['resourceType', 'resourceId', 'label']);
    expect(schema.resourceId.safeParse('../other').success).toBe(false);
    expect(schema.label.safeParse('  ').success).toBe(false);
    expect(schema.resourceType.safeParse('collection').success).toBe(false);
    expect(schema.resourceType.safeParse('flow').success).toBe(false);
  });

  it('derives user identity and writes only the target after the access check', async () => {
    const result = await invoke();
    expect(result.isError).toBe(false);
    expect(mocks.addFavorite).toHaveBeenCalledWith({
      siteId,
      userId,
      resourceType: 'workbook',
      resourceId,
      label: 'Sales',
    });
    expect(mocks.resourceAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addFavorite.mock.invocationCallOrder[0],
    );
    expect(payload(result)).toEqual({ resourceType: 'workbook', resourceId, label: 'Sales' });
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({ disableLogging: true, jwtScopes: ['tableau:favorites:update'] }),
    );
  });

  it.each(['workbook', 'view', 'datasource', 'project'] as const)(
    'supports %s membership through the common verified target path',
    async (resourceType) => {
      const result = await invoke({ resourceType, resourceId, label: 'Sales' });
      expect(result.isError).toBe(false);
      expect(mocks.addFavorite).toHaveBeenCalledWith({
        siteId,
        userId,
        resourceType,
        resourceId,
        label: 'Sales',
      });
    },
  );

  it('ignores any injected userId/siteId and extra fields at the callback boundary', async () => {
    const args = {
      resourceType: 'workbook' as const,
      resourceId,
      label: 'Sales',
      userId: resourceId,
      siteId: 'other-site',
      secret: 'do-not-return',
    };
    const result = await invoke(args);
    expect(mocks.addFavorite).toHaveBeenCalledWith({
      siteId,
      userId,
      resourceType: 'workbook',
      resourceId,
      label: 'Sales',
    });
    expect(JSON.stringify(payload(result))).not.toContain('do-not-return');
  });

  it('rejects denied content before mutation', async () => {
    mocks.resourceAllowed.mockResolvedValue({ allowed: false, message: 'Private metadata' });
    const result = await invoke();
    expect(result.isError).toBe(true);
    expect(mocks.addFavorite).not.toHaveBeenCalled();
    expect(useRestApi).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Private metadata');
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
    mocks.addFavorite.mockImplementation((args) => methods.addFavorite(args));
    try {
      const result = await invoke();
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
      expect(JSON.stringify(result)).toContain('favorite may have changed');
    } finally {
      log.mockRestore();
    }
  });

  it('fails closed on missing or invalid authenticated identity', async () => {
    mocks.identity.userId = '';
    mocks.session.mockResolvedValue(Ok({ site: { id: 'different-site' }, user: { id: userId } }));
    expect((await invoke()).isError).toBe(true);
    expect(mocks.addFavorite).not.toHaveBeenCalled();
    mocks.identity.userId = '../other-user';
    expect((await invoke()).isError).toBe(true);
    expect(mocks.addFavorite).not.toHaveBeenCalled();
  });

  it('preserves server errors without reporting a successful add', async () => {
    mocks.addFavorite.mockRejectedValue(new Error('Fixture add failure'));
    expect((await invoke()).isError).toBe(true);
  });
});
