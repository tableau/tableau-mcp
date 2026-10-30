import { AxiosRequestConfig } from '../../../utils/axios.js';
import { RouteSafetyError } from '../../routeSafety/core.js';
import { RestApiCredentials } from '../restApi.js';
import RecentContentMethods from './recentContentMethods.js';

const siteId = 'site-1';
const baseUrl = 'https://tableau.example/api/3.24';
const view = {
  id: '8a922e79-3041-4916-942e-1a18162ef8a9',
  name: 'Overview',
  contentUrl: 'Overview',
};
const workbook = {
  id: '5589cf2b-8601-43f9-9151-0f6c2db760cc',
  name: 'Workbook',
  contentUrl: 'Workbook',
  project: { id: 'p1' },
};

function createMethods(
  response: unknown,
  creds: RestApiCredentials = { type: 'Bearer', token: 'test' },
  headers: Record<string, string> = { 'content-type': 'application/json' },
): { methods: RecentContentMethods; adapter: ReturnType<typeof vi.fn> } {
  const adapter = vi.fn();
  const axiosConfig: AxiosRequestConfig = {
    adapter: async (config) => {
      adapter(config);
      return {
        data: response,
        status: 200,
        statusText: 'OK',
        headers,
        config,
      };
    },
  };
  return { methods: new RecentContentMethods(baseUrl, creds, axiosConfig), adapter };
}

describe('RecentContentMethods', () => {
  it('returns mixed entries in backend order with bearer auth', async () => {
    const entries = [{ workbook }, { view }];
    const { methods, adapter } = createMethods({ recents: { recent: entries } });
    await expect(methods.getRecentlyViewedForSite({ siteId })).resolves.toEqual(entries);
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        baseURL: baseUrl,
        url: '/sites/site-1/content/recent',
        headers: expect.objectContaining({ Authorization: 'Bearer test' }),
      }),
    );
    expect(adapter.mock.calls[0][0].params).toEqual({});
  });

  it('sends PAT session auth without any user selector', async () => {
    const { methods, adapter } = createMethods(
      { recents: {} },
      {
        type: 'X-Tableau-Auth',
        token: 'test-session',
        site: { id: siteId },
        user: { id: 'user-1' },
      },
    );
    await expect(methods.getRecentlyViewedForSite({ siteId })).resolves.toEqual([]);
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Tableau-Auth': 'test-session' }),
      }),
    );
  });

  it('returns an empty array for an explicit empty recent array', async () => {
    const { methods } = createMethods({ recents: { recent: [] } });
    await expect(methods.getRecentlyViewedForSite({ siteId })).resolves.toEqual([]);
  });

  it.each([{}, { recents: { recent: [{ view }, { view, workbook }] } }])(
    'rejects malformed responses without forwarding raw rows %j',
    async (response) => {
      const { methods } = createMethods(response);
      await expect(methods.getRecentlyViewedForSite({ siteId })).rejects.toThrow(
        'Tableau returned an invalid recent-content response.',
      );
    },
  );

  it('rejects unsafe site IDs before the adapter sends anything', async () => {
    const { methods, adapter } = createMethods({ recents: {} });
    await expect(methods.getRecentlyViewedForSite({ siteId: '../other-site' })).rejects.toThrow(
      RouteSafetyError,
    );
    expect(adapter).not.toHaveBeenCalled();
  });

  it('rejects malformed responses even without a JSON content-type header', async () => {
    const { methods } = createMethods({ recents: { recent: [{ view, workbook }] } }, undefined, {});
    await expect(methods.getRecentlyViewedForSite({ siteId })).rejects.toThrow(
      'Tableau returned an invalid recent-content response.',
    );
  });

  it('propagates transport errors', async () => {
    const error = new Error('Tableau unavailable');
    const methods = new RecentContentMethods(
      baseUrl,
      { type: 'Bearer', token: 'test' },
      {
        adapter: async () => {
          throw error;
        },
      },
    );
    await expect(methods.getRecentlyViewedForSite({ siteId })).rejects.toBe(error);
  });
});
