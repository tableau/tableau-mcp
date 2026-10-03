import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getMoveWorkbookTool } from './moveWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockUpdateWorkbook: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        updateWorkbook: mocks.mockUpdateWorkbook,
        getWorkbook: mocks.mockGetWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

describe('moveWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    mocks.mockUpdateWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getMoveWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('move-workbook');
    expect(tool.minRequiredRole).toBe(SiteRole.EXPLORER_CAN_PUBLISH);
    expect(tool.description).toContain('Moves');
    expect(paramsSchema).toMatchObject({
      workbookId: expect.any(Object),
      projectId: expect.any(Object),
    });
    expect(annotations.readOnlyHint).toBe(false);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(true);
    expect(paramsSchema.workbookId.safeParse('').success).toBe(false);
    expect(paramsSchema.projectId.safeParse('').success).toBe(false);
  });

  it('requires at least Explorer Can Publish role', () => {
    const tool = getMoveWorkbookTool(new WebMcpServer());
    expect(tool.minRequiredRole).toBe(SiteRole.EXPLORER_CAN_PUBLISH);
  });

  it('is enabled when the data-apps flag is ON', async () => {
    const tool = getMoveWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('data-apps');
  });

  it('is enabled when the data-apps flag is ON and there is no OAuth client id (stdio)', async () => {
    const tool = getMoveWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the data-apps feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getMoveWorkbookTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('moves the workbook to the destination project and returns the updated workbook', async () => {
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockUpdateWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      id: mockWorkbook.id,
      name: mockWorkbook.name,
      projectId: 'target-project-id',
    });
  });

  it('returns a workbook-not-allowed error and does not call updateWorkbook when the workbook is outside the bounded context', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not allowed');
    expect(mocks.mockUpdateWorkbook).not.toHaveBeenCalled();
  });

  it('returns a project-not-allowed error and does not call updateWorkbook when the destination project is outside the bounded context', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', mockWorkbook.project.id);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target-project-id');
    expect(result.content[0].text).toContain('not allowed by this MCP server');
    expect(mocks.mockUpdateWorkbook).not.toHaveBeenCalled();
  });

  it('moves the workbook when both the source and destination projects are inside the bounded context', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', `${mockWorkbook.project.id},target-project-id`);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockUpdateWorkbook).toHaveBeenCalledTimes(1);
  });

  it('returns an error when Tableau rejects the move', async () => {
    mocks.mockUpdateWorkbook.mockRejectedValue(new Error('API Error'));

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      projectId: 'target-project-id',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });
});

async function getToolResult(params: {
  workbookId: string;
  projectId: string;
}): Promise<CallToolResult> {
  const tool = getMoveWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
