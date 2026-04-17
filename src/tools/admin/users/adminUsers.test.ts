import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../../server.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAdminUsersTool } from './adminUsers.js';

const mocks = vi.hoisted(() => ({
  mockAddUserToSite: vi.fn(),
  mockDeleteUsersFromSiteWithCsv: vi.fn(),
  mockDownloadUserCredentials: vi.fn(),
  mockGetGroupsForUser: vi.fn(),
  mockGetUsersOnSite: vi.fn(),
  mockImportUsersToSiteFromCsv: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockRemoveUserFromSite: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockUploadUserCredentials: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      adminMethods: {
        addUserToSite: mocks.mockAddUserToSite,
        deleteUsersFromSiteWithCsv: mocks.mockDeleteUsersFromSiteWithCsv,
        downloadUserCredentials: mocks.mockDownloadUserCredentials,
        getGroupsForUser: mocks.mockGetGroupsForUser,
        getUsersOnSite: mocks.mockGetUsersOnSite,
        importUsersToSiteFromCsv: mocks.mockImportUsersToSiteFromCsv,
        queryUserOnSite: mocks.mockQueryUserOnSite,
        removeUserFromSite: mocks.mockRemoveUserFromSite,
        updateUser: mocks.mockUpdateUser,
        uploadUserCredentials: mocks.mockUploadUserCredentials,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('admin-users tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAdminUsersTool(new Server());
    expect(tool.name).toBe('admin-users');
    expect(tool.description).toContain('Administrative Tableau users tool');
    expect(tool.annotations?.title).toBe('Admin Users');
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });

  describe('add-user-to-site', () => {
    it('should add a user to the site', async () => {
      const mockUser = {
        id: 'user-123',
        name: 'john.doe@example.com',
        siteRole: 'Viewer',
      };
      mocks.mockAddUserToSite.mockResolvedValue({ user: mockUser });

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'add-user-to-site',
          body: {
            user: {
              name: 'john.doe@example.com',
              siteRole: 'Viewer',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockAddUserToSite).toHaveBeenCalledWith('test-site-id', {
        user: {
          name: 'john.doe@example.com',
          siteRole: 'Viewer',
        },
      });
    });
  });

  describe('get-users-on-site', () => {
    it('should get users on site with pagination', async () => {
      const mockUsers = {
        users: {
          user: [
            { id: 'user-1', name: 'user1@example.com' },
            { id: 'user-2', name: 'user2@example.com' },
          ],
        },
      };
      mocks.mockGetUsersOnSite.mockResolvedValue(mockUsers);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'get-users-on-site',
          pageSize: 10,
          pageNumber: 1,
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockGetUsersOnSite).toHaveBeenCalledWith('test-site-id', {
        pageSize: 10,
        pageNumber: 1,
      });
    });

    it('should get users with filter and sort', async () => {
      const mockUsers = { users: { user: [] } };
      mocks.mockGetUsersOnSite.mockResolvedValue(mockUsers);

      const tool = getAdminUsersTool(new Server());
      await tool.callback(
        {
          operation: 'get-users-on-site',
          filter: 'name:eq:test@example.com',
          sort: 'name:asc',
        },
        getMockRequestHandlerExtra(),
      );

      expect(mocks.mockGetUsersOnSite).toHaveBeenCalledWith('test-site-id', {
        filter: 'name:eq:test@example.com',
        sort: 'name:asc',
      });
    });
  });

  describe('query-user-on-site', () => {
    it('should query a specific user', async () => {
      const mockUser = {
        user: {
          id: 'user-123',
          name: 'john.doe@example.com',
          siteRole: 'Viewer',
        },
      };
      mocks.mockQueryUserOnSite.mockResolvedValue(mockUser);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'query-user-on-site',
          userId: 'user-123',
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryUserOnSite).toHaveBeenCalledWith('test-site-id', 'user-123');
    });
  });

  describe('update-user', () => {
    it('should update a user', async () => {
      const mockUpdatedUser = {
        user: {
          id: 'user-123',
          name: 'john.doe@example.com',
          siteRole: 'Explorer',
        },
      };
      mocks.mockUpdateUser.mockResolvedValue(mockUpdatedUser);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'update-user',
          userId: 'user-123',
          body: {
            user: {
              siteRole: 'Explorer',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateUser).toHaveBeenCalledWith('test-site-id', 'user-123', {
        user: {
          siteRole: 'Explorer',
        },
      });
    });
  });

  describe('remove-user-from-site', () => {
    it('should remove a user from the site', async () => {
      mocks.mockRemoveUserFromSite.mockResolvedValue({});

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'remove-user-from-site',
          userId: 'user-123',
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockRemoveUserFromSite).toHaveBeenCalledWith('test-site-id', 'user-123', {});
    });

    it('should remove user with mapAssetsTo parameter', async () => {
      mocks.mockRemoveUserFromSite.mockResolvedValue({});

      const tool = getAdminUsersTool(new Server());
      await tool.callback(
        {
          operation: 'remove-user-from-site',
          userId: 'user-123',
          mapAssetsTo: 'user-456',
        },
        getMockRequestHandlerExtra(),
      );

      expect(mocks.mockRemoveUserFromSite).toHaveBeenCalledWith('test-site-id', 'user-123', {
        mapAssetsTo: 'user-456',
      });
    });
  });

  describe('get-groups-for-user', () => {
    it('should get groups for a user', async () => {
      const mockGroups = {
        groups: {
          group: [
            { id: 'group-1', name: 'Analysts' },
            { id: 'group-2', name: 'Developers' },
          ],
        },
      };
      mocks.mockGetGroupsForUser.mockResolvedValue(mockGroups);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'get-groups-for-user',
          userId: 'user-123',
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockGetGroupsForUser).toHaveBeenCalledWith('test-site-id', 'user-123', {});
    });
  });

  describe('import-users-to-site-from-csv', () => {
    it('should import users from CSV', async () => {
      const mockImportResult = {
        tableauCredentials: {
          site: { id: 'site-123' },
        },
      };
      mocks.mockImportUsersToSiteFromCsv.mockResolvedValue(mockImportResult);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'import-users-to-site-from-csv',
          body: {
            userImport: {
              csv: 'username,password,display_name\nuser1,pass1,User One',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockImportUsersToSiteFromCsv).toHaveBeenCalledWith(
        'test-site-id',
        {
          userImport: {
            csv: 'username,password,display_name\nuser1,pass1,User One',
          },
        },
        { isVerbose: undefined },
      );
    });
  });

  describe('delete-users-from-site-with-csv', () => {
    it('should delete users from CSV', async () => {
      mocks.mockDeleteUsersFromSiteWithCsv.mockResolvedValue({});

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'delete-users-from-site-with-csv',
          body: {
            userDelete: {
              csv: 'username\nuser1@example.com\nuser2@example.com',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockDeleteUsersFromSiteWithCsv).toHaveBeenCalledWith('test-site-id', {
        userDelete: {
          csv: 'username\nuser1@example.com\nuser2@example.com',
        },
      });
    });
  });

  describe('OAuth credentials', () => {
    it('should upload user credentials', async () => {
      const mockCredentials = {
        credentials: {
          clientId: 'client-123',
        },
      };
      mocks.mockUploadUserCredentials.mockResolvedValue(mockCredentials);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'upload-user-credentials',
          userId: 'user-123',
          body: {
            credentials: {
              name: 'My OAuth Client',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockUploadUserCredentials).toHaveBeenCalledWith(
        'test-site-id',
        'user-123',
        {
          credentials: {
            name: 'My OAuth Client',
          },
        },
      );
    });

    it('should download user credentials', async () => {
      const mockCredentials = {
        credentials: {
          clientId: 'client-123',
          clientSecret: 'secret-456',
        },
      };
      mocks.mockDownloadUserCredentials.mockResolvedValue(mockCredentials);

      const tool = getAdminUsersTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'download-user-credentials',
          userId: 'user-123',
          body: {
            credentials: {
              name: 'My OAuth Client',
            },
          },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockDownloadUserCredentials).toHaveBeenCalledWith(
        'test-site-id',
        'user-123',
        {
          credentials: {
            name: 'My OAuth Client',
          },
        },
      );
    });
  });
});
