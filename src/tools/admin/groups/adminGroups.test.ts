import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../../server.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAdminGroupsTool } from './adminGroups.js';

const mocks = vi.hoisted(() => ({
  mockCreateGroup: vi.fn(),
  mockDeleteGroup: vi.fn(),
  mockUpdateGroup: vi.fn(),
  mockQueryGroups: vi.fn(),
  mockAddUserToGroup: vi.fn(),
  mockRemoveUserFromGroup: vi.fn(),
  mockBulkRemoveUsersFromGroup: vi.fn(),
  mockGetUsersInGroup: vi.fn(),
  mockCreateGroupSet: vi.fn(),
  mockUpdateGroupSet: vi.fn(),
  mockDeleteGroupSet: vi.fn(),
  mockGetGroupSet: vi.fn(),
  mockListGroupSets: vi.fn(),
  mockAddGroupToGroupSet: vi.fn(),
  mockRemoveGroupFromGroupSet: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      adminMethods: {
        createGroup: mocks.mockCreateGroup,
        deleteGroup: mocks.mockDeleteGroup,
        updateGroup: mocks.mockUpdateGroup,
        queryGroups: mocks.mockQueryGroups,
        addUserToGroup: mocks.mockAddUserToGroup,
        removeUserFromGroup: mocks.mockRemoveUserFromGroup,
        bulkRemoveUsersFromGroup: mocks.mockBulkRemoveUsersFromGroup,
        getUsersInGroup: mocks.mockGetUsersInGroup,
        createGroupSet: mocks.mockCreateGroupSet,
        updateGroupSet: mocks.mockUpdateGroupSet,
        deleteGroupSet: mocks.mockDeleteGroupSet,
        getGroupSet: mocks.mockGetGroupSet,
        listGroupSets: mocks.mockListGroupSets,
        addGroupToGroupSet: mocks.mockAddGroupToGroupSet,
        removeGroupFromGroupSet: mocks.mockRemoveGroupFromGroupSet,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('admin-groups tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getAdminGroupsTool(new Server());
    expect(tool.name).toBe('admin-groups');
    expect(tool.description).toContain('Administrative Tableau groups');
  });

  describe('create-group', () => {
    it('should create a group', async () => {
      const mockGroup = { group: { id: 'group-123', name: 'Analysts' } };
      mocks.mockCreateGroup.mockResolvedValue(mockGroup);

      const tool = getAdminGroupsTool(new Server());
      const result = (await tool.callback(
        {
          operation: 'create-group',
          body: { group: { name: 'Analysts' } },
        },
        getMockRequestHandlerExtra(),
      )) as CallToolResult;

      expect(result.isError).toBe(false);
      expect(mocks.mockCreateGroup).toHaveBeenCalledWith(
        'test-site-id',
        { group: { name: 'Analysts' } },
        { asJob: undefined },
      );
    });
  });

  describe('query-groups', () => {
    it('should query groups with pagination', async () => {
      const mockGroups = {
        groups: { group: [{ id: 'group-1', name: 'Group 1' }] },
      };
      mocks.mockQueryGroups.mockResolvedValue(mockGroups);

      const tool = getAdminGroupsTool(new Server());
      await tool.callback(
        {
          operation: 'query-groups',
          pageSize: 10,
          filter: 'name:eq:Analysts',
        },
        getMockRequestHandlerExtra(),
      );

      expect(mocks.mockQueryGroups).toHaveBeenCalledWith('test-site-id', {
        pageSize: 10,
        filter: 'name:eq:Analysts',
      });
    });
  });

  describe('add-user-to-group', () => {
    it('should add user to group', async () => {
      mocks.mockAddUserToGroup.mockResolvedValue({ user: { id: 'user-123' } });

      const tool = getAdminGroupsTool(new Server());
      await tool.callback(
        {
          operation: 'add-user-to-group',
          groupId: 'group-123',
          body: { user: { id: 'user-123' } },
        },
        getMockRequestHandlerExtra(),
      );

      expect(mocks.mockAddUserToGroup).toHaveBeenCalledWith(
        'test-site-id',
        'group-123',
        { user: { id: 'user-123' } },
      );
    });
  });

  describe('get-users-in-group', () => {
    it('should get users in group', async () => {
      const mockUsers = { users: { user: [{ id: 'user-1' }] } };
      mocks.mockGetUsersInGroup.mockResolvedValue(mockUsers);

      const tool = getAdminGroupsTool(new Server());
      await tool.callback(
        {
          operation: 'get-users-in-group',
          groupId: 'group-123',
        },
        getMockRequestHandlerExtra(),
      );

      expect(mocks.mockGetUsersInGroup).toHaveBeenCalledWith('test-site-id', 'group-123', {});
    });
  });
});
