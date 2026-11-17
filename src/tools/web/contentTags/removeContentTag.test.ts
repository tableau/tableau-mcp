import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';
import { AxiosError } from 'axios';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as accessCheckerTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { ContentTagResourceType } from './contentTags.js';
import { getRemoveContentTagTool } from './removeContentTag.js';

const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const mocks = vi.hoisted(() => ({
  mutateWorkbook: vi.fn(),
  mutateView: vi.fn(),
  mutateDatasource: vi.fn(),
  getWorkbook: vi.fn(),
  getView: vi.fn(),
  queryDatasource: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-id',
      workbooksMethods: {
        deleteTagFromWorkbook: mocks.mutateWorkbook,
        getWorkbook: mocks.getWorkbook,
      },
      viewsMethods: { deleteTagFromView: mocks.mutateView, getView: mocks.getView },
      datasourcesMethods: {
        deleteTagFromDatasource: mocks.mutateDatasource,
        queryDatasource: mocks.queryDatasource,
      },
    }),
  ),
}));

const resourceTypes = ['workbook', 'view', 'datasource'] as const;
const mutators = {
  workbook: mocks.mutateWorkbook,
  view: mocks.mutateView,
  datasource: mocks.mutateDatasource,
};
const idArgs = { workbook: 'workbookId', view: 'viewId', datasource: 'datasourceId' };

async function invoke(
  resourceType: ContentTagResourceType,
  labels: string,
  resourceId = RESOURCE_ID,
): Promise<CallToolResult> {
  const tool = getRemoveContentTagTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { resourceType, resourceId, tagLabel: labels },
    getMockRequestHandlerExtra(),
  );
}

function text(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

describe('remove-content-tag', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    accessCheckerTesting.resetResourceAccessCheckerSingleton();
    const content = {
      id: RESOURCE_ID,
      project: { id: PROJECT_ID },
      tags: { tag: [{ label: 'allowed' }, { label: 'unrelated' }] },
    };
    mocks.getWorkbook.mockResolvedValue(content);
    mocks.getView.mockResolvedValue({ ...content, workbook: { id: RESOURCE_ID } });
    mocks.queryDatasource.mockResolvedValue(content);
    vi.mocked(useRestApi).mockImplementation(async ({ callback }) =>
      callback({
        siteId: 'site-id',
        workbooksMethods: {
          deleteTagFromWorkbook: mocks.mutateWorkbook,
          getWorkbook: mocks.getWorkbook,
        },
        viewsMethods: { deleteTagFromView: mocks.mutateView, getView: mocks.getView },
        datasourcesMethods: {
          deleteTagFromDatasource: mocks.mutateDatasource,
          queryDatasource: mocks.queryDatasource,
        },
      } as unknown as Parameters<Parameters<typeof useRestApi>[0]['callback']>[0]),
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it('declares a mutation with Viewer registration and typed LUID/resource arguments', async () => {
    const tool = getRemoveContentTagTool(new WebMcpServer());
    expect(tool.name).toBe('remove-content-tag');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    const schema = await Provider.from(tool.paramsSchema);
    for (const id of ['', '../workbooks/x', '%2e%2e', 'not-a-luid'])
      expect(schema.resourceId.safeParse(id).success).toBe(false);
    expect(schema.resourceType.safeParse('flow').success).toBe(false);
    expect(schema.resourceId.safeParse(RESOURCE_ID).success).toBe(true);
  });

  it.each(resourceTypes)(
    'dispatches only to %s with its operation-specific JWT scopes',
    async (resourceType) => {
      const result = await invoke(resourceType, '売上 #1 & Café? 50%');
      expect(result.isError).toBe(false);
      expect(mutators[resourceType]).toHaveBeenCalledExactlyOnceWith({
        siteId: 'site-id',
        [idArgs[resourceType]]: RESOURCE_ID,
        tagLabel: '売上 #1 & Café? 50%',
      });
      for (const other of resourceTypes.filter((type) => type !== resourceType))
        expect(mutators[other]).not.toHaveBeenCalled();
      expect(vi.mocked(useRestApi).mock.calls.at(-1)?.[0].disableLogging).toBe(true);
      expect(vi.mocked(useRestApi).mock.calls.at(-1)?.[0].jwtScopes).toEqual([
        `tableau:${resourceType}_tags:delete`,
      ]);
    },
  );

  it.each(resourceTypes)(
    'rejects %s outside the resource-ID bounded context without REST',
    async (resourceType) => {
      const env = {
        workbook: 'INCLUDE_WORKBOOK_IDS',
        view: 'INCLUDE_VIEW_IDS',
        datasource: 'INCLUDE_DATASOURCE_IDS',
      };
      vi.stubEnv(env[resourceType], '11111111-1111-4111-8111-111111111111');
      const result = await invoke(resourceType, '売上 #1 & Café? 50%');
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('not allowed');
      expect(useRestApi).not.toHaveBeenCalled();
      expect(mutators[resourceType]).not.toHaveBeenCalled();
      for (const [call] of vi.mocked(useRestApi).mock.calls) expect(call.disableLogging).toBe(true);
    },
  );

  it.each(resourceTypes)(
    'rejects %s outside the tag bounded context before mutation',
    async (resourceType) => {
      vi.stubEnv('INCLUDE_TAGS', 'outside');
      const result = await invoke(resourceType, '売上 #1 & Café? 50%');
      expect(result.isError).toBe(true);
      expect(mutators[resourceType]).not.toHaveBeenCalled();
      for (const [call] of vi.mocked(useRestApi).mock.calls) expect(call.disableLogging).toBe(true);
    },
  );

  it.each(resourceTypes)(
    'rejects %s outside the project bounded context before mutation',
    async (resourceType) => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', '11111111-1111-4111-8111-111111111111');
      const result = await invoke(resourceType, '売上 #1 & Café? 50%');
      expect(result.isError).toBe(true);
      expect(mutators[resourceType]).not.toHaveBeenCalled();
      for (const [call] of vi.mocked(useRestApi).mock.calls) expect(call.disableLogging).toBe(true);
    },
  );

  it.each(resourceTypes)(
    'permits %s inside a matching tag/project bounded context',
    async (resourceType) => {
      vi.stubEnv('INCLUDE_PROJECT_IDS', PROJECT_ID);
      vi.stubEnv('INCLUDE_TAGS', 'allowed');
      const result = await invoke(resourceType, '売上 #1 & Café? 50%');
      expect(result.isError).toBe(false);
      expect(mutators[resourceType]).toHaveBeenCalledTimes(1);
      for (const [call] of vi.mocked(useRestApi).mock.calls) expect(call.disableLogging).toBe(true);
    },
  );

  it.each(resourceTypes)(
    'refuses removing the %s tag that grants bounded-context admission',
    async (resourceType) => {
      vi.stubEnv('INCLUDE_TAGS', 'allowed');
      const result = await invoke(resourceType, 'allowed');
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('bounded-context admission policy');
      expect(mutators[resourceType]).not.toHaveBeenCalled();
      expect(useRestApi).not.toHaveBeenCalled();
    },
  );

  it.each([
    'pending-deletion',
    'pending-deletion-2026-10-14',
    'pending-deletion-2026-99-99',
    'pending-deletion-notes',
    'Pending-Deletion-2026-10-14',
    '  PENDING-DELETION  ',
    'pending-deletionUnexpected',
    '%70ending-deletion-2026-10-14',
    '%2570ending-deletion-invalid',
    '%20PENDING-DELETION%20',
  ])('rejects reserved namespace %j before all REST calls', async (label) => {
    vi.stubEnv('INCLUDE_TAGS', 'allowed');
    for (const resourceType of resourceTypes) {
      const result = await invoke(resourceType, label);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('reserved');
    }
    expect(useRestApi).not.toHaveBeenCalled();
  });

  it.each(['', '   ', '\u0000', '\n', '\u007f', '\ud800', 'x'.repeat(257)])(
    'rejects malformed label %j before all REST calls',
    async (label) => {
      const result = await invoke('workbook', label);
      expect(result.isError).toBe(true);
      expect(useRestApi).not.toHaveBeenCalled();
    },
  );

  it('validates LUIDs again for direct callback callers', async () => {
    const result = await invoke('workbook', '売上 #1 & Café? 50%', '../views/x');
    expect(result.isError).toBe(true);
    expect(useRestApi).not.toHaveBeenCalled();
  });

  it.each(resourceTypes)(
    'does not expose malformed %s access-check metadata',
    async (resourceType) => {
      const sentinel = 'SYNTHETIC_DENIED_TAG_METADATA';
      vi.stubEnv('INCLUDE_PROJECT_IDS', PROJECT_ID);
      const readers = {
        workbook: mocks.getWorkbook,
        view: mocks.getView,
        datasource: mocks.queryDatasource,
      };
      readers[resourceType].mockRejectedValue(new ZodiosError(`Malformed response ${sentinel}`));
      const result = await invoke(resourceType, 'safe');
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('access could not be verified');
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(mutators[resourceType]).not.toHaveBeenCalled();
      for (const [call] of vi.mocked(useRestApi).mock.calls) expect(call.disableLogging).toBe(true);
    },
  );

  it('contains malformed mutation responses and warns before any retry', async () => {
    const sentinel = 'SYNTHETIC_EXISTING_TAG_METADATA';
    mocks.mutateWorkbook.mockRejectedValue(new ZodiosError(`Malformed response ${sentinel}`));
    const result = await invoke('workbook', 'safe');
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(
      "Tableau returned an invalid tag-mutation response. The change may already have been applied. Read the resource's tags to verify before retrying.",
    );
    expect(text(result)).toContain('verify before retrying');
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(mocks.mutateWorkbook).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404])('preserves a Tableau %s failure without retry or success', async (status) => {
    const error = new AxiosError(`Request failed with status code ${status}`);
    error.response = {
      status,
      data: {
        error: { code: status === 403 ? '403004' : '404007', detail: 'Synthetic tag error' },
      },
    } as AxiosError['response'];
    mocks.mutateWorkbook.mockRejectedValue(error);
    const result = await invoke('workbook', '売上 #1 & Café? 50%');
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(String(status));
    expect(mocks.mutateWorkbook).toHaveBeenCalledTimes(1);
  });
  it.each(['a/b', 'a\\b', '.', '..', '..;x', '%2f', '%5C', '%2e%2e', '%252e%252e', '%25252F'])(
    'rejects route-unsafe label %j before any REST',
    async (label) => {
      const result = await invoke('view', label);
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('cannot remove');
      expect(useRestApi).not.toHaveBeenCalled();
    },
  );

  it('passes the literal label to the SDK without pre-encoding', async () => {
    const label = "売上 #1; A&B? + !'()* 50%";
    const result = await invoke('datasource', label);
    expect(result.isError).toBe(false);
    expect(mocks.mutateDatasource).toHaveBeenCalledWith({
      siteId: 'site-id',
      datasourceId: RESOURCE_ID,
      tagLabel: label,
    });
  });

  it.each(['literal %41', 'literal %zz', 'Revenue 50%'])(
    'preserves unrelated percent label %j',
    async (label) => {
      const result = await invoke('workbook', label);
      expect(result.isError).toBe(false);
      expect(mocks.mutateWorkbook).toHaveBeenCalledWith({
        siteId: 'site-id',
        workbookId: RESOURCE_ID,
        tagLabel: label,
      });
    },
  );
});
