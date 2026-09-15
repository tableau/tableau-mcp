import { existsSync, statSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getConfig } from '../../../config.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { exportedForTesting } from '../s3Client.js';
import { createDataAppWorkspace } from './dataAppWorkspaceStore.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

describe('createDataAppWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    exportedForTesting.resetS3Bundle();
    mocks.send.mockResolvedValue({});
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-template-url');
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
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      invariant(value.filePath);
      expect(value.filePath.endsWith('Sales Demo')).toBe(true);
      expect(value.s3URL).toBeUndefined();
      expect(value.postUnzip).toBeUndefined();

      const pkgDir = join(value.filePath, 'Packages', 'com.tableau.mcp.sales-demo');

      // Workbook renamed to the display name.
      expect(existsSync(join(value.filePath, 'Sales Demo.twb'))).toBe(true);

      // manifest.json fully substituted, valid JSON, no residual placeholders.
      const manifestRaw = await readFile(join(pkgDir, 'manifest.json'), 'utf8');
      expect(manifestRaw).not.toContain('<TODO');
      expect(manifestRaw).not.toContain('com.example.name');
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.id).toBe('com.tableau.mcp.sales-demo');
      expect(manifest.name).toBe('Sales Demo');
      expect(manifest.author).toBe('jdoe via Tableau MCP');

      // data-app.trex fully substituted.
      const trex = await readFile(join(pkgDir, 'extensions', 'data-app.trex'), 'utf8');
      expect(trex).not.toContain('<TODO');
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
      const result = await createDataAppWorkspace({ datappName: 'No User', config: getConfig() });
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
      const first = await createDataAppWorkspace({ datappName: 'Dupe', config: getConfig() });
      expect(first.isOk()).toBe(true);

      const second = await createDataAppWorkspace({ datappName: 'Dupe', config: getConfig() });
      invariant(second.isErr());
      expect(second.error.message).toContain('already exists');
    });

    it('rejects names that would escape the workspace root', async () => {
      for (const datappName of ['a/b', '..']) {
        const result = await createDataAppWorkspace({ datappName, config: getConfig() });
        invariant(result.isErr());
        expect(result.error.message).toContain('Invalid data app name');
      }
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

      const result = await createDataAppWorkspace({ datappName: 'X', config: getConfig() });
      invariant(result.isErr());
      expect(result.error.message).toContain('DATA_APP_TEMPLATE_S3_KEY');
      expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    });

    it('errors when no S3 bucket is configured', async () => {
      vi.stubEnv('MCP_S3_BUCKET', '');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', 'templates/data-app.zip');

      const result = await createDataAppWorkspace({ datappName: 'X', config: getConfig() });
      invariant(result.isErr());
      expect(result.error.message).toContain('MCP_S3_BUCKET');
    });
  });
});
