import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListUsersTool } from './listUsers.js';
import { mockUser } from './mockUser.js';

const mockUsers = [mockUser];

const mocks = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      usersMethods: {
        listUsers: mocks.mockListUsers,
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('listUsersTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
  });

  it('should create a tool instance with correct properties', () => {
    const listUsersTool = getListUsersTool(new WebMcpServer());
    expect(listUsersTool.name).toBe('list-users');
    expect(listUsersTool.description).toContain('Retrieves a list of users on the Tableau site');
    expect(listUsersTool.paramsSchema).toHaveProperty('filter');
    expect(listUsersTool.paramsSchema).toHaveProperty('pageSize');
    expect(listUsersTool.paramsSchema).toHaveProperty('limit');
  });

  it('should successfully get users with totalAvailable', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: mockUsers,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: mockUsers.length },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toEqual(mockUsers);
    expect(parsed.totalAvailable).toBe(mockUsers.length);
    expect(mocks.mockListUsers).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      pageSize: undefined,
    });
  });

  it('should return empty message when no users are found', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: [],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'No users were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListUsers.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should handle users with full profile', async () => {
    const fullUser = {
      ...mockUser,
      email: 'john.smith@example.com',
      fullName: 'John Smith',
      lastLogin: '2026-05-20T10:30:00Z',
      authSetting: 'SAML',
      locale: 'en_US',
      language: 'en',
    };
    mocks.mockListUsers.mockResolvedValue({
      users: [fullUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users[0].email).toBe('john.smith@example.com');
    expect(parsed.users[0].fullName).toBe('John Smith');
    expect(parsed.users[0].lastLogin).toBe('2026-05-20T10:30:00Z');
  });

  it('should handle users with different site roles', async () => {
    const users = [
      { ...mockUser, id: 'u1', siteRole: 'ServerAdministrator' },
      { ...mockUser, id: 'u2', siteRole: 'Creator' },
      { ...mockUser, id: 'u3', siteRole: 'Viewer' },
      { ...mockUser, id: 'u4', siteRole: 'Unlicensed' },
    ];
    mocks.mockListUsers.mockResolvedValue({
      users,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: users.length },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toHaveLength(4);
    expect(parsed.users[0].siteRole).toBe('ServerAdministrator');
    expect(parsed.users[3].siteRole).toBe('Unlicensed');
  });

  it('should handle users with different auth settings', async () => {
    const users = [
      { ...mockUser, id: 'u1', authSetting: 'SAML' },
      { ...mockUser, id: 'u2', authSetting: 'ServerDefault' },
      { ...mockUser, id: 'u3', authSetting: 'OpenID' },
    ];
    mocks.mockListUsers.mockResolvedValue({
      users,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: users.length },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users[0].authSetting).toBe('SAML');
    expect(parsed.users[1].authSetting).toBe('ServerDefault');
    expect(parsed.users[2].authSetting).toBe('OpenID');
  });

  it('should error when user is not admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('Your site role is: Viewer'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Viewer');
  });

  it('should return structured error for invalid filter string', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: [],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
    });
    const result = await getToolResult({ filter: 'invalidField:eq:value' });
    expect(result.isError).toBe(true);
  });

  it('should respect limit parameter', async () => {
    const users = [
      { ...mockUser, id: 'u1' },
      { ...mockUser, id: 'u2' },
      { ...mockUser, id: 'u3' },
      { ...mockUser, id: 'u4' },
      { ...mockUser, id: 'u5' },
    ];
    mocks.mockListUsers.mockResolvedValue({
      users,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: users.length },
    });
    const result = await getToolResult({ limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toHaveLength(2);
    expect(parsed.users[0].id).toBe('u1');
    expect(parsed.users[1].id).toBe('u2');
    expect(parsed.totalAvailable).toBe(5);
  });

  it('should pass pageSize to the API for server-side pagination', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: [mockUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    await getToolResult({ pageSize: 50 });
    expect(mocks.mockListUsers).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      pageSize: 50,
    });
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const listUsersTool = getListUsersTool(new WebMcpServer());
  const callback = await Provider.from(listUsersTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
