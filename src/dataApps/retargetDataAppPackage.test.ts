import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveTemplatePackageDir } from '../tools/desktop/authoring/dataApps/scaffoldDataApp.js';
import { copyPackageTree } from './packageFiles.js';
import { retargetDataAppPackage } from './retargetDataAppPackage.js';

describe('retargetDataAppPackage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'data-app-retarget-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('copies into a new package id and leaves the source unchanged', async () => {
    const source = join(root, 'source');
    await copyPackageTree((await resolveTemplatePackageDir())!, source);
    const appPath = join(source, 'content', 'src', 'app.js');
    const originalApp = await readFile(appPath, 'utf8');
    await writeFile(
      appPath,
      originalApp.replace("BOUND_DATASOURCE_ID = ''", 'BOUND_DATASOURCE_ID = "Old Source"'),
    );
    const originalManifest = await readFile(join(source, 'manifest.json'), 'utf8');

    const result = await retargetDataAppPackage({
      sourceDir: source,
      destinationRoot: join(root, 'dest'),
      extensionsDatasourceId: 'New Source',
      fieldReplacements: [{ find: 'Old Field', replace: 'New Field' }],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.packageId).not.toBe('TODO-MANIFEST-ID');
    expect(await readFile(join(source, 'manifest.json'), 'utf8')).toBe(originalManifest);
    const copied = await readFile(join(result.value.sourceDir, 'content', 'src', 'app.js'), 'utf8');
    expect(copied).toContain('var BOUND_DATASOURCE_ID = "New Source";');
    const sourceApp = await readFile(appPath, 'utf8');
    expect(sourceApp).toContain('Old Source');
    expect(sourceApp).not.toContain('New Source');
  });
});
