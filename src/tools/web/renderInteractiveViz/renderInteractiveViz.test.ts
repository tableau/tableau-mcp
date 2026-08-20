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
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
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
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should have correct tool properties', () => {
    const tool = getRenderInteractiveVizTool(new WebMcpServer());
    expect(tool.name).toBe('render-interactive-viz');
    expect(tool.description).toContain('live, interactive Tableau embed the user can explore');
    expect(tool.paramsSchema).toMatchObject({
      luid: expect.any(Object),
      objectType: expect.any(Object),
    });
    expect(tool.app?.resourceUri).toBe('ui://render-interactive-viz/mcp-app.html');
  });

  describe('disabled property', () => {
    it('should be disabled when AUTH is pat (default test env), even with mcp-apps enabled', async () => {
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(true);
    });

    it('should be disabled when AUTH=oauth with embedded authz server, even with mcp-apps enabled', async () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('OAUTH_ISSUER', 'https://sso.online.tableau.com');
      vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'true');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY_PATH', './private_key.test.pem');
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(true);
    });

    it('should be enabled when AUTH=oauth delegated to the Tableau authz server, with mcp-apps enabled', async () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('OAUTH_ISSUER', 'https://sso.online.tableau.com');
      vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(false);
    });

    it('should be enabled when AUTH=uat, with mcp-apps enabled', async () => {
      vi.stubEnv('AUTH', 'uat');
      vi.stubEnv('UAT_TENANT_ID', 'test-tenant-id');
      vi.stubEnv('UAT_ISSUER', 'https://tableau-mcp.local/uat');
      vi.stubEnv('UAT_USERNAME_CLAIM', 'test@example.com');
      vi.stubEnv('UAT_PRIVATE_KEY', 'test-private-key');
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(false);
    });

    it('should be enabled when AUTH=direct-trust, with mcp-apps enabled', async () => {
      vi.stubEnv('AUTH', 'direct-trust');
      vi.stubEnv('JWT_SUB_CLAIM', 'test-user');
      vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'test-client-id');
      vi.stubEnv('CONNECTED_APP_SECRET_ID', 'test-secret-id');
      vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'test-secret-value');
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(false);
    });

    it('should stay disabled when mcp-apps is off, regardless of auth type', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);
      vi.stubEnv('AUTH', 'uat');
      vi.stubEnv('UAT_TENANT_ID', 'test-tenant-id');
      vi.stubEnv('UAT_ISSUER', 'https://tableau-mcp.local/uat');
      vi.stubEnv('UAT_USERNAME_CLAIM', 'test@example.com');
      vi.stubEnv('UAT_PRIVATE_KEY', 'test-private-key');
      const tool = getRenderInteractiveVizTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(true);
    });
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
