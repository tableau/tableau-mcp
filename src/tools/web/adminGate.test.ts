import { AxiosError, AxiosResponse } from 'axios';
import { Err, Ok } from 'ts-results-es';

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

  // getCurrentUserSiteRole retries with real backoff delays. Fake timers keep the retry-path tests
  // fast: schedule the call, drain all pending timers/microtasks, then await the settled result.
  async function resolveWithFakeTimers<T>(op: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
      const pending = op();
      await vi.runAllTimersAsync();
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  function stubUseRestApiWithSiteRole(siteRole: string | undefined): void {
    mocks.useRestApi.mockImplementation(async ({ callback }) =>
      callback({
        authenticatedServerMethods: {
          getCurrentServerSession: vi.fn().mockResolvedValue(
            Ok({
              site: { id: 'site-A' },
              user: { id: 'user-A', name: 'name', siteRole },
            }),
          ),
        },
      }),
    );
  }

  it('returns undefined when queryUserOnSite fails (fail-closed)', async () => {
    mocks.useRestApi.mockImplementation(async () => {
      throw new Error('network down');
    });

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(
        makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-fail', userId: 'user-fail' })),
      ),
    );

    expect(siteRole).toBeUndefined();
  });

  it('retries a failed fetch and returns the role once a retry succeeds', async () => {
    mocks.useRestApi
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockImplementationOnce(async ({ callback }) =>
        callback({
          authenticatedServerMethods: {
            getCurrentServerSession: vi.fn().mockResolvedValue(
              Ok({
                site: { id: 'site-A' },
                user: { id: 'user-A', name: 'name', siteRole: 'SiteAdministratorCreator' },
              }),
            ),
          },
        }),
      );

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(
        makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
      ),
    );

    expect(siteRole).toBe('SiteAdministratorCreator');
    expect(mocks.useRestApi).toHaveBeenCalledTimes(3);
  });

  it('retries up to 3 times then returns undefined when every attempt fails', async () => {
    mocks.useRestApi.mockRejectedValue(new Error('network down'));

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(
        makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
      ),
    );

    expect(siteRole).toBeUndefined();
    expect(mocks.useRestApi).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 4xx client error (deterministic — retrying cannot help)', async () => {
    const forbidden = new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 403,
    } as AxiosResponse);
    mocks.useRestApi.mockRejectedValue(forbidden);

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
    );

    expect(siteRole).toBeUndefined();
    expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
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

  // Regression (W-Bearer-no-MFA): a Bearer token for a user without MFA carries no
  // `https://tableau.com/userId` claim, so restApi.userId is ''. The role must still resolve via
  // GET /sessions/current, which needs no userId. The stubbed restApi deliberately exposes ONLY
  // getCurrentServerSession (no usersMethods) to prove the gate no longer depends on a
  // userId-keyed /users/:userId lookup.
  it('resolves the site role from the current session for a Bearer token with no userId claim', async () => {
    mocks.useRestApi.mockImplementation(async ({ callback }) =>
      callback({
        authenticatedServerMethods: {
          getCurrentServerSession: vi.fn().mockResolvedValue(
            Ok({
              site: { id: 'site-x' },
              user: { id: 'user-session', name: 'name', siteRole: 'SiteAdministratorCreator' },
            }),
          ),
        },
      }),
    );

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(
        makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-x', userId: undefined })),
      ),
    );

    expect(siteRole).toBe('SiteAdministratorCreator');
  });

  // Missing/invalid auth is fail-closed via the REST path, not a short-circuit: with no usable
  // identity, sign-in throws, so after the retries getCurrentUserSiteRole resolves to undefined.
  it('returns undefined when tableauAuthInfo is missing (no user to gate on)', async () => {
    mocks.useRestApi.mockRejectedValue(new Error('no auth to sign in with'));

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(makeRestApiArgs(undefined)),
    );

    expect(siteRole).toBeUndefined();
  });

  it('does not retry when the current session lookup is unauthorized (deterministic — retrying cannot help)', async () => {
    mocks.useRestApi.mockImplementation(async ({ callback }) =>
      callback({
        authenticatedServerMethods: {
          getCurrentServerSession: vi.fn().mockResolvedValue(
            Err({
              type: 'unauthorized',
              message: { code: '401001', summary: 'Unauthorized', detail: 'expired token' },
            }),
          ),
        },
      }),
    );

    const siteRole = await getCurrentUserSiteRole(
      makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
    );

    expect(siteRole).toBeUndefined();
    expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
  });

  it('retries a transient (unknown) current-session failure, then returns the role once it succeeds', async () => {
    mocks.useRestApi
      .mockImplementationOnce(async ({ callback }) =>
        callback({
          authenticatedServerMethods: {
            getCurrentServerSession: vi
              .fn()
              .mockResolvedValue(Err({ type: 'unknown', message: 'gateway timeout' })),
          },
        }),
      )
      .mockImplementationOnce(async ({ callback }) =>
        callback({
          authenticatedServerMethods: {
            getCurrentServerSession: vi.fn().mockResolvedValue(
              Ok({
                site: { id: 'site-A' },
                user: { id: 'user-A', name: 'name', siteRole: 'Viewer' },
              }),
            ),
          },
        }),
      );

    const siteRole = await resolveWithFakeTimers(() =>
      getCurrentUserSiteRole(
        makeRestApiArgs(makeTableauAuthInfo({ siteId: 'site-A', userId: 'user-A' })),
      ),
    );

    expect(siteRole).toBe('Viewer');
    expect(mocks.useRestApi).toHaveBeenCalledTimes(2);
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
