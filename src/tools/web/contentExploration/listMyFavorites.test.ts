import { CallToolResult } from '@modelcontextprotocol/server';
import { Err, Ok } from 'ts-results-es';

import { OverridableConfig } from '../../../overridableConfig.js';
import UsersMethods from '../../../sdks/tableau/methods/usersMethods.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import { getListMyFavoritesTool } from './listMyFavorites.js';

const principal = { site_luid: MOCK_SITE_LUID, user_luid: MOCK_USER_LUID };

const mocks = vi.hoisted(() => ({
  currentSession: vi.fn(),
  session: { siteId: '', userId: '', usersMethods: {}, authenticatedServerMethods: {} },
  request: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn(async ({ callback }) => callback(mocks.session)),
}));

beforeEach(() => {
  mocks.currentSession
    .mockReset()
    .mockResolvedValue(new Ok({ site: { id: MOCK_SITE_LUID }, user: { id: MOCK_USER_LUID } }));
  mocks.request.mockReset();
  mocks.session = {
    siteId: MOCK_SITE_LUID,
    userId: MOCK_USER_LUID,
    authenticatedServerMethods: { getCurrentServerSession: mocks.currentSession },
    usersMethods: new UsersMethods(
      'https://tableau.example/api/3.27',
      { type: 'Bearer', token: 'test' },
      {
        adapter: async (config) => ({
          data: await mocks.request(config),
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      },
    ),
  };
});

async function invoke(
  params = {},
  env = {},
  overrides: Partial<TableauWebRequestHandlerExtra> = {},
): Promise<CallToolResult> {
  const tool = getListMyFavoritesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return callback(
    params,
    getMockRequestHandlerExtra({
      getConfigWithOverrides: async () => new OverridableConfig(env),
      ...overrides,
    }),
  );
}

async function readPage(params = {}, env = {}): Promise<unknown> {
  const result = await invoke(params, env);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

describe('list-my-favorites', () => {
  it('uses the authenticated site and user, requests a native page and returns only content references', async () => {
    mocks.request.mockResolvedValue({
      favorites: {
        favorite: [
          { workbook: { id: 'w', name: 'Private' }, label: 'My label' },
          { view: { id: 'v' } },
          { datasource: { id: 'd' } },
          { project: { id: 'p' } },
          { flow: { id: 'f' } },
          { label: 'Deleted' },
          { metric: { id: 'retired' } },
        ],
      },
      pagination: { pageNumber: '2', pageSize: '7', totalAvailable: '15' },
    });
    expect(
      await readPage({ pageNumber: 2, pageSize: 7, userId: 'other', siteId: 'other' }),
    ).toEqual({
      principal,
      data: [
        { type: 'workbook', luid: 'w' },
        { type: 'view', luid: 'v' },
        { type: 'datasource', luid: 'd' },
        { type: 'project', luid: 'p' },
        { type: 'flow', luid: 'f' },
      ],
      nextPageNumber: 3,
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        method: 'get',
        url: `/sites/${MOCK_SITE_LUID}/favorites/${MOCK_USER_LUID}`,
        params: { pageSize: 7, pageNumber: 2 },
      }),
    );
  });

  it('applies all configured content restrictions and drops unverifiable references', async () => {
    const metadata = { project: { id: 'p' }, tags: { tag: [{ label: 'sales' }] } };
    mocks.request.mockResolvedValue({
      favorites: {
        favorite: [
          { view: { id: 'v', workbook: { id: 'w' }, ...metadata } },
          { view: { id: 'v', workbook: { id: 'other' }, ...metadata } },
          { view: { id: 'other', workbook: { id: 'w' }, ...metadata } },
          { workbook: { id: 'w', ...metadata } },
          { workbook: { id: 'other', ...metadata } },
          { datasource: { id: 'd', ...metadata } },
          { datasource: { id: 'other', ...metadata } },
          { flow: { id: 'f', ...metadata } },
          { flow: { id: 'private', tags: {} } },
          { project: { id: 'p', tags: metadata.tags } },
          { project: { id: 'other', tags: metadata.tags } },
          { workbook: { id: 'w', project: { id: 'p' } } },
        ],
      },
      pagination: { pageSize: 100, pageNumber: 1, totalAvailable: 12 },
    });
    expect(
      await readPage(
        {},
        {
          INCLUDE_PROJECT_IDS: 'p',
          INCLUDE_WORKBOOK_IDS: 'w',
          INCLUDE_VIEW_IDS: 'v',
          INCLUDE_DATASOURCE_IDS: 'd',
          INCLUDE_TAGS: 'sales',
        },
      ),
    ).toEqual({
      principal,
      data: [
        { type: 'view', luid: 'v' },
        { type: 'workbook', luid: 'w' },
        { type: 'datasource', luid: 'd' },
        { type: 'flow', luid: 'f' },
        { type: 'project', luid: 'p' },
      ],
      nextPageNumber: null,
    });
  });

  it('supports responses without pagination and continues past removed or filtered favorites', async () => {
    mocks.request
      .mockResolvedValueOnce({ favorites: { favorite: [{ label: 'deleted' }] } })
      .mockResolvedValueOnce({ favorites: {} });
    expect(await readPage({ pageSize: 1 })).toEqual({ principal, data: [], nextPageNumber: 2 });
    expect(await readPage({ pageSize: 1, pageNumber: 2 })).toEqual({
      principal,
      data: [],
      nextPageNumber: null,
    });
  });

  it('continues after a short permission-filtered native page without a reported total', async () => {
    mocks.request
      .mockResolvedValueOnce({ favorites: { favorite: [{ view: { id: 'visible-a' } }] } })
      .mockResolvedValueOnce({ favorites: { favorite: [{ view: { id: 'visible-b' } }] } })
      .mockResolvedValueOnce({ favorites: {} });
    expect(await readPage({ pageNumber: 1, pageSize: 5 })).toEqual({
      principal,
      data: [{ type: 'view', luid: 'visible-a' }],
      nextPageNumber: 2,
    });
    expect(await readPage({ pageNumber: 2, pageSize: 5 })).toEqual({
      principal,
      data: [{ type: 'view', luid: 'visible-b' }],
      nextPageNumber: 3,
    });
    expect(await readPage({ pageNumber: 3, pageSize: 5 })).toEqual({
      principal,
      data: [],
      nextPageNumber: null,
    });
  });

  it('uses the current Tableau session as the source of both routing identifiers and the returned principal', async () => {
    const siteId = '562cf7ad-15b0-456c-ae26-214803c2343f';
    const userId = '3aa49ef4-fe47-4c56-9d15-bdb36dbdf1d1';
    mocks.currentSession.mockResolvedValueOnce(
      new Ok({ site: { id: siteId }, user: { id: userId } }),
    );
    mocks.request.mockResolvedValueOnce({ favorites: {} });
    expect(await readPage()).toEqual({
      principal: { site_luid: siteId, user_luid: userId },
      data: [],
      nextPageNumber: null,
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: `/sites/${siteId}/favorites/${userId}` }),
    );
  });

  it.each([
    { site: { id: '' }, user: { id: MOCK_USER_LUID } },
    { site: { id: MOCK_SITE_LUID }, user: { id: 'unresolved' } },
  ])('rejects unverifiable Tableau session identifiers', async (session) => {
    mocks.currentSession.mockResolvedValueOnce(new Ok(session));
    expect((await invoke()).isError).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('verifies the native session even beyond the cap and fails closed if verification fails', async () => {
    mocks.currentSession.mockResolvedValueOnce(
      new Err({ type: 'unknown', message: 'Unavailable' }),
    );
    expect((await invoke({ pageNumber: 2, pageSize: 10 }, { MAX_RESULT_LIMIT: '1' })).isError).toBe(
      true,
    );
    expect(mocks.currentSession).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('applies a global cap across native pages', async () => {
    mocks.request.mockResolvedValue({
      favorites: { favorite: [{ view: { id: 'last' } }, { view: { id: 'past cap' } }] },
    });
    const env = { MAX_RESULT_LIMIT: '3' };
    expect(await readPage({ pageNumber: 2, pageSize: 2 }, env)).toEqual({
      principal,
      data: [{ type: 'view', luid: 'last' }],
      nextPageNumber: null,
    });
    expect(await readPage({ pageNumber: 3, pageSize: 2 }, env)).toEqual({
      principal,
      data: [],
      nextPageNumber: null,
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('rejects HTTP calls without a matching authenticated caller, including shared PAT accounts', async () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    const caller = {
      type: 'Bearer' as const,
      username: 'user',
      userId: MOCK_USER_LUID,
      siteId: MOCK_SITE_LUID,
      siteName: 'site',
      server: 'https://tableau.example',
      raw: 'test',
    };
    for (const tableauAuthInfo of [
      undefined,
      { ...caller, userId: 'other' },
      { ...caller, siteId: 'other' },
    ]) {
      expect((await invoke({}, {}, { tableauAuthInfo })).isError).toBe(true);
    }
    mocks.currentSession.mockResolvedValueOnce(
      new Ok({
        site: { id: MOCK_SITE_LUID },
        user: { id: 'b15cfd35-b7c4-43ca-ba61-a3629cad40a2' },
      }),
    );
    expect(
      (
        await invoke(
          { pageNumber: 2, pageSize: 10 },
          { MAX_RESULT_LIMIT: '1' },
          { tableauAuthInfo: caller },
        )
      ).isError,
    ).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('accepts the verified OAuth session user when the bearer token omits its optional user ID', async () => {
    const extra = getMockRequestHandlerExtra();
    const caller = {
      type: 'Bearer' as const,
      username: 'user',
      userId: MOCK_USER_LUID,
      siteId: MOCK_SITE_LUID,
      siteName: 'site',
      server: 'https://tableau.example',
      raw: 'test',
    };
    mocks.session.userId = '';
    mocks.request.mockResolvedValue({ favorites: {} });
    const result = await invoke(
      {},
      {},
      { config: { ...extra.config, auth: 'oauth', transport: 'http' }, tableauAuthInfo: caller },
    );
    expect(result.isError).toBe(false);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: `/sites/${MOCK_SITE_LUID}/favorites/${MOCK_USER_LUID}` }),
    );
  });

  it('requires authentication and surfaces upstream failures', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Cannot read favorites'));
    expect((await invoke()).isError).toBe(true);
    mocks.currentSession.mockResolvedValueOnce(
      new Err({ type: 'unauthorized', message: 'Invalid credential' }),
    );
    expect((await invoke()).isError).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
