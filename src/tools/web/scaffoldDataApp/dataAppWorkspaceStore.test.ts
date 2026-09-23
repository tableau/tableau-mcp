import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getConfig } from '../../../config.js';
import { buildTemplateZip, TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { exportedForTesting } from '../s3Client.js';
import { createDataAppWorkspace } from './dataAppWorkspaceStore.js';
import { buildPostUnzipPlan, deriveIdentity } from './templateIdentity.js';

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
    // clearAllMocks clears call history but not implementations, so reset send/getSignedUrl to a
    // clean success each test — otherwise a rejection stubbed in one test leaks into the next.
    mocks.send.mockResolvedValue(undefined);
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-template-url');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('disk output (S3 not configured)', () => {
    beforeAll(() => {
      buildTemplateZip();
    });

    it('serves the static, un-substituted template zip plus a postUnzip plan', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      invariant(value.filePath);
      expect(existsSync(value.filePath)).toBe(true);
      expect(statSync(value.filePath).size).toBeGreaterThan(0);
      expect(value.s3URL).toBeUndefined();

      // Local mode returns the exact same plan S3 mode does - the client always unzips and finalizes.
      invariant(value.postUnzip);
      expect(value.postUnzip).toEqual(buildPostUnzipPlan(deriveIdentity('Sales Demo')));
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name/Packages/TODO-MANIFEST-ID',
        to: 'Data App Name/Packages/com.tableau.mcp.sales-demo',
      });
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name/Data App Name.twb',
        to: 'Data App Name/Sales Demo.twb',
      });
      expect(value.postUnzip.renames).toContainEqual({ from: 'Data App Name', to: 'Sales Demo' });

      // The zip itself is un-substituted and its top-level entry is the raw template dir name.
      const extractDir = await mkdtemp(join(tmpdir(), 'dataapp-extract-'));
      try {
        execFileSync('unzip', ['-q', value.filePath, '-d', extractDir]);

        const root = join(extractDir, 'Data App Name');
        const pkgDir = join(root, 'Packages', 'TODO-MANIFEST-ID');

        const twb = await readFile(join(root, 'Data App Name.twb'), 'utf8');
        expect(twb).toContain('TODO-MANIFEST-ID');
        expect(twb).toContain('TODO App Name');

        const trex = await readFile(join(pkgDir, 'extensions', 'data-app.trex'), 'utf8');
        expect(trex).toContain('TODO-MANIFEST-ID');
        expect(trex).toContain('TODO App Name');

        // Vendored Extensions API library copied byte-for-byte (large binary).
        const libPath = join(pkgDir, 'content', 'src', 'tableau.extensions.1.latest.js');
        expect(existsSync(libPath)).toBe(true);
        expect(statSync(libPath).size).toBe(2112831);

        // Starter app.js left untouched with its authoring marker.
        const appJs = await readFile(join(pkgDir, 'content', 'src', 'app.js'), 'utf8');
        expect(appJs).toContain('AUTHOR YOUR APP HERE');
      } finally {
        await rm(extractDir, { recursive: true, force: true });
      }
    });
  });

  describe('S3 output (MCP_S3_BUCKET configured)', () => {
    // S3 mode now uploads the same on-disk build artifact local mode serves, so the zip must exist.
    beforeAll(() => {
      buildTemplateZip();
    });

    beforeEach(() => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('AWS_DEFAULT_REGION', 'us-west-2');
    });

    it('uploads the on-disk template zip, then presigns a GET URL for what it uploaded', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;

      expect(value.s3URL).toBe('https://s3.example.com/signed-template-url');
      expect(value.filePath).toBeUndefined();

      // The server uploads its own build artifact fresh: exactly one PutObjectCommand carrying the
      // real on-disk template bytes under a fixed, prefix-namespaced key.
      expect(mocks.send).toHaveBeenCalledTimes(1);
      const putCommand = mocks.send.mock.calls[0][0];
      expect(putCommand.__command).toBe('put');
      const putInput = putCommand.input;
      expect(putInput.Bucket).toBe('tmpl-bucket');
      expect(putInput.ContentType).toBe('application/zip');
      expect(putInput.Key).toContain('data-app-templates/');
      expect(putInput.Key.endsWith(TEMPLATE_ZIP_FILENAME)).toBe(true);

      const expectedBytes = await readFile(join('src/templates', TEMPLATE_ZIP_FILENAME));
      expect(putInput.Body).toEqual(expectedBytes);

      // The presigned GET is for the exact object just uploaded — same key as the PUT.
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
      expect(getInput).toEqual({ Bucket: 'tmpl-bucket', Key: putInput.Key });
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);

      invariant(value.postUnzip);
      expect(value.postUnzip.edits.length).toBeGreaterThan(0);
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name',
        to: 'Sales Demo',
      });
    });

    it('returns an error when the upload (PUT) fails', async () => {
      mocks.send.mockRejectedValue(new Error('S3 put failed'));

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        config: getConfig(),
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-template-unavailable');
      expect(result.error.message).toContain('S3 put failed');
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
