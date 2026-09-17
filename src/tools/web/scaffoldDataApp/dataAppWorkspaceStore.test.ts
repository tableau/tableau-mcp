import { existsSync, statSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { stubDefaultEnvVars, testProductVersion } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { exportedForTesting } from '../s3Client.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { createDataAppWorkspace } from './dataAppWorkspaceStore.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  mockResolveDatasourceDescriptor: vi.fn(),
  mockBuildDatasourceWiringEdits: vi.fn(),
  originalBuildDatasourceWiringEdits: undefined as ((...args: unknown[]) => unknown) | undefined,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

vi.mock('./datasourceWiring.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./datasourceWiring.js')>();
  mocks.originalBuildDatasourceWiringEdits = original.buildDatasourceWiringEdits;
  return {
    ...original,
    resolveDatasourceDescriptor: mocks.mockResolveDatasourceDescriptor,
    buildDatasourceWiringEdits: mocks.mockBuildDatasourceWiringEdits,
  };
});

const wiredDescriptor = {
  caption: 'Superstore',
  repositoryId: 'superstore',
  site: 'tc25',
  server: 'test.tableau.com',
  channel: 'https',
  port: 443,
  fields: [{ name: 'Profit', datatype: 'real', role: 'measure' as const }],
};

describe('createDataAppWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    exportedForTesting.resetS3Bundle();
    mocks.send.mockResolvedValue({});
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-template-url');
    mocks.mockBuildDatasourceWiringEdits.mockImplementation(
      mocks.originalBuildDatasourceWiringEdits,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('local (stdio) transport', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'dataapp-'));
      vi.stubEnv('DATA_APP_WORKSPACE_ROOT', root);
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('writes the finalized, substituted workspace tree to disk', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        username: 'jdoe',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      invariant(value.filePath);
      expect(value.filePath.endsWith('Sales Demo')).toBe(true);
      expect(value.s3URL).toBeUndefined();
      expect(value.postUnzip).toBeUndefined();

      const pkgDir = join(value.filePath, 'Packages', 'com.tableau.mcp.sales-demo');

      // Workbook renamed to the display name and fully substituted: the extension
      // id and tableaulocalext path must resolve to the package id, or publishing fails.
      const twbPath = join(value.filePath, 'Sales Demo.twb');
      expect(existsSync(twbPath)).toBe(true);
      const twb = await readFile(twbPath, 'utf8');
      expect(twb).not.toContain('TODO-MANIFEST-ID');
      expect(twb).not.toContain('TODO App Name');
      expect(twb).toContain("id='com.tableau.mcp.sales-demo'");
      expect(twb).toContain('tableaulocalext:///com.tableau.mcp.sales-demo/content/index.html');

      // manifest.json fully substituted, valid JSON, no residual placeholders.
      const manifestRaw = await readFile(join(pkgDir, 'manifest.json'), 'utf8');
      expect(manifestRaw).not.toContain('TODO-MANIFEST-ID');
      expect(manifestRaw).not.toContain('TODO App Name');
      expect(manifestRaw).not.toContain('TODO Username');
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.id).toBe('com.tableau.mcp.sales-demo');
      expect(manifest.name).toBe('Sales Demo');
      expect(manifest.author).toBe('jdoe via Tableau MCP');

      // data-app.trex fully substituted.
      const trex = await readFile(join(pkgDir, 'extensions', 'data-app.trex'), 'utf8');
      expect(trex).not.toContain('TODO-MANIFEST-ID');
      expect(trex).not.toContain('TODO App Name');
      expect(trex).not.toContain('TODO Username');
      expect(trex).toContain('id="com.tableau.mcp.sales-demo"');
      expect(trex).toContain('name="jdoe via Tableau MCP"');

      // Vendored Extensions API library copied byte-for-byte (large binary).
      const libPath = join(pkgDir, 'content', 'src', 'tableau.extensions.1.latest.js');
      expect(existsSync(libPath)).toBe(true);
      expect(statSync(libPath).size).toBe(2112831);

      // Starter app.js left untouched with its authoring marker.
      const appJs = await readFile(join(pkgDir, 'content', 'src', 'app.js'), 'utf8');
      expect(appJs).toContain('AUTHOR YOUR APP HERE');

      // Files were written to their finalized paths on disk.
      expect(existsSync(join(pkgDir, 'manifest.json'))).toBe(true);
    });

    it('falls back to "Tableau MCP" author when no username is provided', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'No User',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });
      invariant(result.isOk());
      const value = result.value;
      invariant(value.filePath);

      const manifest = JSON.parse(
        await readFile(
          join(value.filePath, 'Packages', 'com.tableau.mcp.no-user', 'manifest.json'),
          'utf8',
        ),
      );
      expect(manifest.author).toBe('Tableau MCP');
    });

    it('refuses to overwrite an existing workspace', async () => {
      const first = await createDataAppWorkspace({
        datappName: 'Dupe',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });
      expect(first.isOk()).toBe(true);

      const second = await createDataAppWorkspace({
        datappName: 'Dupe',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });
      invariant(second.isErr());
      expect(second.error.message).toContain('already exists');
    });

    it('rejects names that would escape the workspace root', async () => {
      for (const datappName of ['a/b', '..']) {
        const result = await createDataAppWorkspace({
          datappName,
          config: getConfig(),
          extra: getMockRequestHandlerExtra(),
          productVersion: testProductVersion,
        });
        invariant(result.isErr());
        expect(result.error.message).toContain('Invalid data app name');
      }
    });

    it('wires the resolved datasource into the .twb when datasourceLuid is given', async () => {
      mocks.mockResolveDatasourceDescriptor.mockResolvedValue(new Ok(wiredDescriptor));

      const result = await createDataAppWorkspace({
        datappName: 'Wired Demo',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
        datasourceLuid: 'ds-luid-123',
        fields: ['Profit'],
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      invariant(result.value.filePath);
      expect(mocks.mockResolveDatasourceDescriptor).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceLuid: 'ds-luid-123', fieldNames: ['Profit'] }),
      );

      const twb = await readFile(join(result.value.filePath, 'Wired Demo.twb'), 'utf8');
      expect(twb).not.toContain('<datasources />');
      expect(twb).toContain('Superstore');
    });

    it('returns DataAppWiringFailedError when applying the wiring edits throws', async () => {
      mocks.mockResolveDatasourceDescriptor.mockResolvedValue(new Ok(wiredDescriptor));
      mocks.mockBuildDatasourceWiringEdits.mockReturnValue({
        connectionName: 'sqlproxy.abc',
        rootDatasourceXml: "<datasource name='sqlproxy.abc' />",
        viewDatasourceXml: "<datasource name='sqlproxy.abc' />",
      });

      const result = await createDataAppWorkspace({
        datappName: 'Broken Wiring',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
        datasourceLuid: 'ds-luid-123',
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-wiring-failed');
      expect(result.error.message).toContain('wiring incomplete');
    });
  });

  describe('remote (http) transport', () => {
    beforeEach(() => {
      vi.stubEnv('TRANSPORT', 'http');
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
      vi.stubEnv('AWS_DEFAULT_REGION', 'us-west-2');
    });

    it('presigns the pre-published template object and returns a post-unzip plan', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', 'templates/data-app.zip');

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        username: 'jdoe',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      invariant(value.postUnzip);

      expect(value.s3URL).toBe('https://s3.example.com/signed-template-url');
      expect(value.filePath).toBeUndefined();

      // Presigned a GET of exactly the configured key/bucket; never uploaded or downloaded it.
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
      expect(getInput).toEqual({ Bucket: 'tmpl-bucket', Key: 'templates/data-app.zip' });
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
      expect(mocks.send).not.toHaveBeenCalled();

      // The plan carries the derived identity for the client to apply.
      const planJson = JSON.stringify(value.postUnzip);
      expect(planJson).toContain('com.tableau.mcp.sales-demo');
      expect(planJson).toContain('jdoe via Tableau MCP');
      expect(value.postUnzip.renames.at(-1)).toEqual({ from: 'Data App Name', to: 'Sales Demo' });
    });

    it('errors when the template S3 key is not configured', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', '');

      const result = await createDataAppWorkspace({
        datappName: 'X',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });
      invariant(result.isErr());
      expect(result.error.message).toContain('DATA_APP_TEMPLATE_S3_KEY');
      expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    });

    it('errors when no S3 bucket is configured', async () => {
      vi.stubEnv('MCP_S3_BUCKET', '');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', 'templates/data-app.zip');

      const result = await createDataAppWorkspace({
        datappName: 'X',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
      });
      invariant(result.isErr());
      expect(result.error.message).toContain('MCP_S3_BUCKET');
    });

    it('embeds the wiring edits in the post-unzip plan when datasourceLuid is given', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', 'templates/data-app.zip');
      mocks.mockResolveDatasourceDescriptor.mockResolvedValue(new Ok(wiredDescriptor));

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
        extra: getMockRequestHandlerExtra(),
        productVersion: testProductVersion,
        datasourceLuid: 'ds-luid-123',
        fields: ['Profit'],
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      invariant(result.value.postUnzip);
      expect(result.value.postUnzip.wiresDatasource).toBe(true);
      expect(JSON.stringify(result.value.postUnzip)).toContain('Superstore');
    });
  });
});
