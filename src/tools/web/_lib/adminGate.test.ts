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
    getUserSpy,
  }: {
    siteId: string;
    userId: string;
    siteRole: string | undefined;
    getUserSpy?: ReturnType<typeof vi.fn>;
  }): RestApi {
    const getUser =
      getUserSpy ??
      vi.fn().mockResolvedValue({
        id: userId,
        name: 'tester',
        siteRole,
      });
    return {
      siteId,
      userId,
      usersMethods: {
        getUser,
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
    const getUserSpy = vi.fn().mockResolvedValue({
      id: 'u1',
      name: 'tester',
      siteRole: 'SiteAdministratorCreator',
    });
    const restApi = makeRestApi({
      siteId: 's1',
      userId: 'u1',
      siteRole: 'SiteAdministratorCreator',
      getUserSpy,
    });

    await adminGate.assertAdmin(restApi);
    await adminGate.assertAdmin(restApi);

    expect(getUserSpy).toHaveBeenCalledTimes(1);
  });
});
