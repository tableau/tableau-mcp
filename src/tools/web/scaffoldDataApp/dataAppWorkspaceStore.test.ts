import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buffer } from 'stream/consumers';

import { buildTemplateZip, TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { createDataAppWorkspace } from './dataAppWorkspaceStore.js';
import { buildDatasourceWiringInfo } from './datasourceWiring.js';
import {
  buildPostUnzipPlan,
  buildRequestedOriginsGuide,
  deriveIdentity,
} from './templateIdentity.js';

const mocks = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({ upload: mocks.mockUpload })),
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
}));

const wiring = buildDatasourceWiringInfo({
  serverUrl: 'https://10ax.online.tableau.com',
  siteName: 'mcp-test',
});

describe('createDataAppWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    // clearAllMocks clears call history but not implementations, so reset upload to a clean
    // success each test — otherwise a rejection stubbed in one test leaks into the next.
    mocks.mockIsBlobStorageEnabled.mockReturnValue(false);
    mocks.mockUpload.mockResolvedValue({ url: 'https://blob.example.com/signed-template-url' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('disk output (blob storage not configured)', () => {
    beforeAll(async () => {
      await buildTemplateZip();
    });

    it('serves the static, un-substituted template zip plus a postUnzip plan', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
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
      expect(value.downloadUrl).toBeUndefined();

      // Local mode returns the exact same plan blob storage mode does - the client always unzips and
      // finalizes.
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

  describe('blob storage output (blob storage configured)', () => {
    // Blob storage mode uploads the same on-disk build artifact local mode serves, so the zip must
    // exist.
    beforeAll(async () => {
      await buildTemplateZip();
    });

    beforeEach(() => {
      mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    });

    it('uploads the on-disk template zip and returns the URL for what it uploaded', async () => {
      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
      });

      invariant(result.isOk(), result.isErr() ? result.error.message : '');
      const value = result.value;
      expect(value.allowedOrigins).toEqual(['https://example.com']);
      expect(value.wiring).toEqual(wiring);

      expect(value.downloadUrl).toBe('https://blob.example.com/signed-template-url');
      expect(value.filePath).toBeUndefined();
      expect(value.requestedOrigins).toEqual(
        buildRequestedOriginsGuide(deriveIdentity('Sales Demo')),
      );

      // The server uploads its own build artifact fresh: exactly one upload carrying the real
      // on-disk template bytes under a fixed key.
      const expectedBytes = await readFile(join('src/templates', TEMPLATE_ZIP_FILENAME));
      expect(mocks.mockUpload).toHaveBeenCalledTimes(1);
      expect(mocks.mockUpload).toHaveBeenCalledWith({
        key: `data-app-templates/${TEMPLATE_ZIP_FILENAME}`,
        data: expect.anything(),
        contentLength: expectedBytes.byteLength,
        contentType: 'application/zip',
      });
      await expect(buffer(mocks.mockUpload.mock.calls[0][0].data)).resolves.toEqual(expectedBytes);

      invariant(value.postUnzip);
      expect(value.postUnzip.edits.length).toBeGreaterThan(0);
      expect(value.postUnzip.renames).toContainEqual({
        from: 'Data App Name',
        to: 'Sales Demo',
      });
    });

    it('returns an error when the upload fails', async () => {
      mocks.mockUpload.mockRejectedValue(new Error('blob upload failed'));

      const result = await createDataAppWorkspace({
        datappName: 'Sales Demo',
        allowedOrigins: ['https://example.com'],
        wiring,
      });

      invariant(result.isErr());
      expect(result.error.type).toBe('data-app-template-unavailable');
      expect(result.error.message).toContain('blob upload failed');
    });
  });
});
