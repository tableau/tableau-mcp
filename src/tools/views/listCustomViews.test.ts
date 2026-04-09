import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { getListCustomViewsTool } from './listCustomViews.js';
import { mockCustomView } from './mockCustomView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockCustomViews = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  customViews: [mockCustomView],
};

const mocks = vi.hoisted(() => ({
  mockListCustomViews: vi.fn(),
  mockGetWorkbook: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      viewsMethods: {
        listCustomViews: mocks.mockListCustomViews,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listCustomViewsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const listCustomViewsTool = getListCustomViewsTool(new Server());
    expect(listCustomViewsTool.name).toBe('list-custom-views');
    expect(listCustomViewsTool.description).toContain(
      'Retrieves a list of custom views for a Tableau workbook including their metadata such as name, owner, and the view they are found in.',
    );
    expect(listCustomViewsTool.paramsSchema).toMatchObject({
      workbookId: expect.any(Object),
      filter: expect.any(Object),
      pageSize: expect.any(Object),
      limit: expect.any(Object),
    });
  });

  it('should successfully get custom views', async () => {
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toMatchObject(mockCustomViews.customViews);
    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: undefined,
      pageSize: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListCustomViews.mockRejectedValue(new Error(errorMessage));
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return a workbook not found error if the workbook is not found', async () => {
    mocks.mockGetWorkbook.mockRejectedValue(
      new Error(`The workbook with LUID ${mockWorkbook.id} was not found.`),
    );
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      `The workbook with LUID ${mockWorkbook.id} was not found.`,
    );
  });

  it('should return a custom view not allowed error if its workbook is not allowed due to tool scoping', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');

    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      [
        `The custom views from the workbook with LUID ${mockWorkbook.id} are not allowed to be queried.`,
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        `Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`,
      ].join(' '),
    );
  });
});

async function getToolResult(params: {
  workbookId: string;
  filter: string;
}): Promise<CallToolResult> {
  const listCustomViewsTool = getListCustomViewsTool(new Server());
  const callback = await Provider.from(listCustomViewsTool.callback);
  return await callback(
    { workbookId: params.workbookId, filter: params.filter, pageSize: undefined, limit: undefined },
    getMockRequestHandlerExtra(),
  );
}
