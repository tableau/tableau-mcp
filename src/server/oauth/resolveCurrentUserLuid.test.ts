import { Err, Ok } from 'ts-results-es';

import { ResolveCurrentUserError } from '../../errors/mcpToolError.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { CurrentUserLuidResolverExtra, resolveCurrentUserLuid } from './resolveCurrentUserLuid.js';
import { TableauAuthInfo } from './schemas.js';

const mocks = vi.hoisted(() => ({
  mockGetCurrentServerSession: vi.fn(),
}));

describe('resolveCurrentUserLuid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the cached user LUID without calling the session API', async () => {
    const extra = getExtra({ _userLuid: 'cached-user-luid' });
    const result = await resolveCurrentUserLuid({ restApi: getRestApi(), extra });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('cached-user-luid');
    expect(mocks.mockGetCurrentServerSession).not.toHaveBeenCalled();
    expect(extra.setUserLuid).not.toHaveBeenCalled();
  });

  it('returns the token claim user LUID without calling the session API', async () => {
    const extra = getExtra({
      tableauAuthInfo: getBearerAuthInfo({ userId: 'claim-user-luid' }),
    });

    const result = await resolveCurrentUserLuid({ restApi: getRestApi(), extra });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('claim-user-luid');
    expect(mocks.mockGetCurrentServerSession).not.toHaveBeenCalled();
    expect(extra.setUserLuid).toHaveBeenCalledWith('claim-user-luid');
  });

  it('calls the session API when the token claim is absent', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Ok({
        site: { id: 'site-luid', name: 'site-name' },
        user: { id: 'session-user-luid', name: 'user-name' },
      }),
    );

    const extra = getExtra({ tableauAuthInfo: getBearerAuthInfo({ userId: undefined }) });

    const result = await resolveCurrentUserLuid({ restApi: getRestApi(), extra });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('session-user-luid');
    expect(mocks.mockGetCurrentServerSession).toHaveBeenCalledOnce();
    expect(extra.setUserLuid).toHaveBeenCalledWith('session-user-luid');
  });

  it('returns an error when the session API fails', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Err({ type: 'unauthorized', message: 'raw unauthorized body' }),
    );

    const result = await resolveCurrentUserLuid({
      restApi: getRestApi(),
      extra: getExtra({ tableauAuthInfo: getBearerAuthInfo({ userId: undefined }) }),
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ResolveCurrentUserError);
    expect(result.unwrapErr().statusCode).toBe(401);
    expect(result.unwrapErr().getErrorText()).toContain(
      'Unable to determine the current Tableau user',
    );
    expect(result.unwrapErr().getErrorText()).not.toContain('raw unauthorized body');
  });

  it('returns an error when the session response does not include user.id', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Ok({
        site: { id: 'site-luid', name: 'site-name' },
        user: { name: 'user-name' },
      }),
    );

    const result = await resolveCurrentUserLuid({
      restApi: getRestApi(),
      extra: getExtra({ tableauAuthInfo: getBearerAuthInfo({ userId: undefined }) }),
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(ResolveCurrentUserError);
    expect(result.unwrapErr().statusCode).toBe(502);
  });

  it('does not call the session API twice after a fallback user LUID is cached', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Ok({
        site: { id: 'site-luid', name: 'site-name' },
        user: { id: 'session-user-luid', name: 'user-name' },
      }),
    );

    const extra = getExtra({ tableauAuthInfo: getBearerAuthInfo({ userId: undefined }) });

    const firstResult = await resolveCurrentUserLuid({ restApi: getRestApi(), extra });
    const secondResult = await resolveCurrentUserLuid({ restApi: getRestApi(), extra });

    expect(firstResult.isOk()).toBe(true);
    expect(secondResult.isOk()).toBe(true);
    expect(secondResult.unwrap()).toBe('session-user-luid');
    expect(mocks.mockGetCurrentServerSession).toHaveBeenCalledOnce();
  });
});

function getRestApi(): RestApi {
  return {
    authenticatedServerMethods: {
      getCurrentServerSession: mocks.mockGetCurrentServerSession,
    },
  } as unknown as RestApi;
}

function getExtra({
  _userLuid,
  tableauAuthInfo,
}: {
  _userLuid?: string;
  tableauAuthInfo?: TableauAuthInfo;
}): CurrentUserLuidResolverExtra {
  const extra: CurrentUserLuidResolverExtra = {
    _userLuid,
    tableauAuthInfo,
    setUserLuid: vi.fn((userLuid: string) => {
      extra._userLuid = userLuid;
    }),
  };
  return extra;
}

function getBearerAuthInfo({ userId }: { userId: string | undefined }): TableauAuthInfo {
  return {
    type: 'Bearer',
    username: 'user-name',
    server: 'https://tableau.example.com',
    siteId: 'site-luid',
    ...(userId ? { userId } : {}),
    raw: 'raw-token',
  };
}
