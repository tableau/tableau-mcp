import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListJobsTool } from './listJobs.js';
import { mockJob } from './mockJob.js';

const mockJobs = [mockJob];

const mocks = vi.hoisted(() => ({
  mockListJobs: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      jobsMethods: {
        listJobs: mocks.mockListJobs,
      },
      usersMethods: {
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

describe('listJobsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
  });

  it('should create a tool instance with correct properties', () => {
    const listJobsTool = getListJobsTool(new WebMcpServer());
    expect(listJobsTool.name).toBe('list-jobs');
    expect(listJobsTool.description).toContain(
      'Retrieves a list of background jobs for the Tableau site',
    );
    expect(listJobsTool.paramsSchema).toHaveProperty('filter');
    expect(listJobsTool.paramsSchema).toHaveProperty('pageSize');
    expect(listJobsTool.paramsSchema).toHaveProperty('pageNumber');
  });

  it('should successfully get jobs', async () => {
    mocks.mockListJobs.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      jobs: mockJobs,
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toEqual(mockJobs);
    expect(mocks.mockListJobs).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: undefined,
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should return empty message when no jobs are found', async () => {
    mocks.mockListJobs.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
      jobs: [],
    });
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'No jobs were found. Either none exist matching the criteria or you do not have permission to view them.',
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListJobs.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should pass filter, pageSize, and pageNumber to API', async () => {
    mocks.mockListJobs.mockResolvedValue({
      pagination: { pageNumber: 2, pageSize: 50, totalAvailable: 100 },
      jobs: mockJobs,
    });
    await getToolResult({ filter: 'jobType:eq:refresh_extracts', pageSize: 50, pageNumber: 2 });
    expect(mocks.mockListJobs).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'jobType:eq:refresh_extracts',
      pageSize: 50,
      pageNumber: 2,
    });
  });

  it('should reject invalid filter fields', async () => {
    const result = await getToolResult({ filter: 'invalidField:eq:value' });
    expect(result.isError).toBe(true);
  });

  it('should reject invalid operators for a field', async () => {
    const result = await getToolResult({ filter: 'jobType:gt:refresh_extracts' });
    expect(result.isError).toBe(true);
  });

  it('should accept has operator for title field', async () => {
    mocks.mockListJobs.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      jobs: mockJobs,
    });
    const result = await getToolResult({ filter: 'title:has:Superstore' });
    expect(result.isError).toBe(false);
    expect(mocks.mockListJobs).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'title:has:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const listJobsTool = getListJobsTool(new WebMcpServer());
  const callback = await Provider.from(listJobsTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
