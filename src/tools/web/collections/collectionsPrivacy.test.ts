import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getTableauServerInfo } from '../../../getTableauServerInfo.js';
import {
  setNotificationLevel,
  shouldNotifyWhenLevelIsAtLeast,
} from '../../../logging/notification.js';
import { useRestApi } from '../../../restApiInstance.js';
import fixtures from '../../../sdks/tableau/fixtures/collections.json';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  getRequestOverridesFromHeader,
  X_TABLEAU_MCP_CONFIG_HEADER,
} from '../../../server/requestUtils.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { axios, AxiosRequestConfig } from '../../../utils/axios.js';
import { getConfigWithOverrides } from '../../../utils/mcpSiteSettings.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAddCollectionItemsTool } from './addCollectionItems.js';
import { getQuietCollectionsExtra } from './collectionsUtils.js';
import { getCreateCollectionTool } from './createCollection.js';
import { getListCollectionItemsTool } from './listCollectionItems.js';
import { getListCollectionsTool } from './listCollections.js';
import { getRemoveCollectionItemsTool } from './removeCollectionItems.js';

// Exercise actual auth lifecycle, resource checker, guarded SDK adapters, and default-debug notifier.
vi.unmock('../../../sdks/tableau/restApi.js');
vi.unmock('../../../restApiInstance.js');
vi.unmock('../resourceAccessChecker.js');
vi.mock('../../../getTableauServerInfo.js', () => ({ getTableauServerInfo: vi.fn() }));

const privateSentinel = 'PRIVATE_DENIED_COLLECTION_SENTINEL';
const allowedProject = '77777777-7777-4777-8777-777777777777';
const deniedProject = '88888888-8888-4888-8888-888888888888';
const member = { contentLuid: '22222222-2222-4222-8222-222222222222', contentType: 'workbook' };
const savedAdapter = axios.defaults.adapter;
let sequence = 0;
let extra: TableauWebRequestHandlerExtra;
let requests: string[];
let siteSettings: Array<{ key: string; value: string }>;
let responseHeaders: Record<string, string>;
let collectionResponse: Record<string, unknown>;
let pageResponse: Record<string, unknown>;
let memberResponse: Record<string, unknown>;
let mutationResponse: Record<string, unknown>;

async function call<S extends z.ZodRawShape>(
  tool: WebTool<S>,
  args: z.infer<z.ZodObject<S>>,
): Promise<CallToolResult> {
  const callback = await Provider.from(tool.callback);
  return await callback(args, extra);
}
function notifications(): string {
  return JSON.stringify(vi.mocked(extra.server.mcpServer.server.notification).mock.calls);
}
function noPrivateDetails(result: CallToolResult): void {
  expect(JSON.stringify(result)).not.toContain(privateSentinel);
  expect(notifications()).not.toContain(privateSentinel);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  stubDefaultEnvVars();
  vi.stubEnv('SITE_NAME', `collections-privacy-${sequence++}`);
  vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'true');
  vi.stubEnv('ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES', 'true');
  RestApi.host = 'https://my-tableau-server.com';
  RestApi.version = '3.29';
  vi.mocked(getTableauServerInfo).mockResolvedValue({
    restApiVersion: '3.29',
    productVersion: { value: '2026.2.0', build: 'release' },
  });
  extra = getMockRequestHandlerExtra();
  setNotificationLevel(extra.server.mcpServer, 'debug', { silent: true });
  requests = [];
  siteSettings = [{ key: 'UNRELATED_METADATA', value: privateSentinel }];
  responseHeaders = { 'content-type': 'application/json' };
  collectionResponse = { collection: { ...fixtures.create, name: privateSentinel } };
  pageResponse = {
    ...fixtures.page,
    items: [
      { ...fixtures.create, name: 'Allowed summary' },
      { ...fixtures.create, name: privateSentinel },
    ],
  };
  memberResponse = {
    workbook: {
      id: member.contentLuid,
      name: privateSentinel,
      contentUrl: 'private',
      project: { id: deniedProject, name: privateSentinel },
      showTabs: false,
      tags: { tag: [] },
    },
  };
  mutationResponse = { response: 1 };
  const adapter: AxiosRequestConfig['adapter'] = async (config) => {
    const url = config.url ?? '';
    requests.push(url);
    let data: unknown;
    if (url === '/auth/signin')
      data = {
        credentials: {
          site: { id: fixtures.create.siteId },
          user: { id: fixtures.create.userId },
          token: 'synthetic-test-token',
        },
      };
    else if (url === '/auth/signout') data = undefined;
    else if (url.endsWith('/settings/mcp')) data = { mcpSiteSettings: { settings: siteSettings } };
    else if (url.endsWith(`/workbooks/${member.contentLuid}`)) data = memberResponse;
    else if (url === '/collections' && config.method === 'get') data = pageResponse;
    else if (url === '/collections' && config.method === 'post')
      data = { ...fixtures.create, name: { private: privateSentinel } };
    else if (url === `/collections/${fixtures.create.luid}`) data = collectionResponse;
    else if (url.endsWith('/items') && config.method === 'get') data = pageResponse;
    else if (url.endsWith('/batchCreate') || url.endsWith('/batchDelete')) data = mutationResponse;
    else throw new Error('Unexpected mock endpoint; no network adapter is available.');
    return {
      data,
      status: 200,
      statusText: 'OK',
      headers: url === '/auth/signout' ? {} : responseHeaders,
      config,
    };
  };
  axios.defaults.adapter = adapter;
});
afterEach(() => {
  axios.defaults.adapter = savedAdapter;
  vi.unstubAllEnvs();
});

describe('Collections request-local default-debug privacy', () => {
  it('withholds a denied member before batch execution without silencing tool notifications', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', allowedProject);
    extra = getMockRequestHandlerExtra();
    const result = await call(getAddCollectionItemsTool(extra.server), {
      collectionId: fixtures.create.luid,
      items: [member],
    });
    expect(result.isError).toBe(true);
    expect(requests).toContain(`/sites/${fixtures.create.siteId}/workbooks/${member.contentLuid}`);
    expect(requests.some((url) => url.endsWith('/batchCreate'))).toBe(false);
    noPrivateDetails(result);
    expect(notifications()).toContain('add-collection-items');
  });
  it('withholds malformed denied-member schema details from checker denial messages', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', allowedProject);
    extra = getMockRequestHandlerExtra();
    memberResponse = { workbook: { name: { private: privateSentinel } } };
    const result = await call(getAddCollectionItemsTool(extra.server), {
      collectionId: fixtures.create.luid,
      items: [member],
    });
    expect(result.isError).toBe(true);
    noPrivateDetails(result);
    expect(requests.some((url) => url.endsWith('/batchCreate'))).toBe(false);
  });
  it('withholds another owner’s collection metadata before rejecting membership', async () => {
    collectionResponse = {
      collection: { ...fixtures.create, userId: member.contentLuid, name: privateSentinel },
    };
    const result = await call(getAddCollectionItemsTool(extra.server), {
      collectionId: fixtures.create.luid,
      items: [member],
    });
    expect(result.isError).toBe(true);
    noPrivateDetails(result);
    expect(requests.some((url) => url.endsWith('/batchCreate'))).toBe(false);
  });
  it('withholds malformed owner metadata before rejection', async () => {
    collectionResponse = { collection: { name: { private: privateSentinel } } };
    const result = await call(getAddCollectionItemsTool(extra.server), {
      collectionId: fixtures.create.luid,
      items: [member],
    });
    expect(result.isError).toBe(true);
    noPrivateDetails(result);
  });
  it.each(['collections', 'items'] as const)(
    'never notifies the raw %s page before the result limit',
    async (kind) => {
      vi.stubEnv('MAX_RESULT_LIMIT', '1');
      extra = getMockRequestHandlerExtra();
      const result =
        kind === 'collections'
          ? await call(getListCollectionsTool(extra.server), { pageSize: 100 })
          : await call(getListCollectionItemsTool(extra.server), {
              collectionId: fixtures.create.luid,
              pageSize: 100,
            });
      expect(result.isError).toBe(false);
      noPrivateDetails(result);
      expect(JSON.stringify(result)).toContain('Allowed summary');
    },
  );
  it.each<Record<string, string>>([
    {},
    { 'content-type': 'application/json' },
    { 'content-type': 'text/plain' },
  ])('withholds malformed list bodies with headers %s', async (headers) => {
    responseHeaders = headers;
    pageResponse = { items: privateSentinel };
    const result = await call(getListCollectionsTool(extra.server), {});
    expect(result.isError).toBe(true);
    noPrivateDetails(result);
  });
  it('reports possible creation without raw malformed write details or retry', async () => {
    const result = await call(getCreateCollectionTool(extra.server), { name: 'Review' });
    expect(result.isError).toBe(true);
    noPrivateDetails(result);
    expect(JSON.stringify(result)).toContain('creation may have occurred');
    expect(requests.filter((url) => url === '/collections')).toHaveLength(1);
  });
  it.each(['add', 'remove'] as const)(
    'reports possible %s membership without leaking write validation details',
    async (action) => {
      mutationResponse = { response: privateSentinel };
      const result =
        action === 'add'
          ? await call(getAddCollectionItemsTool(extra.server), {
              collectionId: fixtures.create.luid,
              items: [member],
            })
          : await call(getRemoveCollectionItemsTool(extra.server), {
              collectionId: fixtures.create.luid,
              items: [member],
            });
      expect(result.isError).toBe(true);
      noPrivateDetails(result);
      expect(JSON.stringify(result)).toContain('membership changes may have occurred');
      expect(
        requests.filter((url) => url.endsWith('/batchCreate') || url.endsWith('/batchDelete')),
      ).toHaveLength(1);
    },
  );
  it('keeps exact site/request override, cache and identity semantics in quiet config probes', async () => {
    vi.stubEnv('INCLUDE_PROJECT_IDS', `${allowedProject},${deniedProject}`);
    vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'INCLUDE_PROJECT_IDS,MAX_RESULT_LIMIT');
    siteSettings.push(
      { key: 'INCLUDE_PROJECT_IDS', value: `${allowedProject},${deniedProject}` },
      { key: 'MAX_RESULT_LIMIT', value: '5' },
    );
    const header = `INCLUDE_PROJECT_IDS=${allowedProject}&MAX_RESULT_LIMIT=2`;
    extra = getMockRequestHandlerExtra({
      requestInfo: { headers: { [X_TABLEAU_MCP_CONFIG_HEADER]: header } },
    });
    const quiet = getQuietCollectionsExtra(extra);
    const actual = await quiet.getConfigWithOverrides();
    const expected = await getConfigWithOverrides({
      restApiArgs: extra,
      requestOverrides: getRequestOverridesFromHeader(header),
    });
    expect(actual.boundedContext).toEqual(expected.boundedContext);
    expect(actual.boundedContext.projectIds).toEqual(new Set([allowedProject]));
    expect(actual.getMaxResultLimit('list-collections')).toBe(2);
    expect(actual.getMaxResultLimit('list-collections')).toBe(
      expected.getMaxResultLimit('list-collections'),
    );
    expect(requests.filter((url) => url.endsWith('/settings/mcp'))).toHaveLength(1);
    expect(extra.getConfigWithOverrides).not.toHaveBeenCalled();
    for (const key of [
      'config',
      'server',
      'signal',
      'tableauAuthInfo',
      'getSiteLuid',
      'getUserLuid',
      'setSiteLuid',
      'setUserLuid',
    ] as const)
      expect(quiet[key]).toBe(extra[key]);
    expect(notifications()).not.toContain(privateSentinel);
  });
  it('keeps restrictive request overrides enforced', async () => {
    vi.stubEnv('ALLOWED_REQUEST_OVERRIDES', 'MAX_RESULT_LIMIT');
    siteSettings.push({ key: 'MAX_RESULT_LIMIT', value: '5' });
    extra = getMockRequestHandlerExtra({
      requestInfo: { headers: { [X_TABLEAU_MCP_CONFIG_HEADER]: 'MAX_RESULT_LIMIT=10' } },
    });
    await expect(getQuietCollectionsExtra(extra).getConfigWithOverrides()).rejects.toThrow(
      'restricted',
    );
  });
  it('leaves default-debug raw notifications and masking unchanged for other callers', async () => {
    expect(shouldNotifyWhenLevelIsAtLeast('debug')).toBe(true);
    expect(getConfig().disableLogMasking).toBe(false);
    await useRestApi({
      ...extra,
      jwtScopes: ['tableau:collections:read'],
      callback: async (restApi) =>
        await restApi.collectionsMethods.getCollection(fixtures.create.luid),
    });
    expect(notifications()).toContain(privateSentinel);
    expect(notifications()).not.toContain('synthetic-test-token');
    expect(notifications()).toContain('redacted');
  });
});
