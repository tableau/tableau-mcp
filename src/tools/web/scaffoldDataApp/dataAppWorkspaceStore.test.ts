import { DOMParser } from '@xmldom/xmldom';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { getConfig } from '../../../config.js';
import { buildTemplateZip, TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { exportedForTesting } from '../s3Client.js';
import { createDataAppWorkspace } from './dataAppWorkspaceStore.js';
import { buildDatasourceWiringInfo } from './datasourceWiring.js';
import {
  buildPostUnzipPlan,
  buildRequestedOriginsGuide,
  deriveIdentity,
} from './templateIdentity.js';

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

const productVersion = { value: '2026.3.2', build: '20263.26.1027.1340' };

const wiring = buildDatasourceWiringInfo({
  serverUrl: 'https://10ax.online.tableau.com',
  siteName: 'mcp-test',
});

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
    beforeAll(async () => {
      await buildTemplateZip();
    });

    it('preserves Desktop compatibility metadata in the finalized workbook', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Desktop Compatibility',
        allowedOrigins: [],
        wiring,
        productVersion,
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const { filePath, postUnzip } = result.value;
      invariant(filePath);
      invariant(postUnzip);
      const workbookPath = 'Data App Name/Data App Name.twb';
      let xml = execFileSync('unzip', ['-p', filePath, workbookPath], { encoding: 'utf8' });
      const edit = postUnzip.edits.find(({ file }) => file === workbookPath);
      invariant(edit);
      for (const { find, replace } of edit.replacements) {
        xml = xml.split(find).join(replace);
      }

      const workbook = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
      invariant(workbook);
      expect.soft(workbook.getAttribute('source-build')).toBe('2026.3.2 (20263.26.1027.1340)');
      const manifest = workbook.getElementsByTagName('document-format-change-manifest')[0];
      invariant(manifest);
      for (const declaration of ['Extensions', 'VizExtensions', '_.fcp.Packages.true...Packages']) {
        expect.soft(manifest.getElementsByTagName(declaration).length, declaration).toBe(1);
      }
    });

    it('serves the static, un-substituted template zip plus a postUnzip plan', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
        productVersion,
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      expect(value.allowedOrigins).toEqual(['https://example.com']);
      expect(value.wiring).toEqual(wiring);
      expect(value.requestedOrigins).toEqual(
        buildRequestedOriginsGuide(deriveIdentity('Sales Demo')),
      );
      invariant(value.filePath);
      expect(existsSync(value.filePath)).toBe(true);
      expect(statSync(value.filePath).size).toBeGreaterThan(0);
      expect(value.s3URL).toBeUndefined();

      // Local mode returns the exact same plan S3 mode does - the client always unzips and finalizes.
      invariant(value.postUnzip);
      expect(value.postUnzip).toEqual(
        buildPostUnzipPlan(deriveIdentity('Sales Demo'), productVersion),
      );
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
        expect(twb).toContain('TODO Sheet Name');
        // The raw template never hardcodes a literal sheet name - it's always the token above.
        expect(twb).not.toContain('Sheet 1');
        expect(twb).not.toContain("<card type='title' />");

        // Applying the postUnzip plan's .twb edits (as the client does) turns the worksheet tab
        // into the app's display name, not the placeholder token or a hardcoded "Sheet 1".
        let finalizedTwb = twb;
        for (const { find, replace } of value.postUnzip.edits.find(
          (edit) => edit.file === 'Data App Name/Data App Name.twb',
        )!.replacements) {
          finalizedTwb = finalizedTwb.split(find).join(replace);
        }
        expect(finalizedTwb).toContain("<worksheet name='Sales Demo'>");
        expect(finalizedTwb).toContain(
          "<window class='worksheet' maximized='true' name='Sales Demo'>",
        );
        expect(finalizedTwb).toContain("<referenced-view instances='1' viewId='Sales Demo' />");
        expect(finalizedTwb).not.toContain('Sheet 1');
        expect(finalizedTwb).not.toContain('TODO Sheet Name');
        expect(finalizedTwb).not.toContain('TODO');

        const trex = await readFile(join(pkgDir, 'extensions', 'data-app.trex'), 'utf8');
        expect(trex).toContain('TODO-MANIFEST-ID');
        expect(trex).toContain('TODO App Name');
        expect(trex).toContain('extension-version="TODO-MANIFEST-VERSION"');
        expect(trex).toContain('<author name="TODO Author Name"');

        // The package's JSON manifest ships with identity tokens (the same ones as the .trex) and an
        // empty requestedOrigins.
        const manifestPath = 'Data App Name/Packages/TODO-MANIFEST-ID/manifest.json';
        const manifest = await readFile(join(extractDir, manifestPath), 'utf8');
        expect(JSON.parse(manifest)).toEqual({
          id: 'TODO-MANIFEST-ID',
          version: 'TODO-MANIFEST-VERSION',
          name: 'TODO App Name',
          author: 'TODO Author Name',
          requestedOrigins: '',
        });

        // Applying the plan's edits yields a valid JSON manifest carrying the app's identity, and the
        // same identity lands in the .trex the server reads.
        const finalize = (text: string, file: string): string => {
          for (const { find, replace } of value.postUnzip!.edits.find((edit) => edit.file === file)!
            .replacements) {
            text = text.split(find).join(replace);
          }
          return text;
        };
        expect(JSON.parse(finalize(manifest, manifestPath))).toEqual({
          id: 'com.tableau.mcp.sales-demo',
          version: '1.0.0',
          name: 'Sales Demo',
          author: 'Tableau MCP',
          requestedOrigins: '',
        });
        const finalizedTrex = finalize(
          trex,
          'Data App Name/Packages/TODO-MANIFEST-ID/extensions/data-app.trex',
        );
        expect(finalizedTrex).toContain(
          '<worksheet-extension id="com.tableau.mcp.sales-demo" extension-version="1.0.0">',
        );
        expect(finalizedTrex).toContain('<author name="Tableau MCP"');
        expect(finalizedTrex).not.toContain('TODO');

        // Vendored Extensions API library copied byte-for-byte (large binary).
        const libPath = join(pkgDir, 'content', 'src', 'tableau.extensions.1.latest.min.js');
        expect(existsSync(libPath)).toBe(true);
        expect(statSync(libPath).size).toBe(291737);

        // Starter app.js left untouched with its authoring marker.
        const appJs = await readFile(join(pkgDir, 'content', 'src', 'app.js'), 'utf8');
        expect(appJs).toContain('AUTHOR YOUR APP HERE');

        // Data/ ships empty except its placeholder, for datasource files the workbook embeds.
        expect(readdirSync(join(root, 'Data'))).toEqual(['.gitkeep']);

        // Resources/.agents/ ships the agent-docs README, which carries no identity tokens.
        const agentsReadme = await readFile(
          join(root, 'Resources', '.agents', 'README.md'),
          'utf8',
        );
        expect(agentsReadme).toContain('# Resources/.agents/');
        expect(agentsReadme).not.toContain('TODO');
      } finally {
        await rm(extractDir, { recursive: true, force: true });
      }
    });
  });

  describe('S3 output (MCP_S3_BUCKET configured)', () => {
    // S3 mode now uploads the same on-disk build artifact local mode serves, so the zip must exist.
    beforeAll(async () => {
      await buildTemplateZip();
    });

    beforeEach(() => {
      vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
      vi.stubEnv('AWS_DEFAULT_REGION', 'us-west-2');
    });

    it('uploads the on-disk template zip, then presigns a GET URL for what it uploaded', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
        productVersion,
        config: getConfig(),
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      expect(value.allowedOrigins).toEqual(['https://example.com']);
      expect(value.wiring).toEqual(wiring);

      expect(value.s3URL).toBe('https://s3.example.com/signed-template-url');
      expect(value.filePath).toBeUndefined();
      expect(value.requestedOrigins).toEqual(
        buildRequestedOriginsGuide(deriveIdentity('Sales Demo')),
      );

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
      const workbookEdit = value.postUnzip.edits.find(
        ({ file }) => file === 'Data App Name/Data App Name.twb',
      );
      expect(workbookEdit?.replacements).toContainEqual({
        find: 'TODO-SOURCE-BUILD',
        replace: '2026.3.2 (20263.26.1027.1340)',
      });
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name',
        to: 'Sales Demo',
      });
    });

    it('returns an error when the upload (PUT) fails', async () => {
      mocks.send.mockRejectedValue(new Error('S3 put failed'));

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
        productVersion,
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
        allowedOrigins: ['https://example.com'],
        wiring,
        productVersion,
        config: getConfig(),
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-template-unavailable');
      expect(result.error.message).toContain('S3 unavailable');
    });
  });
});
