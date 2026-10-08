import { makeApi, Zodios } from '@zodios/core';
import { z } from 'zod';

import Methods from '../tableau/methods/methods.js';
import { RouteSafetyError } from './core.js';
import { installRouteGuards } from './zodios.js';

const LUID = '11111111-1111-1111-1111-111111111111';

// `:viewId` is deliberately undeclared so only the runtime guards (not Zodios's own parameter
// validation) stand between the value and the URL.
const api = makeApi([
  {
    method: 'get',
    path: '/sites/:siteId/views/:viewId',
    alias: 'getView',
    response: z.object({ ok: z.boolean() }),
  },
]);

const makeClient = (): {
  client: InstanceType<typeof Zodios<typeof api>>;
  requestedUrls: Array<string | undefined>;
} => {
  const requestedUrls: Array<string | undefined> = [];
  const client = new Zodios('http://tableau.test/api/3.x', api, {
    axiosConfig: {
      adapter: async (config) => {
        requestedUrls.push(config.url);
        return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
      },
    },
  });
  return { client, requestedUrls };
};

describe('installRouteGuards', () => {
  it('is idempotent: re-installing on the same client registers the guards once', () => {
    const { client } = makeClient();
    const useSpy = vi.spyOn(client, 'use');
    const interceptorSpy = vi.spyOn(client.axios.interceptors.request, 'use');

    installRouteGuards(client);
    installRouteGuards(client);
    new Methods(client);
    new Methods(client);

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(interceptorSpy).toHaveBeenCalledTimes(1);
  });

  it('installs the guards independently on distinct clients', () => {
    const a = makeClient().client;
    const b = makeClient().client;
    const useA = vi.spyOn(a, 'use');
    const useB = vi.spyOn(b, 'use');

    installRouteGuards(a);
    installRouteGuards(b);

    expect(useA).toHaveBeenCalledTimes(1);
    expect(useB).toHaveBeenCalledTimes(1);
  });

  it('lets safe requests through', async () => {
    const { client, requestedUrls } = makeClient();
    installRouteGuards(client);

    await expect(client.getView({ params: { siteId: LUID, viewId: LUID } })).resolves.toEqual({
      ok: true,
    });
    expect(requestedUrls).toHaveLength(1);
  });

  it('rejects an unsafe path param with an unwrapped RouteSafetyError before any request', async () => {
    const { client, requestedUrls } = makeClient();
    installRouteGuards(client);

    await expect(
      client.getView({ params: { siteId: LUID, viewId: '../workbooks/x' } }),
    ).rejects.toBeInstanceOf(RouteSafetyError);
    expect(requestedUrls).toHaveLength(0);
  });

  it('rejects a raw axios URL with traversal segments with an unwrapped RouteSafetyError', async () => {
    const { client, requestedUrls } = makeClient();
    installRouteGuards(client);

    await expect(client.axios.get(`/sites/${LUID}/views/%2e%2e/workbooks`)).rejects.toBeInstanceOf(
      RouteSafetyError,
    );
    expect(requestedUrls).toHaveLength(0);
  });
});
