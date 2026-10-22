import assert from 'node:assert/strict';

import { AxiosInstance } from 'axios';
import { MockInstance } from 'vitest';

import { RouteSafetyError } from '../../routeSafety/core.js';
import { RestApiCredentials } from '../restApi.js';
import DatasourcesMethods from './datasourcesMethods.js';

class TestDatasourcesMethods extends DatasourcesMethods {
  get axios(): AxiosInstance {
    return this._apiClient.axios;
  }
}

const datasource = {
  id: 'datasource-1',
  name: 'Sales',
  contentUrl: 'Sales',
  project: { id: 'project-1', name: 'Published' },
  webpageUrl: 'https://tableau.example.com/datasources/Sales',
};

const publishArgs = {
  siteId: 'site-1',
  uploadSessionId: '12345:session-1',
  datasourceType: 'tdsx' as const,
  name: 'Sales',
  projectId: 'project-1',
};

function setup(creds: RestApiCredentials = { type: 'Bearer', token: 'test-token' }): {
  methods: TestDatasourcesMethods;
  post: MockInstance<AxiosInstance['post']>;
} {
  const methods = new TestDatasourcesMethods('https://tableau.example.com/api/3.27', creds, {});
  const post = vi.spyOn(methods.axios, 'post').mockResolvedValue({ data: { datasource } });
  return { methods, post };
}

describe('DatasourcesMethods.publishDatasource', () => {
  it('POSTs one XML multipart part to the datasource route with publish query parameters and auth', async () => {
    const { methods, post } = setup();

    await expect(methods.publishDatasource(publishArgs)).resolves.toEqual(datasource);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('/sites/site-1/datasources');
    expect(config?.params).toEqual({
      uploadSessionId: '12345:session-1',
      datasourceType: 'tdsx',
      overwrite: undefined,
    });
    expect(config?.headers?.Authorization).toBe('Bearer test-token');
    const contentType = String(config?.headers?.['Content-Type']);
    expect(contentType).toMatch(/^multipart\/mixed; boundary=[0-9a-f]+$/);
    const boundary = contentType.split('boundary=')[1];
    assert(Buffer.isBuffer(body), 'Expected a multipart Buffer at the axios boundary');
    expect(body.toString('utf-8')).toBe(
      `--${boundary}\r\n` +
        'Content-Disposition: name="request_payload"\r\n' +
        'Content-Type: text/xml\r\n\r\n' +
        '<tsRequest><datasource name="Sales"><project id="project-1"/></datasource></tsRequest>' +
        `\r\n--${boundary}--\r\n`,
    );
  });

  it.each([true, false])(
    'passes overwrite=%s, TDS type, and Tableau token authentication',
    async (overwrite) => {
      const { methods, post } = setup({
        type: 'X-Tableau-Auth',
        token: 'tableau-token',
        user: { id: 'user-1' },
        site: { id: 'site-1' },
      });

      await methods.publishDatasource({ ...publishArgs, datasourceType: 'tds', overwrite });

      expect(post.mock.calls[0][2]?.params).toEqual({
        uploadSessionId: publishArgs.uploadSessionId,
        datasourceType: 'tds',
        overwrite,
      });
      expect(post.mock.calls[0][2]?.headers).toEqual({
        'Content-Type': expect.stringMatching(/^multipart\/mixed; boundary=/),
        'X-Tableau-Auth': 'tableau-token',
      });
    },
  );

  it('escapes XML attributes including apostrophes using numeric entities', async () => {
    const { methods, post } = setup();

    await methods.publishDatasource({
      ...publishArgs,
      name: 'A & <B> "C" O\'Brien',
      projectId: 'project&<>"\'',
    });

    const body = post.mock.calls[0][1];
    assert(Buffer.isBuffer(body), 'Expected a multipart Buffer at the axios boundary');
    expect(body.toString('utf-8')).toContain(
      '<tsRequest><datasource name="A &amp; &lt;B&gt; &quot;C&quot; O&#39;Brien">' +
        '<project id="project&amp;&lt;&gt;&quot;&#39;"/></datasource></tsRequest>',
    );
    expect(body.toString('utf-8')).not.toContain('&apos;');
  });

  it('parses optional tags and the published datasource response fields', async () => {
    const { methods, post } = setup();
    const published = { ...datasource, tags: { tag: [{ label: 'Sales' }] } };
    post.mockResolvedValue({ data: { datasource: { ...published, unexpected: 'discarded' } } });

    await expect(methods.publishDatasource(publishArgs)).resolves.toEqual(published);
  });

  it.each([
    { ...datasource, id: undefined },
    { ...datasource, project: undefined },
    { ...datasource, tags: { tag: [{ label: 1 }] } },
  ])('rejects malformed publish response %#', async (invalidDatasource) => {
    const { methods, post } = setup();
    post.mockResolvedValue({ data: { datasource: invalidDatasource } });

    await expect(methods.publishDatasource(publishArgs)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('propagates the original axios failure', async () => {
    const { methods, post } = setup();
    const error = new Error('Publish denied');
    post.mockRejectedValue(error);

    await expect(methods.publishDatasource(publishArgs)).rejects.toBe(error);
  });

  it.each(['../other-site', '..', '%2e%2e', 'site/other', 'site\\other', ''])(
    'rejects unsafe site path %j before calling axios',
    async (siteId) => {
      const { methods, post } = setup();

      await expect(methods.publishDatasource({ ...publishArgs, siteId })).rejects.toThrow(
        RouteSafetyError,
      );
      expect(post).not.toHaveBeenCalled();
    },
  );
});
