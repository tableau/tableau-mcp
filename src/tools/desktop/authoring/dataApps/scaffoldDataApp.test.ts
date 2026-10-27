import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildTemplateZip } from '../../../../scripts/buildTemplateZip.js';
import { _setSeaApiForTest } from '../../../../utils/sea.js';
import { exportedForTesting } from '../../../web/scaffoldDataApp/dataAppWorkspaceStore.js';
import {
  resolveDataAppTemplateZipPath,
  SEA_TEMPLATE_ASSET_KEY,
} from '../../../web/scaffoldDataApp/templateZip.js';
import { resetTemplatePackageCache, resolveTemplatePackageDir } from './scaffoldDataApp.js';

const mocks = vi.hoisted(() => ({
  hideDiskZip: false,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      const text = String(path);
      const exploded =
        text.includes(join('src', 'templates', 'Data App Name')) ||
        text.includes(join('build', 'templates', 'Data App Name'));
      if (exploded) {
        return false;
      }
      if (mocks.hideDiskZip && text.endsWith('data-app-template.zip')) {
        return false;
      }
      return actual.existsSync(path);
    },
  };
});

describe('resolveTemplatePackageDir', () => {
  beforeAll(async () => {
    await buildTemplateZip();
  });

  beforeEach(() => {
    mocks.hideDiskZip = false;
    _setSeaApiForTest(null);
    exportedForTesting.resetSeaTemplatePath();
  });

  afterEach(async () => {
    await resetTemplatePackageCache();
    _setSeaApiForTest(null);
    exportedForTesting.resetSeaTemplatePath();
    mocks.hideDiskZip = false;
  });

  it('reads the package from the template zip when the exploded directory is absent', async () => {
    const packageDir = await resolveTemplatePackageDir();

    expect(packageDir).toBeTruthy();
    expect(packageDir!.startsWith(tmpdir())).toBe(true);
    expect(packageDir).not.toContain(join('src', 'templates'));
    const manifest = await readFile(join(packageDir!, 'manifest.json'), 'utf8');
    expect(manifest).toContain('TODO-MANIFEST-ID');
  });

  it('reads the package from the SEA template asset when the zip is not on disk', async () => {
    const zipPath = await resolveDataAppTemplateZipPath();
    expect(zipPath).toBeTruthy();
    const zipBytes = await readFile(zipPath!);
    await resetTemplatePackageCache();
    exportedForTesting.resetSeaTemplatePath();
    mocks.hideDiskZip = true;
    _setSeaApiForTest({
      isSea: () => true,
      getAsset: (key: string) => {
        if (key !== SEA_TEMPLATE_ASSET_KEY) {
          throw new Error(`no asset ${key}`);
        }
        return new Uint8Array(zipBytes).buffer;
      },
    });

    const packageDir = await resolveTemplatePackageDir();

    expect(packageDir).toBeTruthy();
    expect(packageDir!.startsWith(tmpdir())).toBe(true);
    const manifest = await readFile(join(packageDir!, 'manifest.json'), 'utf8');
    expect(manifest).toContain('TODO-MANIFEST-ID');
  });
});
