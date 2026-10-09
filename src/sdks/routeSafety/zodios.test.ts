import { makeApi, Zodios } from '@zodios/core';
import { z } from 'zod';

import Methods from '../tableau/methods/methods.js';
import { buildRestPath, RouteSafetyError } from './core.js';
import { pathParam } from './ids.js';
import { createGuardedZodios, installRouteGuards } from './zodios.js';

const LUID = '11111111-1111-1111-1111-111111111111';
const BASE = 'http://tableau.test/api/3.x';

const api = makeApi([
  {
    // `:viewId` is deliberately undeclared so only the runtime guards (not Zodios's own parameter
    // validation) stand between the value and the URL.
    method: 'get',
    path: '/sites/:siteId/views/:viewId',
    alias: 'getView',
    response: z.object({ ok: z.boolean() }),
  },
  {
    // Declared like every production endpoint: Zodios's `zod-validation` plugin runs the
    // `pathParam` schemas before the route guards.
    method: 'get',
    path: '/sites/:siteId/workbooks/:workbookId',
    alias: 'getWorkbook',
    parameters: [pathParam('siteId', 'segment'), pathParam('workbookId')],
    response: z.object({ ok: z.boolean() }),
  },
  {
    method: 'get',
    path: '/sites/:siteId/knowledge/nodes/:node_id',
    alias: 'getKnowledgeNode',
    parameters: [pathParam('siteId', 'segment'), pathParam('node_id', 'segment')],
    response: z.object({ ok: z.boolean() }),
  },
]);

type RecordedRequest = { url?: string; params?: unknown };

const adapterFor =
  (requests: RecordedRequest[]) =>
  async (config: any): Promise<any> => {
    requests.push({ url: config.url, params: config.params });
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };

const makeClient = (
  guarded = true,
): {
  client: InstanceType<typeof Zodios<typeof api>>;
  requests: RecordedRequest[];
} => {
  const requests: RecordedRequest[] = [];
  const options = { axiosConfig: { adapter: adapterFor(requests) } };
  const client = guarded ? createGuardedZodios(BASE, api, options) : new Zodios(BASE, api, options);
  return { client, requests };
};

describe('createGuardedZodios', () => {
  it('installs the guards on the client it builds', async () => {
    const { client, requests } = makeClient();

    await expect(
      client.getView({ params: { siteId: LUID, viewId: '../workbooks/x' } }),
    ).rejects.toBeInstanceOf(RouteSafetyError);
    expect(requests).toHaveLength(0);
  });
});

describe('installRouteGuards', () => {
  it('is idempotent: Methods re-installing on a guarded client registers nothing new', () => {
    const { client } = makeClient(false);
    const useSpy = vi.spyOn(client, 'use');
    const interceptorSpy = vi.spyOn(client.axios.interceptors.request, 'use');

    installRouteGuards(client);
    installRouteGuards(client);
    new Methods(client);
    new Methods(client);

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(interceptorSpy).toHaveBeenCalledTimes(1);
  });

  it('lets safe requests through', async () => {
    const { client, requests } = makeClient();

    await expect(client.getView({ params: { siteId: LUID, viewId: LUID } })).resolves.toEqual({
      ok: true,
    });
    expect(requests).toEqual([{ url: `/sites/${LUID}/views/${LUID}`, params: undefined }]);
  });

  it('rejects an unsafe undeclared path param with an unwrapped RouteSafetyError', async () => {
    const { client, requests } = makeClient();

    await expect(
      client.getView({ params: { siteId: LUID, viewId: '../workbooks/x' } }),
    ).rejects.toBeInstanceOf(RouteSafetyError);
    expect(requests).toHaveLength(0);
  });

  describe('declared pathParam (Zodios zod-validation path)', () => {
    it('rejects the W-24452700 payload with a RouteSafetyError, not a ZodiosError', async () => {
      const { client, requests } = makeClient();
      const payload = `../workbooks/${LUID}/content?includeExtract=true&x=`;

      const error = await client
        .getWorkbook({ params: { siteId: LUID, workbookId: payload } })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RouteSafetyError);
      expect((error as Error).message).toBe(
        "Path parameter 'workbookId' must be a Tableau LUID (UUID format)",
      );
      expect((error as Error).message).not.toContain('..');
      expect(requests).toHaveLength(0);
    });

    it('rejects an unsafe segment param, naming it', async () => {
      const { client, requests } = makeClient();

      await expect(
        client.getKnowledgeNode({ params: { siteId: '..', node_id: 'x' } }),
      ).rejects.toThrow(
        new RouteSafetyError("Path parameter 'siteId' is not a valid route segment"),
      );
      expect(requests).toHaveLength(0);
    });

    it('accepts a valid LUID', async () => {
      const { client, requests } = makeClient();

      await expect(
        client.getWorkbook({ params: { siteId: LUID, workbookId: LUID } }),
      ).resolves.toEqual({ ok: true });
      expect(requests).toHaveLength(1);
    });

    it.each(['field:Is Returned?', 'Order #', 'x;y'])(
      'sends the encoded knowledge node ID for %j unchanged',
      async (nodeId) => {
        const { client, requests } = makeClient();
        const encoded = encodeURIComponent(nodeId);

        await client.getKnowledgeNode({ params: { siteId: LUID, node_id: encoded } });
        expect(requests.map((r) => r.url)).toEqual([`/sites/${LUID}/knowledge/nodes/${encoded}`]);
      },
    );
  });

  describe('axios URL interceptor (raw calls)', () => {
    it('allows a buildRestPath URL with query params in `params`', async () => {
      const { client, requests } = makeClient();

      await client.axios.get(buildRestPath('sites', LUID, 'views', LUID, 'data'), {
        params: { vf_Region: 'East' },
      });
      expect(requests).toEqual([
        { url: `/sites/${LUID}/views/${LUID}/data`, params: { vf_Region: 'East' } },
      ]);
    });

    it.each([
      ['encoded dot-dot', `/sites/${LUID}/views/%2e%2e/workbooks`],
      ['literal query that truncates the path', `/sites/${LUID}/views/${LUID}?x=/data`],
      ['absolute URL', 'https://evil.test/api/3.x/sites'],
      ['protocol-relative URL', '//evil.test/api/3.x/sites'],
      ['tab inside dot-dot', `/sites/${LUID}/views/.\t./workbooks`],
      ['trailing-space dot-dot', `/sites/${LUID}/views/.. `],
    ])('rejects %s with an unwrapped RouteSafetyError', async (_n, url) => {
      const { client, requests } = makeClient();

      await expect(client.axios.get(url)).rejects.toBeInstanceOf(RouteSafetyError);
      expect(requests).toHaveLength(0);
    });

    it('rejects a config-object request to an absolute URL', async () => {
      const { client, requests } = makeClient();

      await expect(
        client.axios.request({ url: 'https://evil.test/x', method: 'get' }),
      ).rejects.toBeInstanceOf(RouteSafetyError);
      expect(requests).toHaveLength(0);
    });
  });
});
