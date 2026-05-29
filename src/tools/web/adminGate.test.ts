import { RestApi } from '../../sdks/tableau/restApi.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';
import { assertAdmin } from './adminGate.js';

describe('assertAdmin', () => {
  function makeExtra({ userLuid = 'user-1' }: { userLuid?: string } = {}): TableauWebRequestHandlerExtra {
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
    }
  });

  it('returns Err when user LUID is missing', async () => {
    const result = await assertAdmin(makeRestApi(), makeExtra({ userLuid: '' }));
    expect(result.isErr()).toBe(true);
  });
});
