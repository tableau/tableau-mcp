import { AxiosError } from 'axios';
import { Err, Ok } from 'ts-results-es';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { FavoriteResourceType } from '../../../sdks/tableau/types/favorite.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { exportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { createFavoriteAccessChecker, getAuthenticatedFavoriteUserId } from './favoriteUtils.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const resourceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  getWorkbook: vi.fn(),
  getView: vi.fn(),
  queryDatasource: vi.fn(),
  queryFlow: vi.fn(),
  queryProjects: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(async ({ callback }) =>
    callback({
      siteId: 'site',
      workbooksMethods: { getWorkbook: mocks.getWorkbook },
      viewsMethods: { getView: mocks.getView },
      datasourcesMethods: { queryDatasource: mocks.queryDatasource },
      flowsMethods: { queryFlow: mocks.queryFlow },
      projectsMethods: { queryProjects: mocks.queryProjects },
    }),
  ),
}));

function access(
  config: Record<string, string> = {},
): (target: Parameters<ReturnType<typeof createFavoriteAccessChecker>>[0]) => Promise<boolean> {
  const checker = createFavoriteAccessChecker(
    getMockRequestHandlerExtra({
      getConfigWithOverrides: vi.fn().mockResolvedValue(new OverridableConfig(config)),
    }),
  );
  return async (target) => (await checker(target)).unwrap();
}

function authenticatedRest(
  user = userId,
  session = Ok({ site: { id: 'site' }, user: { id: userId } }),
): RestApi {
  const rest = new RestApi({ maxRequestTimeoutMs: 1000 });
  Object.defineProperties(rest, {
    siteId: { value: 'site' },
    userId: { value: user },
    authenticatedServerMethods: {
      value: { getCurrentServerSession: vi.fn().mockResolvedValue(session) },
    },
  });
  return rest;
}

describe('favorite identity and bounded access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    exportedForTesting.resetResourceAccessCheckerSingleton();
    const content = {
      id: resourceId,
      name: 'Content',
      project: { id: projectId },
      workbook: { id: otherId },
      tags: { tag: [{ label: 'Sales' }] },
    };
    mocks.getWorkbook.mockResolvedValue(content);
    mocks.getView.mockResolvedValue(content);
    mocks.queryDatasource.mockResolvedValue(content);
    mocks.queryFlow.mockResolvedValue({ flow: content, outputSteps: [] });
    mocks.queryProjects.mockResolvedValue({
      projects: [{ id: projectId }],
      pagination: { pageSize: 1000, pageNumber: 1, totalAvailable: 1 },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the authenticated REST identity without an arbitrary-user lookup', async () => {
    const rest = authenticatedRest();
    expect(await getAuthenticatedFavoriteUserId(rest)).toEqual(Ok(userId));
    expect(rest.authenticatedServerMethods.getCurrentServerSession).not.toHaveBeenCalled();
  });

  it('resolves a missing bearer user ID from the current session only on the same site', async () => {
    const rest = authenticatedRest('');
    expect(await getAuthenticatedFavoriteUserId(rest)).toEqual(Ok(userId));
    expect(rest.authenticatedServerMethods.getCurrentServerSession).toHaveBeenCalledOnce();
    const mismatch = authenticatedRest(
      '',
      Ok({ site: { id: 'another-site' }, user: { id: userId } }),
    );
    expect((await getAuthenticatedFavoriteUserId(mismatch)).unwrapErr()).toBeInstanceOf(
      ArgsValidationError,
    );
  });

  it('fails closed if session lookup fails or its user ID is missing/unsafe', async () => {
    for (const id of ['', '../other', 'not-a-luid']) {
      const result = await getAuthenticatedFavoriteUserId(
        authenticatedRest('', Ok({ site: { id: 'site' }, user: { id } })),
      );
      expect(result.unwrapErr()).toBeInstanceOf(ArgsValidationError);
      expect(result.unwrapErr().getErrorText()).toBe(
        'Could not resolve the authenticated Tableau user on this site. Favorites require a verified user ID.',
      );
    }
    const rest = authenticatedRest('');
    vi.mocked(rest.authenticatedServerMethods.getCurrentServerSession).mockResolvedValue(
      Err({ type: 'unauthorized', message: 'Do not expose this external payload' }),
    );
    expect((await getAuthenticatedFavoriteUserId(rest)).unwrapErr().getErrorText()).toBe(
      'Could not resolve the authenticated Tableau user on this site. Favorites require a verified user ID.',
    );
  });

  it.each(['workbook', 'view', 'datasource'] as FavoriteResourceType[])(
    'enforces project and tag gates on %s favorites',
    async (resourceType) => {
      expect(
        await access({ INCLUDE_PROJECT_IDS: projectId, INCLUDE_TAGS: 'Sales' })({
          resourceType,
          resourceId,
        }),
      ).toBe(true);
      expect(await access({ INCLUDE_PROJECT_IDS: otherId })({ resourceType, resourceId })).toBe(
        false,
      );
      expect(await access({ INCLUDE_TAGS: 'Other' })({ resourceType, resourceId })).toBe(false);
    },
  );

  it.each([
    ['workbook', 'INCLUDE_WORKBOOK_IDS'],
    ['view', 'INCLUDE_VIEW_IDS'],
    ['datasource', 'INCLUDE_DATASOURCE_IDS'],
  ] as const)(
    'rejects excluded %s LUIDs before resource lookup',
    async (resourceType, variable) => {
      expect(await access({ [variable]: otherId })({ resourceType, resourceId })).toBe(false);
      expect(mocks.getWorkbook).not.toHaveBeenCalled();
      expect(mocks.getView).not.toHaveBeenCalled();
      expect(mocks.queryDatasource).not.toHaveBeenCalled();
    },
  );

  it('suppresses raw REST payload notifications on bounded-context resource probes', async () => {
    await access({ INCLUDE_PROJECT_IDS: projectId })({ resourceType: 'workbook', resourceId });
    await access({ INCLUDE_PROJECT_IDS: projectId })({ resourceType: 'view', resourceId });
    await access({ INCLUDE_PROJECT_IDS: projectId })({ resourceType: 'datasource', resourceId });
    await access({ INCLUDE_PROJECT_IDS: projectId })({
      resourceType: 'project',
      resourceId: projectId,
    });
    expect(vi.mocked(useRestApi).mock.calls.length).toBeGreaterThanOrEqual(4);
    for (const [args] of vi.mocked(useRestApi).mock.calls) expect(args.disableLogging).toBe(true);
  });

  it('applies view parent-workbook restrictions', async () => {
    expect(
      await access({ INCLUDE_WORKBOOK_IDS: otherId })({ resourceType: 'view', resourceId }),
    ).toBe(true);
    expect(
      await access({ INCLUDE_WORKBOOK_IDS: resourceId })({ resourceType: 'view', resourceId }),
    ).toBe(false);
  });

  it.each(['workbook', 'view', 'datasource'] as FavoriteResourceType[])(
    'fails closed on %s lookup failure with a project restriction',
    async (resourceType) => {
      for (const mock of [mocks.getWorkbook, mocks.getView, mocks.queryDatasource, mocks.queryFlow])
        mock.mockRejectedValue(new Error('Fixture missing permission'));
      expect(await access({ INCLUDE_PROJECT_IDS: projectId })({ resourceType, resourceId })).toBe(
        false,
      );
    },
  );

  it('defers flow favorites without requesting any flow read scope or endpoint', async () => {
    expect(await access()({ resourceType: 'flow', resourceId })).toBe(false);
    expect(
      await access({ INCLUDE_PROJECT_IDS: projectId })({ resourceType: 'flow', resourceId }),
    ).toBe(false);
    expect(mocks.queryFlow).not.toHaveBeenCalled();
  });

  it('checks project visibility and caches one project-list lookup per invocation', async () => {
    const checker = access({ INCLUDE_PROJECT_IDS: projectId });
    expect(await checker({ resourceType: 'project', resourceId: projectId })).toBe(true);
    expect(await checker({ resourceType: 'project', resourceId: projectId })).toBe(true);
    expect(mocks.queryProjects).toHaveBeenCalledOnce();
    expect(await checker({ resourceType: 'project', resourceId: otherId })).toBe(false);
    expect(mocks.queryProjects).toHaveBeenCalledOnce();
  });

  it('fails closed after the bounded project visibility scan ceiling', async () => {
    mocks.queryProjects.mockImplementation(async ({ pageNumber }) => ({
      projects: Array.from({ length: 100 }, (_, index) => ({
        id: `page-${pageNumber}-project-${index}`,
      })),
      pagination: { pageSize: 100, pageNumber, totalAvailable: 5000 },
    }));
    expect(await access()({ resourceType: 'project', resourceId: projectId })).toBe(false);
    expect(mocks.queryProjects).toHaveBeenCalledTimes(10);
  });

  it('preserves non-schema HTTP and route-safety errors from project verification', async () => {
    for (const error of [
      new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST'),
      new RouteSafetyError('Invalid route segment'),
    ]) {
      mocks.queryProjects.mockRejectedValue(error);
      await expect(access()({ resourceType: 'project', resourceId: projectId })).rejects.toBe(
        error,
      );
    }
  });

  it('rejects project favorites with any tag restriction and without an accessible project', async () => {
    expect(
      await access({ INCLUDE_TAGS: 'Sales', INCLUDE_PROJECT_IDS: projectId })({
        resourceType: 'project',
        resourceId: projectId,
      }),
    ).toBe(false);
    expect(mocks.queryProjects).not.toHaveBeenCalled();
    expect(await access()({ resourceType: 'project', resourceId: otherId })).toBe(false);
  });
});
