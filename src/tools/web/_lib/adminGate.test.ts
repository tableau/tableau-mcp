import { RestApi } from '../../../sdks/tableau/restApi.js';
import { adminGate, NotAdminError } from './adminGate.js';

describe('adminGate', () => {
  beforeEach(() => {
    adminGate.clearCache();
  });

  function makeRestApi({
    siteId,
    userId,
    siteRole,
    queryUserOnSiteSpy,
  }: {
    siteId: string;
    userId: string;
    siteRole: string | undefined;
    queryUserOnSiteSpy?: ReturnType<typeof vi.fn>;
  }): RestApi {
    const queryUserOnSite =
      queryUserOnSiteSpy ??
      vi.fn().mockResolvedValue({
        id: userId,
        name: 'tester',
        siteRole,
      });
    return {
      siteId,
      userId,
      usersMethods: {
        queryUserOnSite,
      },
    } as unknown as RestApi;
  }

  it('passes for SiteAdministratorCreator', async () => {
    const restApi = makeRestApi({
      siteId: 's1',
      userId: 'u1',
      siteRole: 'SiteAdministratorCreator',
    });
    await expect(adminGate.assertAdmin(restApi)).resolves.toBeUndefined();
  });

  it('passes for ServerAdministrator', async () => {
    const restApi = makeRestApi({ siteId: 's1', userId: 'u1', siteRole: 'ServerAdministrator' });
    await expect(adminGate.assertAdmin(restApi)).resolves.toBeUndefined();
  });

  it('rejects non-admin roles', async () => {
    const restApi = makeRestApi({ siteId: 's1', userId: 'u1', siteRole: 'Viewer' });
    await expect(adminGate.assertAdmin(restApi)).rejects.toBeInstanceOf(NotAdminError);
  });

  it('rejects when site role is missing', async () => {
    const restApi = makeRestApi({ siteId: 's1', userId: 'u1', siteRole: undefined });
    await expect(adminGate.assertAdmin(restApi)).rejects.toBeInstanceOf(NotAdminError);
  });

  it('caches per (siteId, userId) so repeat calls skip the REST lookup', async () => {
    const queryUserOnSiteSpy = vi.fn().mockResolvedValue({
      id: 'u1',
      name: 'tester',
      siteRole: 'SiteAdministratorCreator',
    });
    const restApi = makeRestApi({
      siteId: 's1',
      userId: 'u1',
      siteRole: 'SiteAdministratorCreator',
      queryUserOnSiteSpy,
    });

    await adminGate.assertAdmin(restApi);
    await adminGate.assertAdmin(restApi);

    expect(queryUserOnSiteSpy).toHaveBeenCalledTimes(1);
  });
});
