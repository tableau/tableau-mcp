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
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: mockUsers.length },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    // mockUser carries extra fields (authSetting/locale/language); the tool
    // projects output down to the 6 advertised fields, so compare against that.
    expect(parsed.users).toEqual([
      {
        id: mockUser.id,
        name: mockUser.name,
        fullName: mockUser.fullName,
        siteRole: mockUser.siteRole,
        email: mockUser.email,
        lastLogin: mockUser.lastLogin,
      },
    ]);
    expect(parsed.totalAvailable).toBe(mockUsers.length);
    expect(mocks.mockListUsers).toHaveBeenCalled();
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

  it('should project output to only the 6 advertised fields, stripping extras Tableau still returns', async () => {
    // CRITICAL: Tableau's `fields=...` param is only an "include at least" hint —
    // the raw REST response STILL contains authSetting/locale/language/
    // externalAuthUserId, and userSchema keeps them as known optional keys so Zod
    // does not strip them. The tool must project them out at its boundary. Mock the
    // REALISTIC FULL response so this guard actually exercises the projection.
    const fullUser = {
      id: 'user-full',
      name: 'dsmith',
      fullName: 'Dana Smith',
      siteRole: 'Explorer',
      email: 'dsmith@example.com',
      lastLogin: '2026-05-20T10:30:00Z',
      authSetting: 'SAML',
      locale: 'en_US',
      language: 'en',
      externalAuthUserId: 'ext-123',
    };
    mocks.mockListUsers.mockResolvedValue({
      users: [fullUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toHaveLength(1);
    const out = parsed.users[0];
    // The 6 advertised fields survive.
    expect(out).toEqual({
      id: 'user-full',
      name: 'dsmith',
      fullName: 'Dana Smith',
      siteRole: 'Explorer',
      email: 'dsmith@example.com',
      lastLogin: '2026-05-20T10:30:00Z',
    });
    // Everything Tableau leaks is stripped.
    expect(out).not.toHaveProperty('authSetting');
    expect(out).not.toHaveProperty('locale');
    expect(out).not.toHaveProperty('language');
    expect(out).not.toHaveProperty('externalAuthUserId');
    expect(Object.keys(out).sort()).toEqual(
      ['email', 'fullName', 'id', 'lastLogin', 'name', 'siteRole'].sort(),
    );
  });

  it('should omit lastLogin (not emit null) for never-logged-in users after projection', async () => {
    // A full response where lastLogin is absent (never signed in) but extras present.
    const neverUser = {
      id: 'user-never',
      name: 'nlogin',
      fullName: 'No Login',
      siteRole: 'Creator',
      email: 'nlogin@example.com',
      authSetting: 'SAML',
      locale: 'en_US',
    };
    mocks.mockListUsers.mockResolvedValue({
      users: [neverUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    const out = parsed.users[0];
    expect(out).not.toHaveProperty('lastLogin'); // omitted, not null
    expect(out).not.toHaveProperty('authSetting');
    expect(out.id).toBe('user-never');
  });

  it('should request an explicit lean field set (not _all_, and not authSetting)', async () => {
    // Regression guard for the lastLogin bug: we must name every field explicitly
    // rather than relying on Tableau's silent default set. We deliberately do NOT
    // request _all_ (avoids the expensive SSO/authSetting path).
    mocks.mockListUsers.mockResolvedValue({
      users: [mockUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    await getToolResult({});
    expect(mocks.mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ fields: 'id,name,fullName,siteRole,email,lastLogin' }),
    );
    const requestedFields: string = mocks.mockListUsers.mock.calls[0][0].fields;
    expect(requestedFields).not.toContain('_all_');
    expect(requestedFields).not.toContain('authSetting');
    expect(requestedFields).toContain('lastLogin');
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

  it('should reject a filter on an un-fetched field (isError), not silently return empty', async () => {
    // authSetting is no longer fetched, so it is no longer filterable. The tool
    // must surface a clean validation error rather than "No users were found".
    mocks.mockListUsers.mockResolvedValue({
      users: [mockUser],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });
    const result = await getToolResult({ filter: 'authSetting:eq:SAML' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('authSetting');
    expect(result.content[0].text).not.toContain('No users were found');
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
  });

  it('should pass pageSize to the API for server-side pagination', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: [mockUser],
      pagination: { pageNumber: 1, pageSize: 50, totalAvailable: 1 },
    });
    await getToolResult({ pageSize: 50 });
    expect(mocks.mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'test-site-id', pageSize: 50 }),
    );
  });

  it('should clamp pageSize to 1000 when caller passes a larger value', async () => {
    mocks.mockListUsers.mockResolvedValue({
      users: [mockUser],
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 1 },
    });
    await getToolResult({ pageSize: 5000 });
    expect(mocks.mockListUsers).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'test-site-id', pageSize: 1000 }),
    );
  });

  it('should report totalAvailable from REST pagination, not array length', async () => {
    const page1Users = Array.from({ length: 5 }, (_, i) => ({ ...mockUser, id: `u-${i}` }));
    mocks.mockListUsers.mockResolvedValue({
      users: page1Users,
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 27034 },
    });
    const result = await getToolResult({ limit: 5 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toHaveLength(5);
    expect(parsed.totalAvailable).toBe(27034);
  });

  it('should paginate through all pages when users exceed one page', async () => {
    const page1Users = Array.from({ length: 100 }, (_, i) => ({ ...mockUser, id: `u-${i}` }));
    const page2Users = Array.from({ length: 50 }, (_, i) => ({ ...mockUser, id: `u-${100 + i}` }));

    mocks.mockListUsers
      .mockResolvedValueOnce({
        users: page1Users,
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 150 },
      })
      .mockResolvedValueOnce({
        users: page2Users,
        pagination: { pageNumber: 2, pageSize: 100, totalAvailable: 150 },
      });

    const result = await getToolResult({ pageSize: 100 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.users).toHaveLength(150);
    expect(parsed.totalAvailable).toBe(150);
    expect(mocks.mockListUsers).toHaveBeenCalledTimes(2);
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const listUsersTool = getListUsersTool(new WebMcpServer());
  const callback = await Provider.from(listUsersTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
