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
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-template-url');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('disk output (S3 not configured)', () => {
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
        config: getConfig(),
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

      // data-app.trex fully substituted.
      const trex = await readFile(join(pkgDir, 'extensions', 'data-app.trex'), 'utf8');
      expect(trex).not.toContain('TODO-MANIFEST-ID');
      expect(trex).not.toContain('TODO App Name');
      expect(trex).not.toContain('TODO Username');
      expect(trex).toContain('id="com.tableau.mcp.sales-demo"');
      expect(trex).toContain('name="Tableau MCP"');

      // Vendored Extensions API library copied byte-for-byte (large binary).
      const libPath = join(pkgDir, 'content', 'src', 'tableau.extensions.1.latest.js');
      expect(existsSync(libPath)).toBe(true);
      expect(statSync(libPath).size).toBe(2112831);

      // Starter app.js left untouched with its authoring marker.
      const appJs = await readFile(join(pkgDir, 'content', 'src', 'app.js'), 'utf8');
      expect(appJs).toContain('AUTHOR YOUR APP HERE');

      // Files were written to their finalized paths on disk.
      expect(existsSync(join(pkgDir, 'extensions', 'data-app.trex'))).toBe(true);
    });

    it('refuses to overwrite an existing workspace', async () => {
      const first = await createDataAppWorkspace({
        datappName: 'Dupe',
        config: getConfig(),
      });
      expect(first.isOk()).toBe(true);

      const second = await createDataAppWorkspace({
        datappName: 'Dupe',
        config: getConfig(),
      });
      invariant(second.isErr());
      expect(second.error.message).toContain('already exists');
    });

    it('rejects names that would escape the workspace root', async () => {
      for (const datappName of ['a/b', '..']) {
        const result = await createDataAppWorkspace({
          datappName,
          config: getConfig(),
        });
        invariant(result.isErr());
        expect(result.error.message).toContain('Invalid data app name');
      }
    });
  });

  describe('S3 output (MCP_S3_BUCKET configured)', () => {
    beforeEach(() => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('AWS_DEFAULT_REGION', 'us-west-2');
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', 'templates/data-app.zip');
    });

    it('presigns a GET URL for the pre-published template and returns a postUnzip plan', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;

      expect(value.s3URL).toBe('https://s3.example.com/signed-template-url');
      expect(value.filePath).toBeUndefined();

      // Never builds or uploads a zip - only presigns a GET against the existing object.
      expect(mocks.send).not.toHaveBeenCalled();
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
      expect(getInput).toEqual({ Bucket: 'tmpl-bucket', Key: 'templates/data-app.zip' });
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);

      invariant(value.postUnzip);
      expect(value.postUnzip.edits.length).toBeGreaterThan(0);
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name',
        to: 'Sales Demo',
      });
    });

    it('returns an error, without presigning, when DATA_APP_TEMPLATE_S3_KEY is not configured', async () => {
      vi.stubEnv('DATA_APP_TEMPLATE_S3_KEY', '');

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-template-unavailable');
      expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    });

    it('returns an error when presigning fails', async () => {
      mocks.getSignedUrl.mockRejectedValue(new Error('S3 unavailable'));

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-template-unavailable');
      expect(result.error.message).toContain('S3 unavailable');
    });
  });
});
