import { Config } from '../../config.js';
import { RestApiArgs } from '../../restApiInstance.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../server.web.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { assertAdmin, getCurrentUserSiteRole } from './adminGate.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

const mocks = vi.hoisted(() => ({
  useRestApi: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: mocks.useRestApi,
}));

describe('assertAdmin', () => {
  function makeExtra({
    userLuid = 'user-1',
  }: { userLuid?: string } = {}): TableauWebRequestHandlerExtra {
    return {
      getUserLuid: () => userLuid,
    } as unknown as TableauWebRequestHandlerExtra;
  }

  function makeRestApi({
    siteId = 'site-1',
    queryUserOnSiteSpy,
  }: {
    siteId?: string;
    queryUserOnSiteSpy?: ReturnType<typeof vi.fn>;
  } = {}): RestApi {
    const queryUserOnSite =
      queryUserOnSiteSpy ??
      vi.fn().mockResolvedValue({
        id: 'user-1',
        name: 'name',
        siteRole: 'SiteAdministratorCreator',
      });
    return {
      siteId,
      usersMethods: {
        queryUserOnSite,
      },
    } as unknown as RestApi;
  }

  it('returns Ok when user is a site administrator', async () => {
    const result = await assertAdmin(makeRestApi(), makeExtra());
    expect(result.isOk()).toBe(true);
  });

  it('returns Err when user is not an administrator', async () => {
    const queryUserOnSiteSpy = vi.fn().mockResolvedValue({
      id: 'user-viewer',
      name: 'name',
      siteRole: 'Viewer',
    });
    const result = await assertAdmin(
      makeRestApi({ queryUserOnSiteSpy }),
      makeExtra({ userLuid: 'user-viewer' }),
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Viewer');
      expect(result.error).toContain('administrative permissions');
    }
  });

  it('returns Err when user LUID is missing', async () => {
    const result = await assertAdmin(makeRestApi(), makeExtra({ userLuid: '' }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('administrative permissions');
    }
  });
});

describe('getCurrentUserSiteRole', () => {
  const server = {} as unknown as WebMcpServer;

  function makeTableauAuthInfo(
    overrides: Partial<Extract<TableauAuthInfo, { type: 'Bearer' }>> = {},
  ): TableauAuthInfo {
    return {
      type: 'Bearer',
      username: 'admin@example.com',
      server: 'https://tableau.example.com',
      siteId: 'site-A',
      siteName: 'default',
      userId: 'user-A',
      raw: 'token',
      ...overrides,
    };
  }

  // config/signal are unused by the mocked useRestApi call path, so a minimal
  // stub is sufficient — the real values matter only in production.
  function makeRestApiArgs(tableauAuthInfo: TableauAuthInfo | undefined): RestApiArgs {
    return {
      server,
      tableauAuthInfo,
      config: {} as Config,
      signal: new AbortController().signal,
      disableLogging: true,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stubUseRestApiWithSiteRole(siteRole: string | undefined): void {
    mocks.useRestApi.mockImplementation(async ({ callback }) =>
      callback({
        usersMethods: {
          queryUserOnSite: vi.fn().mockResolvedValue({
            id: 'user-A',
            name: 'name',
            siteRole,
          }),
        },
      }),
    );
  }

  it('returns undefined when queryUserOnSite fails (fail-closed)', async () => {
    mocks.useRestApi.mockImplementation(async () => {
      throw new Error('network down');
    });

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-fail', userId: 'user-fail' })),
    );

    expect(siteRole).toBeUndefined();
  });

  it('retries a failed fetch and returns the role once a retry succeeds', async () => {
    mocks.useRestApi
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockImplementationOnce(async ({ callback }) =>
        callback({
          usersMethods: {
            queryUserOnSite: vi.fn().mockResolvedValue({
              id: 'user-A',
              name: 'name',
              siteRole: 'SiteAdministratorCreator',
            }),
          },
        }),
      );

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
    );

    expect(siteRole).toBe('SiteAdministratorCreator');
    expect(mocks.useRestApi).toHaveBeenCalledTimes(3);
  });

  it('retries up to 3 times then returns undefined when every attempt fails', async () => {
    mocks.useRestApi.mockRejectedValue(new Error('network down'));

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
    );

    expect(siteRole).toBeUndefined();
    expect(mocks.useRestApi).toHaveBeenCalledTimes(3);
  });

  it('returns the admin site role when the current user is an admin', async () => {
    stubUseRestApiWithSiteRole('SiteAdministratorCreator');

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-admin', userId: 'user-admin' })),
    );

    expect(siteRole).toBe('SiteAdministratorCreator');
  });

  it('returns the non-admin site role verbatim', async () => {
    stubUseRestApiWithSiteRole('Viewer');

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-viewer', userId: 'user-viewer' })),
    );

    expect(siteRole).toBe('Viewer');
  });

  // Missing/invalid auth is fail-closed via the REST path, not a short-circuit: with no usable
  // identity, sign-in throws, so after the retries getCurrentUserSiteRole resolves to undefined.
  it('returns undefined when tableauAuthInfo is missing (no user to gate on)', async () => {
    mocks.useRestApi.mockRejectedValue(new Error('no auth to sign in with'));

    const siteRole = await getCurrentUserSiteRole(makeRestApiArgs(undefined));

    expect(siteRole).toBeUndefined();
  });

  it('returns undefined when tableauAuthInfo has no userId', async () => {
    mocks.useRestApi.mockRejectedValue(new Error('no userId to query'));

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-x', userId: undefined })),
    );

    expect(siteRole).toBeUndefined();
  });

  it('does not share state with assertAdmin — a subsequent assertAdmin still queries the REST API', async () => {
    const siteId = 'site-cache';
    const userId = 'user-cache';
    stubUseRestApiWithSiteRole('SiteAdministratorCreator');

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId, userId })),
    );
    expect(siteRole).toBe('SiteAdministratorCreator');
    expect(mocks.useRestApi).toHaveBeenCalledTimes(1);

    const queryUserOnSiteSpy = vi.fn().mockResolvedValue({
      id: userId,
      name: 'name',
      siteRole: 'SiteAdministratorCreator',
    });
    const restApi = {
      siteId,
      usersMethods: { queryUserOnSite: queryUserOnSiteSpy },
    } as unknown as RestApi;
    const extra = { getUserLuid: () => userId } as unknown as TableauWebRequestHandlerExtra;

    const result = await assertAdmin(restApi, extra);
    expect(result.isOk()).toBe(true);
    expect(queryUserOnSiteSpy).toHaveBeenCalledTimes(1);
  });
});
