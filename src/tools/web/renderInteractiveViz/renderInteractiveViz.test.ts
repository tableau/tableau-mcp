import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockView } from '../views/mockView.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { getRenderInteractiveVizTool } from './renderInteractiveViz.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockResourceAccessChecker: {
    isViewAllowed: vi.fn(),
    isWorkbookAllowed: vi.fn(),
  },
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
      },
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: mocks.mockResourceAccessChecker,
  exportedForTesting: {
    resetResourceAccessCheckerSingleton: vi.fn(),
  },
}));

describe('renderInteractiveVizTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({ allowed: true });
    mocks.mockResourceAccessChecker.isWorkbookAllowed.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should have correct tool properties', () => {
    const tool = getRenderInteractiveVizTool(new WebMcpServer());
    expect(tool.name).toBe('render-interactive-viz');
    expect(tool.description).toContain('interactive, embedded Tableau visualization');
    expect(tool.paramsSchema).toMatchObject({
      luid: expect.any(Object),
      objectType: expect.any(Object),
    });
    expect(tool.app?.resourceUri).toBe('ui://render-interactive-viz/mcp-app.html');
  });

  it('should return correct payload for an allowed view', async () => {
    mocks.mockGetView.mockResolvedValue(mockView);

    const result = await getToolResult({ luid: mockView.id, objectType: 'view' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.data).toEqual({
      luid: mockView.id,
      objectType: 'view',
      name: mockView.name,
    });
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
  });

  it('should return ViewNotAllowed error when view is not allowed', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the view with LUID test-view-id is not allowed.',
    });

    const result = await getToolResult({ luid: 'test-view-id', objectType: 'view' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Querying the view with LUID test-view-id is not allowed',
    );
  });

  it('should return correct payload for an allowed workbook with default view', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({ luid: mockWorkbook.id, objectType: 'workbook' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.data).toEqual({
      luid: mockWorkbook.id,
      objectType: 'workbook',
      name: mockWorkbook.name,
    });
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
  });

  it('should return WorkbookNotAllowed error when workbook is not allowed', async () => {
    mocks.mockResourceAccessChecker.isWorkbookAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the workbook with LUID test-wb-id is not allowed.',
    });

    const result = await getToolResult({ luid: 'test-wb-id', objectType: 'workbook' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Querying the workbook with LUID test-wb-id is not allowed',
    );
  });

  it('should fall back to webpageUrl when workbook has no views', async () => {
    const workbookNoViews = {
      ...mockWorkbook,
      views: { view: [] },
      webpageUrl: 'https://tableau.example.com/workbook/123',
    };
    mocks.mockGetWorkbook.mockResolvedValue(workbookNoViews);

    const result = await getToolResult({ luid: workbookNoViews.id, objectType: 'workbook' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.url).toBe('https://tableau.example.com/workbook/123');
  });

  it('should fall back to empty string when workbook has no views and no webpageUrl', async () => {
    const workbookNoViewsNoUrl = {
      ...mockWorkbook,
      views: { view: [] },
      webpageUrl: undefined,
    };
    mocks.mockGetWorkbook.mockResolvedValue(workbookNoViewsNoUrl);

    const result = await getToolResult({ luid: workbookNoViewsNoUrl.id, objectType: 'workbook' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.url).toBe('');
  });
});

async function getToolResult(params: {
  luid: string;
  objectType: 'workbook' | 'view';
}): Promise<CallToolResult> {
  const tool = getRenderInteractiveVizTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
