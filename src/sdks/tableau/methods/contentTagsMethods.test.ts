import { AxiosAdapter, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Mock } from 'vitest';

import { RouteSafetyError } from '../../routeSafety/core.js';
import { RestApiCredentials } from '../restApi.js';
import DatasourcesMethods from './datasourcesMethods.js';
import { TagMutationResponseError } from './tagUtils.js';
import ViewsMethods from './viewsMethods.js';
import WorkbooksMethods from './workbooksMethods.js';

const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const BASE_URL = 'https://tableau.example/api/3.29';

function client(
  resourceType: 'workbook' | 'view' | 'datasource',
  creds: RestApiCredentials,
): {
  adapter: Mock<AxiosAdapter>;
  add: (tagLabels: string[], id?: string) => Promise<void>;
  remove: (tagLabel: string, id?: string) => Promise<void>;
} {
  const adapter = vi.fn<AxiosAdapter>(async (config: InternalAxiosRequestConfig) => ({
    data:
      config.method === 'put'
        ? { tags: { tag: [{ label: 'new' }, { label: 'unrelated' }] } }
        : undefined,
    status: config.method === 'put' ? 200 : 204,
    statusText: 'OK',
    headers: {},
    config,
  }));
  const common = { siteId: SITE_ID };
  const config = { adapter, headers: { Accept: 'application/json' } };
  switch (resourceType) {
    case 'workbook': {
      const methods = new WorkbooksMethods(BASE_URL, creds, config);
      return {
        adapter,
        add: (tagLabels: string[], id = RESOURCE_ID) =>
          methods.addTagsToWorkbook({ ...common, workbookId: id, tagLabels }),
        remove: (tagLabel: string, id = RESOURCE_ID) =>
          methods.deleteTagFromWorkbook({ ...common, workbookId: id, tagLabel }),
      };
    }
    case 'view': {
      const methods = new ViewsMethods(BASE_URL, creds, config);
      return {
        adapter,
        add: (tagLabels: string[], id = RESOURCE_ID) =>
          methods.addTagsToView({ ...common, viewId: id, tagLabels }),
        remove: (tagLabel: string, id = RESOURCE_ID) =>
          methods.deleteTagFromView({ ...common, viewId: id, tagLabel }),
      };
    }
    case 'datasource': {
      const methods = new DatasourcesMethods(BASE_URL, creds, config);
      return {
        adapter,
        add: (tagLabels: string[], id = RESOURCE_ID) =>
          methods.addTagsToDatasource({ ...common, datasourceId: id, tagLabels }),
        remove: (tagLabel: string, id = RESOURCE_ID) =>
          methods.deleteTagFromDatasource({ ...common, datasourceId: id, tagLabel }),
      };
    }
  }
}

const types = ['workbook', 'view', 'datasource'] as const;

describe.each(types)('%s tags REST methods', (resourceType) => {
  it.each([undefined, 'text/html'])(
    'rejects malformed add responses even when Content-Type is %j',
    async (contentType) => {
      const { add, adapter } = client(resourceType, {
        type: 'Bearer',
        token: 'synthetic-test-token',
      });
      const sentinel = 'SYNTHETIC_PRIVATE_TAG_RESPONSE';
      adapter.mockImplementation(async (config) => ({
        data: { privateMetadata: sentinel },
        status: 200,
        statusText: 'OK',
        headers: contentType ? { 'content-type': contentType } : {},
        config,
      }));
      await expect(add(['safe'])).rejects.toBeInstanceOf(TagMutationResponseError);
      await expect(add(['safe'])).rejects.toThrow('may already have been applied');
      await expect(add(['safe'])).rejects.not.toThrow(sentinel);
    },
  );

  it('accepts the native axios empty-string 204 body', async () => {
    const { remove, adapter } = client(resourceType, {
      type: 'Bearer',
      token: 'synthetic-test-token',
    });
    adapter.mockImplementation(async (config) => ({
      data: '',
      status: 204,
      statusText: 'No Content',
      headers: {},
      config,
    }));
    await expect(remove('safe')).resolves.toBeUndefined();
  });

  it('does not turn an unexpected delete response body into a clean success', async () => {
    const { remove, adapter } = client(resourceType, {
      type: 'Bearer',
      token: 'synthetic-test-token',
    });
    adapter.mockImplementation(async (config) => ({
      data: { privateMetadata: 'synthetic' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));
    await expect(remove('safe')).rejects.toBeInstanceOf(TagMutationResponseError);
  });

  it.each(['X-Tableau-Auth', 'Bearer'] as const)(
    'sends the additive JSON contract with %s authentication',
    async (type) => {
      const creds: RestApiCredentials =
        type === 'Bearer'
          ? { type, token: 'synthetic-test-token' }
          : {
              type,
              token: 'synthetic-test-token',
              site: { id: SITE_ID },
              user: { id: RESOURCE_ID },
            };
      const { add, adapter } = client(resourceType, creds);
      const labels = ['売上', 'Sales #1', 'A&B?', '50%', 'Revenue/Cost'];
      await add(labels);
      expect(adapter).toHaveBeenCalledTimes(1);
      const config = adapter.mock.calls[0][0];
      expect(config.method).toBe('put');
      expect(config.url).toBe(`/sites/${SITE_ID}/${resourceType}s/${RESOURCE_ID}/tags`);
      expect(JSON.parse(config.data)).toEqual({
        tags: { tag: labels.map((label) => ({ label })) },
      });
      expect(config.headers.get('Content-Type')).toBe('application/json');
      expect(config.headers.get('Accept')).toBe('application/json');
      expect(config.headers.get(type === 'Bearer' ? 'Authorization' : 'X-Tableau-Auth')).toBe(
        type === 'Bearer' ? 'Bearer synthetic-test-token' : 'synthetic-test-token',
      );
    },
  );

  it.each([
    ['売上', '%E5%A3%B2%E4%B8%8A'],
    ['Sales #1', 'Sales%20%231'],
    ['A&B?', 'A%26B%3F'],
    ["50%; + !'()*", '50%25%3B%20%2B%20%21%27%28%29%2A'],
    ['literal %zz', 'literal%20%25zz'],
    ['literal %41', 'literal%20%2541'],
  ])(
    'encodes decoded label %j exactly once and accepts an empty 204 response',
    async (label, encoded) => {
      const { remove, adapter } = client(resourceType, {
        type: 'X-Tableau-Auth',
        token: 'synthetic-test-token',
        site: { id: SITE_ID },
        user: { id: RESOURCE_ID },
      });
      await expect(remove(label)).resolves.toBeUndefined();
      expect(adapter).toHaveBeenCalledTimes(1);
      const config = adapter.mock.calls[0][0];
      expect(config.method).toBe('delete');
      expect(config.url).toBe(`/sites/${SITE_ID}/${resourceType}s/${RESOURCE_ID}/tags/${encoded}`);
      expect(config.data).toBeUndefined();
      expect(config.headers.get('X-Tableau-Auth')).toBe('synthetic-test-token');
    },
  );

  it.each(['../x', '%2e%2e', '', 'not-a-luid'])(
    'rejects invalid content LUID %j before the adapter',
    async (id) => {
      const { add, remove, adapter } = client(resourceType, {
        type: 'Bearer',
        token: 'synthetic-test-token',
      });
      await expect(add(['safe'], id)).rejects.toBeInstanceOf(RouteSafetyError);
      await expect(remove('safe', id)).rejects.toBeInstanceOf(RouteSafetyError);
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it.each(['/', 'a\\b', '.', '..', '..;x', '%2f', '%252F', '%2e%2e', '\u0000', '\ud800'])(
    'keeps the route guards for removal %j',
    async (label) => {
      const { remove, adapter } = client(resourceType, {
        type: 'Bearer',
        token: 'synthetic-test-token',
      });
      await expect(remove(label)).rejects.toBeInstanceOf(RouteSafetyError);
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it.each([403, 404])(
    'passes through HTTP %s and does not retry or overwrite unrelated tags',
    async (status) => {
      const { add, remove, adapter } = client(resourceType, {
        type: 'Bearer',
        token: 'synthetic-test-token',
      });
      const error = new AxiosError(`Synthetic HTTP ${status}`);
      error.response = {
        status,
        data: { error: { code: status === 403 ? '403004' : '404007' } },
      } as AxiosError['response'];
      adapter.mockRejectedValue(error);
      await expect(add(['new'])).rejects.toBe(error);
      await expect(remove('new')).rejects.toBe(error);
      expect(adapter).toHaveBeenCalledTimes(2);
    },
  );
});
