import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { useRestApi } from '../../../restApiInstance.js';
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

import { getRemoveFavoriteTool } from './removeFavorite.js';

async function invoke(
  args: { resourceType: 'workbook' | 'view' | 'datasource' | 'project'; resourceId: string } = {
    resourceType: 'workbook' as const,
    resourceId,
  },
): Promise<CallToolResult> {
  const tool = getRemoveFavoriteTool(new WebMcpServer());
  return (await Provider.from(tool.callback))(args, getMockRequestHandlerExtra());
}

describe('remove-favorite', () => {
  beforeEach(prepare);
  afterEach(() => vi.unstubAllEnvs());

  it('declares membership deletion, Viewer and a self-only schema', async () => {
    const tool = getRemoveFavoriteTool(new WebMcpServer());
    expect(tool.name).toBe('remove-favorite');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(Object.keys(await Provider.from(tool.paramsSchema))).toEqual([
      'resourceType',
      'resourceId',
    ]);
    expect(await Provider.from(tool.description)).toContain('content itself is never deleted');
  });

  it('removes membership only after target access verification', async () => {
    const result = await invoke();
    expect(result.isError).toBe(false);
    expect(mocks.removeFavorite).toHaveBeenCalledWith({
      siteId,
      userId,
      resourceType: 'workbook',
      resourceId,
    });
    expect(mocks.resourceAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeFavorite.mock.invocationCallOrder[0],
    );
    expect(mocks.addFavorite).not.toHaveBeenCalled();
    expect(payload(result)).toEqual({
      resourceType: 'workbook',
      resourceId,
      removedFromFavorites: true,
    });
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({ disableLogging: true, jwtScopes: ['tableau:favorites:delete'] }),
    );
  });

  it.each(['workbook', 'view', 'datasource', 'project'] as const)(
    'supports %s membership through the common verified target path',
    async (resourceType) => {
      const result = await invoke({ resourceType, resourceId });
      expect(result.isError).toBe(false);
      expect(mocks.removeFavorite).toHaveBeenCalledWith({
        siteId,
        userId,
        resourceType,
        resourceId,
      });
    },
  );

  it('cannot substitute a different user/site or echo arbitrary fields', async () => {
    const args = {
      resourceType: 'workbook' as const,
      resourceId,
      userId: resourceId,
      siteId: 'other-site',
      secret: 'do-not-return',
    };
    const result = await invoke(args);
    expect(mocks.removeFavorite).toHaveBeenCalledWith({
      siteId,
      userId,
      resourceType: 'workbook',
      resourceId,
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });

  it('does not remove an excluded favorite', async () => {
    mocks.resourceAllowed.mockResolvedValue({ allowed: false });
    expect((await invoke()).isError).toBe(true);
    expect(mocks.removeFavorite).not.toHaveBeenCalled();
    expect(useRestApi).not.toHaveBeenCalled();
  });

  it('fails closed before mutation if self identity cannot be resolved', async () => {
    mocks.identity.userId = '';
    mocks.session.mockResolvedValue(Ok({ site: { id: siteId }, user: { id: '' } }));
    expect((await invoke()).isError).toBe(true);
    expect(mocks.removeFavorite).not.toHaveBeenCalled();
  });

  it('preserves a server not-found failure rather than treating every 404 as success', async () => {
    mocks.removeFavorite.mockRejectedValue(new Error('404 fixture content missing'));
    expect((await invoke()).isError).toBe(true);
  });
  it('returns the curated identity error without sending a removal', async () => {
    mocks.identity.userId = '../other-user';
    const result = await invoke();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'The authenticated Tableau user ID is unavailable or invalid.' },
    ]);
    expect(mocks.removeFavorite).not.toHaveBeenCalled();
  });
});
