import * as loggerModule from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  getRequiredScopesForTool,
  RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
} from '../../../server/oauth/scopes.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';
import { getUpdateWorkbookRevisionNotesTool } from './updateWorkbookRevisionNotes.js';

const mocks = vi.hoisted(() => ({
  updateNotes: vi.fn(),
  isWorkbookAllowed: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.isFeatureEnabled })),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: { isWorkbookAllowed: mocks.isWorkbookAllowed },
}));

const args = {
  workbookId: 'a1b2c3d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
  revisionNumber: 2,
  notes: '  Exact replacement\nsecond line.  ',
};

describe('update-workbook-revision-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRestApi).mockImplementation(async ({ callback }) =>
      callback({
        workbooksMethods: { updateWorkbookRevisionNotes: mocks.updateNotes },
        siteId: 'test-site-id',
      } as unknown as Parameters<typeof callback>[0]),
    );
    stubDefaultEnvVars();
    vi.spyOn(RestApi, 'versionIsAtLeast').mockReturnValue(true);
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.isWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.updateNotes.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('registers an ExplorerCanPublish write tool under the workbook write gate and scopes', async () => {
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    expect(webToolFactories).toContain(getUpdateWorkbookRevisionNotesTool);
    expect(tool.name).toBe('update-workbook-revision-notes');
    expect(tool.minRequiredRole).toBe(SiteRole.EXPLORER_CAN_PUBLISH);
    expect(getRequiredScopesForTool(tool.name)).toEqual(['tableau:mcp:workbook:write']);
    expect(tool.requiredApiScopes).toEqual([
      'tableau:workbooks:update',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('data-apps');
    mocks.isFeatureEnabled.mockResolvedValue(false);
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('requires a valid workbook, positive safe integer revision and explicit notes text', async () => {
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.workbookId.safeParse('../other').success).toBe(false);
    for (const value of [0, -1, 1.2, '2', Number.MAX_SAFE_INTEGER + 1]) {
      expect(schema.revisionNumber.safeParse(value).success).toBe(false);
    }
    expect(schema.revisionNumber.safeParse(2).success).toBe(true);
    expect(schema.notes.safeParse(undefined).success).toBe(false);
  });

  it('uses exact input text for one scoped replacement without echoing it in result or tool log', async () => {
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(args, getMockRequestHandlerExtra());
    expect(RestApi.versionIsAtLeast).toHaveBeenCalledWith('3.30');
    expect(mocks.isWorkbookAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ workbookId: args.workbookId }),
    );
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: tool.requiredApiScopes, disableLogging: true }),
    );
    expect(mocks.updateNotes).toHaveBeenCalledExactlyOnceWith({ siteId: 'test-site-id', ...args });
    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        workbookId: args.workbookId,
        revisionNumber: args.revisionNumber,
        updated: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Exact replacement');
    expect(
      vi
        .mocked(loggerModule.log)
        .mock.calls.some(([entry]) => JSON.stringify(entry).includes('Exact replacement')),
    ).toBe(false);
  });

  it('does not leak the submitted text from an HTTP error that retains its body', async () => {
    mocks.updateNotes.mockRejectedValue(
      Object.assign(new Error(args.notes), {
        isAxiosError: true,
        response: { status: 403, data: { notes: args.notes } },
      }),
    );
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(args, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('permissions');
    expect(JSON.stringify(result)).not.toContain('Exact replacement');
    expect(
      vi
        .mocked(loggerModule.log)
        .mock.calls.some(([entry]) => JSON.stringify(entry).includes('Exact replacement')),
    ).toBe(false);
  });

  it('refuses REST versions below 3.30 before contacting the workbook access checker', async () => {
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(false);
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(args, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('3.30 or later');
    expect(mocks.isWorkbookAllowed).not.toHaveBeenCalled();
    expect(mocks.updateNotes).not.toHaveBeenCalled();
  });

  it('never sends a PATCH when bounded-context access is denied', async () => {
    mocks.isWorkbookAllowed.mockResolvedValue({
      allowed: false,
      message: 'Outside allowed context.',
    });
    const tool = getUpdateWorkbookRevisionNotesTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(args, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Outside allowed context.');
    expect(mocks.updateNotes).not.toHaveBeenCalled();
  });
});
