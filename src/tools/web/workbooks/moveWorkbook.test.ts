import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AxiosError } from 'axios';

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
  mockGetPersonalSpace: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        updateWorkbook: mocks.mockUpdateWorkbook,
        getWorkbook: mocks.mockGetWorkbook,
      },
      personalSpaceMethods: {
        getPersonalSpace: mocks.mockGetPersonalSpace,
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
    mocks.mockGetPersonalSpace.mockResolvedValue({
      luid: 'personal-space-luid',
      ownerLuid: 'owner-luid',
      readOnly: false,
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
      personalSpace: expect.any(Object),
    });
    expect(annotations.readOnlyHint).toBe(false);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(true);
    expect(paramsSchema.workbookId.safeParse('').success).toBe(false);
    expect(paramsSchema.projectId.safeParse('').success).toBe(false);
    expect(paramsSchema.projectId.safeParse(undefined).success).toBe(true);
    expect(paramsSchema.personalSpace.safeParse(true).success).toBe(true);
    expect(paramsSchema.personalSpace.safeParse('personal-space-luid').success).toBe(false);
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
    expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toEqual({
      id: mockWorkbook.id,
      name: mockWorkbook.name,
      location: { id: 'target-project-id', type: 'Project' },
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

  describe('personalSpace', () => {
    beforeEach(() => {
      mocks.mockUpdateWorkbook.mockResolvedValue({
        ...mockWorkbook,
        project: undefined,
        location: { id: 'personal-space-luid', type: 'PersonalSpace' },
      });
    });

    it('moves the workbook into the caller Personal Space', async () => {
      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(false);
      expect(mocks.mockGetPersonalSpace).toHaveBeenCalledWith({ siteId: 'test-site-id' });
      expect(mocks.mockUpdateWorkbook).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        workbookId: mockWorkbook.id,
        location: 'personal-space-luid',
      });
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text)).toEqual({
        id: mockWorkbook.id,
        name: mockWorkbook.name,
        location: { type: 'PersonalSpace', id: 'personal-space-luid' },
      });
    });

    it.each([
      [
        'both projectId and personalSpace',
        { projectId: 'target-project-id', personalSpace: true },
        'accepts only one of projectId or personalSpace: true, not both',
      ],
      ['neither projectId nor personalSpace', {}, 'requires one of projectId or personalSpace'],
      [
        'personalSpace false without projectId',
        { personalSpace: false },
        'requires one of projectId or personalSpace',
      ],
    ])('rejects %s', async (_, args, expected) => {
      const result = await getToolResult({ workbookId: mockWorkbook.id, ...args });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(expected);
      expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
      expect(mocks.mockUpdateWorkbook).not.toHaveBeenCalled();
    });

    it('moves to the project when personalSpace is explicitly false', async () => {
      const result = await getToolResult({
        workbookId: mockWorkbook.id,
        projectId: 'target-project-id',
        personalSpace: false,
      });

      expect(result.isError).toBe(false);
      expect(mocks.mockGetPersonalSpace).not.toHaveBeenCalled();
      expect(mocks.mockUpdateWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'target-project-id' }),
      );
    });

    it('errors without moving when Personal Space is read-only', async () => {
      mocks.mockGetPersonalSpace.mockResolvedValue({
        luid: 'personal-space-luid',
        ownerLuid: 'owner-luid',
        readOnly: true,
      });

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('read-only and cannot be used as a move target');
      expect(result.content[0].text).toContain('pass projectId');
      expect(mocks.mockUpdateWorkbook).not.toHaveBeenCalled();
    });

    it('errors without moving when Personal Space cannot be resolved', async () => {
      mocks.mockGetPersonalSpace.mockRejectedValue(new Error('404 personalSpace not found'));

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Could not resolve your Personal Space for moving');
      expect(result.content[0].text).toContain('404 personalSpace not found');
      expect(mocks.mockUpdateWorkbook).not.toHaveBeenCalled();
    });

    it('is exempt from the bounded project context for the destination', async () => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', mockWorkbook.project.id);

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateWorkbook).toHaveBeenCalledTimes(1);
    });

    it('errors when the workbook lands somewhere other than Personal Space', async () => {
      mocks.mockUpdateWorkbook.mockResolvedValue({
        ...mockWorkbook,
        project: { id: 'default-project-id', name: 'Default' },
        location: { id: 'default-project-id', type: 'Project' },
      });

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('"Default" project instead of your personal space');
    });

    it('maps the site-disabled personal-space error to a clean message', async () => {
      const axiosError = new AxiosError('Request failed with status code 400');
      axiosError.response = {
        status: 400,
        data: {
          error: {
            code: '400000',
            detail:
              'Payload is either malformed or incomplete. (0x5CE10192 : Moving a workbook to personal space is not enabled for this site.)',
          },
        },
      } as AxiosError['response'];
      mocks.mockUpdateWorkbook.mockRejectedValue(axiosError);

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Moving content into Personal Space is not enabled for this Tableau site. Move it to a ' +
          'project instead by passing projectId, or ask a site administrator.',
      );
    });

    it('errors when the update response has no location', async () => {
      mocks.mockUpdateWorkbook.mockResolvedValue({
        ...mockWorkbook,
        project: undefined,
        location: undefined,
      });

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('a project instead of your personal space');
    });

    it.each([
      [
        'a 400000 without a personal-space detail',
        400,
        { code: '400000', detail: 'Payload is either malformed or incomplete.' },
        'Request failed with status code 400',
      ],
      [
        'a 403',
        403,
        { code: '403004', detail: 'You do not have permission to move this workbook.' },
        'Permission denied (403)',
      ],
    ])('surfaces %s via the generic error handler', async (_, status, error, expected) => {
      const axiosError = new AxiosError(`Request failed with status code ${status}`);
      axiosError.response = { status, data: { error } } as AxiosError['response'];
      mocks.mockUpdateWorkbook.mockRejectedValue(axiosError);

      const result = await getToolResult({ workbookId: mockWorkbook.id, personalSpace: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('not enabled for this Tableau site');
      expect(result.content[0].text).toContain(expected);
    });
  });
});

async function getToolResult(params: {
  workbookId: string;
  projectId?: string;
  personalSpace?: boolean;
}): Promise<CallToolResult> {
  const tool = getMoveWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      workbookId: params.workbookId,
      projectId: params.projectId,
      personalSpace: params.personalSpace,
    },
    getMockRequestHandlerExtra(),
  );
}
