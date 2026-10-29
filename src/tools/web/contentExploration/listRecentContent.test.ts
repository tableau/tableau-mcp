import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { setNotificationLevel } from '../../../logging/notification.js';
import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { RecentContent } from '../../../sdks/tableau/types/recentContent.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting, resourceAccessChecker } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockView, mockView2 } from '../views/mockView.js';
import { mockWorkbook, mockWorkbook2 } from '../workbooks/mockWorkbook.js';
import { getListRecentContentTool } from './listRecentContent.js';

const mocks = vi.hoisted(() => ({
  getRecentlyViewedForSite: vi.fn(),
  getView: vi.fn(),
  getWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(async ({ callback }) =>
    callback({
      siteId: 'authenticated-site',
      recentContentMethods: { getRecentlyViewedForSite: mocks.getRecentlyViewedForSite },
      viewsMethods: { getView: mocks.getView },
      workbooksMethods: { getWorkbook: mocks.getWorkbook },
    }),
  ),
}));

// The tool receives the recent endpoint's metadata, not the richer detail responses the access
// checker may fetch. ID-only projects must remain intact without enriching or regrouping rows.
const recentView = {
  view: {
    id: mockView.id,
    name: mockView.name,
    contentUrl: mockView.contentUrl,
    project: { id: mockView.project.id },
    workbook: { id: mockView.workbook.id },
    createdAt: mockView.createdAt,
    updatedAt: mockView.updatedAt,
  },
};
const recentWorkbook = {
  workbook: {
    id: mockWorkbook.id,
    name: mockWorkbook.name,
    contentUrl: mockWorkbook.contentUrl,
    project: { id: mockWorkbook.project.id },
  },
};
const recentView2 = { view: { ...recentView.view, id: mockView2.id } };
const recentWorkbook2 = { workbook: { ...recentWorkbook.workbook, id: mockWorkbook2.id } };

async function callTool(
  params: { limit?: number } = {},
  config = new OverridableConfig({}),
): Promise<CallToolResult> {
  const tool = getListRecentContentTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { limit: params.limit },
    getMockRequestHandlerExtra({ getConfigWithOverrides: vi.fn().mockResolvedValue(config) }),
  );
}

function parseResult(result: CallToolResult): RecentContent[] {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

describe('list-recent-content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetResourceAccessCheckerSingleton();
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(true);
    mocks.getRecentlyViewedForSite.mockResolvedValue([recentWorkbook, recentView, recentWorkbook2]);
    mocks.getView.mockImplementation(async ({ viewId }) =>
      viewId === mockView.id ? mockView : mockView2,
    );
    mocks.getWorkbook.mockImplementation(async ({ workbookId }) =>
      workbookId === mockWorkbook.id ? mockWorkbook : mockWorkbook2,
    );
  });

  it('declares only optional limit and read-only Viewer annotations', async () => {
    const tool = getListRecentContentTool(new WebMcpServer());
    expect(tool.name).toBe('list-recent-content');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    const schema = await Provider.from(tool.paramsSchema);
    expect(Object.keys(schema)).toEqual(['limit']);
    expect(z.object(schema).parse({})).toEqual({});
    expect(await Provider.from(tool.annotations)).toEqual({
      title: 'List Recent Content',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.requiredApiScopes).toEqual([
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
    ]);
  });

  it.each([0, -1, 25, 1.5, '1', null])(
    'rejects invalid limit %j in the input schema',
    async (limit) => {
      const schema = await Provider.from(getListRecentContentTool(new WebMcpServer()).paramsSchema);
      expect(z.object(schema).safeParse({ limit }).success).toBe(false);
    },
  );

  it.each([1, 24])('accepts limit boundary %i', async (limit) => {
    const schema = await Provider.from(getListRecentContentTool(new WebMcpServer()).paramsSchema);
    expect(z.object(schema).parse({ limit })).toEqual({ limit });
  });

  it('preserves mixed backend order and metadata', async () => {
    expect(parseResult(await callTool())).toEqual([recentWorkbook, recentView, recentWorkbook2]);
    expect(mocks.getRecentlyViewedForSite).toHaveBeenCalledExactlyOnceWith({
      siteId: 'authenticated-site',
    });
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:content:read'],
      }),
    );
  });

  it('returns an empty successful array when no recent items exist', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([]);
    expect(parseResult(await callTool())).toEqual([]);
  });

  it('uses only content-read scope on the primary request while retaining checker scopes', async () => {
    await callTool({}, new OverridableConfig({ INCLUDE_PROJECT_IDS: mockView.project.id }));
    const [primary, ...probes] = vi.mocked(useRestApi).mock.calls;
    expect(primary[0].jwtScopes).toEqual(['tableau:content:read']);
    expect(probes.length).toBeGreaterThan(0);
    for (const [probe] of probes) {
      expect(probe.jwtScopes).toEqual(['tableau:content:read', 'tableau:mcp_site_settings:read']);
      expect(probe.disableLogging).toBe(true);
    }
  });

  it('checks every returned row through its matching access-checker rule', async () => {
    const viewCheck = vi.spyOn(resourceAccessChecker, 'isViewAllowed');
    const workbookCheck = vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed');
    await callTool({ limit: 1 });
    expect(viewCheck).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ viewId: recentView.view.id }),
    );
    expect(workbookCheck).toHaveBeenCalledTimes(2);
  });

  it('applies workbook restrictions to both workbook and view rows before caller limit', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([
      recentWorkbook2,
      recentView2,
      recentView,
      recentWorkbook,
    ]);
    expect(
      parseResult(
        await callTool(
          { limit: 1 },
          new OverridableConfig({ INCLUDE_WORKBOOK_IDS: mockWorkbook.id }),
        ),
      ),
    ).toEqual([recentView]);
  });

  it('applies project restrictions before configured result limits', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([
      recentWorkbook2,
      recentView2,
      recentView,
      recentWorkbook,
    ]);
    expect(
      parseResult(
        await callTool(
          {},
          new OverridableConfig({
            INCLUDE_PROJECT_IDS: mockView.project.id,
            MAX_RESULT_LIMIT: '1',
          }),
        ),
      ),
    ).toEqual([recentView]);
  });

  it('applies view restrictions only to views according to existing resource rules', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([recentView2, recentWorkbook, recentView]);
    expect(
      parseResult(await callTool({}, new OverridableConfig({ INCLUDE_VIEW_IDS: mockView.id }))),
    ).toEqual([recentWorkbook, recentView]);
  });

  it('applies tag restrictions using current detail responses', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([recentWorkbook, recentView]);
    expect(
      parseResult(await callTool({}, new OverridableConfig({ INCLUDE_TAGS: 'missing-tag' }))),
    ).toEqual([]);
    expect(mocks.getView).toHaveBeenCalled();
    expect(mocks.getWorkbook).toHaveBeenCalled();
  });

  it('fails closed when a resource restriction cannot be checked', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue([recentWorkbook, recentView]);
    mocks.getView.mockRejectedValue(new Error('Detail lookup unavailable'));
    mocks.getWorkbook.mockRejectedValue(new Error('Detail lookup unavailable'));
    expect(
      parseResult(
        await callTool({}, new OverridableConfig({ INCLUDE_PROJECT_IDS: mockView.project.id })),
      ),
    ).toEqual([]);
  });

  it('uses the smaller of caller and tool-specific limits', async () => {
    expect(
      parseResult(
        await callTool(
          { limit: 2 },
          new OverridableConfig({ MAX_RESULT_LIMITS: 'list-recent-content:1' }),
        ),
      ),
    ).toEqual([recentWorkbook]);
    expect(
      parseResult(await callTool({ limit: 1 }, new OverridableConfig({ MAX_RESULT_LIMIT: '2' }))),
    ).toEqual([recentWorkbook]);
  });

  it('defaults to at most 24 results', async () => {
    mocks.getRecentlyViewedForSite.mockResolvedValue(Array.from({ length: 25 }, () => recentView));
    expect(parseResult(await callTool())).toHaveLength(24);
  });

  it('does not invent access timestamps from content timestamps', async () => {
    const result = await callTool();
    const entries = parseResult(result);
    expect(entries[1]).toEqual(recentView);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('lastViewed');
  });

  it('propagates API failures through the shared error funnel', async () => {
    mocks.getRecentlyViewedForSite.mockRejectedValue(new Error('Recent API unavailable'));
    const result = await callTool();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Recent API unavailable');
  });

  it('rejects older API versions before requesting recent content', async () => {
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(false);
    const result = await callTool();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('version 3.5 or later');
    expect(RestApi.versionIsAtLeast).toHaveBeenCalledWith('3.5');
    expect(mocks.getRecentlyViewedForSite).not.toHaveBeenCalled();
  });

  it('rejects malformed rows without exposing raw metadata or checking resources', async () => {
    const viewCheck = vi.spyOn(resourceAccessChecker, 'isViewAllowed');
    mocks.getRecentlyViewedForSite.mockResolvedValue([
      recentView,
      { ...recentWorkbook, view: { ...recentView.view, name: 'private-unfiltered-name' } },
    ]);
    const result = await callTool();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('invalid recent-content response');
    expect(result.content[0].text).not.toContain('private-unfiltered-name');
    expect(viewCheck).not.toHaveBeenCalled();
  });

  it('does not notify raw denied, limit-trimmed, or unsupported rows at debug level', async () => {
    const actual = await vi.importActual<typeof import('../../../restApiInstance.js')>(
      '../../../restApiInstance.js',
    );
    // Model the real raw-response notification hook. If any primary or nested REST call omits
    // disableLogging, the actual debug notifier exposes the fixture and this test fails.
    vi.mocked(useRestApi).mockImplementation(async (args) => {
      if (!args.disableLogging) {
        actual.getResponseInterceptor(
          args.server,
          args.requestId,
        )({
          status: 200,
          baseUrl: 'https://tableau.example/api/3.24',
          url: '/sites/authenticated-site/content/recent',
          params: {},
          headers: {},
          data: {
            denied: 'private-denied-name',
            trimmed: 'private-trimmed-name',
            unsupported: 'private-unsupported-name',
          },
        });
      }
      return await args.callback({
        siteId: 'authenticated-site',
        recentContentMethods: { getRecentlyViewedForSite: mocks.getRecentlyViewedForSite },
        viewsMethods: { getView: mocks.getView },
        workbooksMethods: { getWorkbook: mocks.getWorkbook },
      } as unknown as RestApi);
    });
    const server = new WebMcpServer();
    setNotificationLevel(server.mcpServer, 'debug', { silent: true });
    const callback = await Provider.from(getListRecentContentTool(server).callback);
    const extra = getMockRequestHandlerExtra({
      server,
      getConfigWithOverrides: vi
        .fn()
        .mockResolvedValue(new OverridableConfig({ INCLUDE_PROJECT_IDS: mockView.project.id })),
    });
    mocks.getRecentlyViewedForSite.mockResolvedValue([recentWorkbook2, recentView, recentWorkbook]);
    expect(parseResult(await callback({ limit: 1 }, extra))).toEqual([recentView]);
    expect(mocks.getView).toHaveBeenCalled();
    expect(mocks.getWorkbook).toHaveBeenCalled();
    for (const [args] of vi.mocked(useRestApi).mock.calls) {
      expect(args.disableLogging).toBe(true);
    }

    mocks.getRecentlyViewedForSite.mockResolvedValue([
      { flow: { name: 'private-unsupported-name' } },
    ]);
    expect((await callback({ limit: undefined }, extra)).isError).toBe(true);
    const notifications = JSON.stringify(
      vi.mocked(server.mcpServer.server.notification).mock.calls,
    );
    expect(notifications).not.toContain('private-denied-name');
    expect(notifications).not.toContain('private-trimmed-name');
    expect(notifications).not.toContain('private-unsupported-name');
    // Ordinary WebTool invocation notifications still use the unmodified server/context.
    expect(server.mcpServer.server.notification).toHaveBeenCalled();
  });

  it('rejects unsafe backend resource IDs before any resource check', async () => {
    const viewCheck = vi.spyOn(resourceAccessChecker, 'isViewAllowed');
    const workbookCheck = vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed');
    mocks.getRecentlyViewedForSite.mockResolvedValue([
      { view: { ...recentView.view, id: '../workbooks/unsafe' } },
    ]);
    const result = await callTool();
    expect(result.isError).toBe(true);
    expect(viewCheck).not.toHaveBeenCalled();
    expect(workbookCheck).not.toHaveBeenCalled();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('../workbooks/unsafe');
  });
});
