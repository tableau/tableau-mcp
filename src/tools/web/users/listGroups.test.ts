import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListGroupsTool } from './listGroups.js';
import { mockGroup } from './mockGroup.js';

const mocks = vi.hoisted(() => ({
  mockListGroups: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      usersMethods: {
        listGroups: mocks.mockListGroups,
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

describe('listGroupsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
  });

  it('should create a tool instance with correct properties', () => {
    const listGroupsTool = getListGroupsTool(new WebMcpServer());
    expect(listGroupsTool.name).toBe('list-groups');
    expect(listGroupsTool.description).toContain('Retrieves a list of groups on the Tableau site');
    expect(listGroupsTool.paramsSchema).toHaveProperty('filter');
    expect(listGroupsTool.paramsSchema).toHaveProperty('pageSize');
    expect(listGroupsTool.paramsSchema).toHaveProperty('limit');
  });

  it('should successfully list groups with totalAvailable', async () => {
    mocks.mockListGroups.mockResolvedValue({
      groups: [mockGroup],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });

    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.groups).toEqual([mockGroup]);
    expect(parsed.totalAvailable).toBe(1);
    expect(parsed.truncated).toBe(false);
    expect(mocks.mockListGroups).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'test-site-id' }),
    );
  });

  it('should pass the filter through to the REST API', async () => {
    mocks.mockListGroups.mockResolvedValue({
      groups: [mockGroup],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
    });

    const result = await getToolResult({ filter: 'name:eq:Sales' });
    expect(result.isError).toBe(false);
    expect(mocks.mockListGroups).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'name:eq:Sales' }),
    );
  });

  it('should pass pageSize to the API for server-side pagination', async () => {
    mocks.mockListGroups.mockResolvedValue({
      groups: [mockGroup],
      pagination: { pageNumber: 1, pageSize: 25, totalAvailable: 1 },
    });

    await getToolResult({ pageSize: 25 });
    expect(mocks.mockListGroups).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 25 }));
  });

  it('should return empty message when no groups are found', async () => {
    mocks.mockListGroups.mockResolvedValue({
      groups: [],
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
    });

    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'No groups were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListGroups.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should error when user is not admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('Your site role is: Viewer'));

    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Viewer');
    expect(mocks.mockListGroups).not.toHaveBeenCalled();
  });

  it('should respect the limit parameter and flag the result as truncated', async () => {
    const groups = Array.from({ length: 3 }, (_, i) => ({ ...mockGroup, id: `g-${i}` }));
    mocks.mockListGroups.mockResolvedValue({
      groups,
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 3 },
    });

    const result = await getToolResult({ limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.groups.map((g: any) => g.id)).toEqual(['g-0', 'g-1']);
    expect(parsed.totalAvailable).toBe(3);
    expect(parsed.truncated).toBe(true);
  });

  it('should apply the MAX_RESULT_LIMITS cap when it is tighter than the caller limit', async () => {
    vi.stubEnv('MAX_RESULT_LIMITS', 'list-groups:1');
    try {
      const groups = [
        { ...mockGroup, id: 'g-0' },
        { ...mockGroup, id: 'g-1' },
      ];
      mocks.mockListGroups.mockResolvedValue({
        groups,
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
      });

      const result = await getToolResult({ limit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(`${result.content[0].text}`);
      expect(parsed.groups).toHaveLength(1);
      expect(parsed.truncated).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
    }
  });

  it('should paginate through all pages when groups exceed one page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ ...mockGroup, id: `g-${i}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ ...mockGroup, id: `g-${100 + i}` }));

    mocks.mockListGroups
      .mockResolvedValueOnce({
        groups: page1,
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 150 },
      })
      .mockResolvedValueOnce({
        groups: page2,
        pagination: { pageNumber: 2, pageSize: 100, totalAvailable: 150 },
      });

    const result = await getToolResult({ pageSize: 100 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.groups).toHaveLength(150);
    expect(parsed.totalAvailable).toBe(150);
    expect(parsed.truncated).toBe(false);
    expect(mocks.mockListGroups).toHaveBeenCalledTimes(2);
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const listGroupsTool = getListGroupsTool(new WebMcpServer());
  const callback = await Provider.from(listGroupsTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
