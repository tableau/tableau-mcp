import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import * as restApiInstance from '../../../restApiInstance.js';
import { AuthConfig } from '../../../sdks/tableau/authConfig.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAddFavoriteTool } from './addFavorite.js';
import { createFavoriteAccessChecker } from './favoriteUtils.js';
import { getRemoveFavoriteTool } from './removeFavorite.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const otherProjectId = '33333333-3333-4333-8333-333333333333';
const siteId = 'authenticated-site';
const resourceTypes = ['workbook', 'view', 'datasource', 'project'] as const;
type ResourceType = (typeof resourceTypes)[number];
type Operation = 'add' | 'remove';

const state = {
  nextSession: 0,
  activeSession: null as number | null,
  targetVisible: true,
  userId,
  events: [] as string[],
  writes: vi.fn(),
};

function target(resourceType: ResourceType): { resourceType: ResourceType; resourceId: string } {
  return { resourceType, resourceId: resourceType === 'project' ? projectId : resourceId };
}

function extra(): ReturnType<typeof getMockRequestHandlerExtra> {
  return getMockRequestHandlerExtra({
    getConfigWithOverrides: vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ INCLUDE_PROJECT_IDS: projectId })),
  });
}

async function invoke(operation: Operation, resourceType: ResourceType): Promise<CallToolResult> {
  const server = new WebMcpServer();
  if (operation === 'add') {
    return (await Provider.from(getAddFavoriteTool(server).callback))(
      { ...target(resourceType), label: 'Sales' },
      extra(),
    );
  }
  return (await Provider.from(getRemoveFavoriteTool(server).callback))(
    target(resourceType),
    extra(),
  );
}

/**
 * Exercise real useRestApi and resourceAccessChecker with only the REST transport mocked.
 * Cloud permits one session per PAT; each fixture sign-in invalidates any preceding session.
 */
describe('favorite mutation PAT lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('AUTH', 'pat');
    exportedForTesting.resetResourceAccessCheckerSingleton();
    state.nextSession = 0;
    state.activeSession = null;
    state.targetVisible = true;
    state.userId = userId;
    state.events.length = 0;
    vi.mocked(RestApi).mockImplementation(() => {
      let session = 0;
      function assertActive(): void {
        if (state.activeSession !== session) throw new Error('Fixture PAT session invalidated');
      }
      async function probe(type: string): Promise<{
        id: string;
        name: string;
        project: { id: string };
      }> {
        assertActive();
        state.events.push(`probe:${type}:${session}`);
        return {
          id: resourceId,
          name: 'Fixture content',
          project: { id: state.targetVisible ? projectId : otherProjectId },
        };
      }
      async function mutate(operation: Operation, args: unknown): Promise<void> {
        assertActive();
        state.events.push(`mutate:${operation}:${session}`);
        state.writes(operation, args);
      }
      return {
        siteId,
        get userId() {
          return state.userId;
        },
        signIn: vi.fn(async (auth: AuthConfig) => {
          expect(auth).toMatchObject({ type: 'pat', siteName: 'tc25' });
          if (state.activeSession !== null) state.events.push(`invalidate:${state.activeSession}`);
          session = ++state.nextSession;
          state.activeSession = session;
          state.events.push(`sign-in:${session}`);
        }),
        signOut: vi.fn(async () => {
          state.events.push(`sign-out:${session}`);
          if (state.activeSession === session) state.activeSession = null;
        }),
        workbooksMethods: { getWorkbook: vi.fn(() => probe('workbook')) },
        viewsMethods: { getView: vi.fn(() => probe('view')) },
        datasourcesMethods: { queryDatasource: vi.fn(() => probe('datasource')) },
        projectsMethods: {
          queryProjects: vi.fn(async () => {
            assertActive();
            state.events.push(`probe:project:${session}`);
            return {
              projects: state.targetVisible ? [{ id: projectId, name: 'Fixture project' }] : [],
              pagination: {
                pageNumber: 1,
                pageSize: 1000,
                totalAvailable: state.targetVisible ? 1 : 0,
              },
            };
          }),
        },
        favoritesMethods: {
          addFavorite: vi.fn((args) => mutate('add', args)),
          removeFavorite: vi.fn((args) => mutate('remove', args)),
        },
      } as unknown as RestApi;
    });
    vi.spyOn(restApiInstance, 'useRestApi');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('the fixture detects the original nested PAT sign-in failure', async () => {
    const context = extra();
    await expect(
      restApiInstance.useRestApi({
        ...context,
        disableLogging: true,
        jwtScopes: ['tableau:favorites:update'],
        callback: async (restApi) => {
          expect((await createFavoriteAccessChecker(context)(target('project'))).unwrap()).toBe(
            true,
          );
          await restApi.favoritesMethods.addFavorite({
            siteId,
            userId,
            ...target('project'),
            label: 'Sales',
          });
        },
      }),
    ).rejects.toThrow('Fixture PAT session invalidated');
    expect(state.events).toContain('invalidate:1');
    expect(state.writes).not.toHaveBeenCalled();
  });

  describe.each(['add', 'remove'] as const)('%s-favorite', (operation) => {
    it.each(resourceTypes)(
      'finishes %s access preflight before opening a fresh mutation session',
      async (resourceType) => {
        const result = await invoke(operation, resourceType);
        expect(result.isError).toBe(false);
        expect(state.events).toEqual([
          'sign-in:1',
          `probe:${resourceType}:1`,
          'sign-out:1',
          'sign-in:2',
          `mutate:${operation}:2`,
          'sign-out:2',
        ]);
        expect(state.writes).toHaveBeenCalledOnce();
        expect(state.writes).toHaveBeenCalledWith(operation, {
          siteId,
          userId,
          ...target(resourceType),
          ...(operation === 'add' && { label: 'Sales' }),
        });
        const calls = vi.mocked(restApiInstance.useRestApi).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[1][0].jwtScopes).toEqual([
          operation === 'add' ? 'tableau:favorites:update' : 'tableau:favorites:delete',
        ]);
        expect(calls[0][0].jwtScopes).toContain('tableau:content:read');
        expect(calls[0][0].config).toBe(calls[1][0].config);
        expect(calls[0][0].signal).toBe(calls[1][0].signal);
        expect(calls[0][0].server).toBe(calls[1][0].server);
        for (const [args] of calls) expect(args.disableLogging).toBe(true);
      },
    );

    it.each(resourceTypes)(
      'does not open a mutation session after denied %s preflight',
      async (resourceType) => {
        state.targetVisible = false;
        expect((await invoke(operation, resourceType)).isError).toBe(true);
        expect(state.events).toEqual(['sign-in:1', `probe:${resourceType}:1`, 'sign-out:1']);
        expect(state.writes).not.toHaveBeenCalled();
        expect(vi.mocked(restApiInstance.useRestApi).mock.calls).toHaveLength(1);
        expect(vi.mocked(restApiInstance.useRestApi).mock.calls[0][0].jwtScopes).not.toContain(
          operation === 'add' ? 'tableau:favorites:update' : 'tableau:favorites:delete',
        );
      },
    );

    it('still fails closed on an invalid authenticated user after a successful preflight', async () => {
      state.userId = '../another-user';
      expect((await invoke(operation, 'project')).isError).toBe(true);
      expect(state.writes).not.toHaveBeenCalled();
      expect(state.events).not.toContain(`mutate:${operation}:2`);
    });
  });
});
