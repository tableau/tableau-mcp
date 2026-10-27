import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveTemplatePackageDir } from '../tools/desktop/authoring/dataApps/scaffoldDataApp.js';
import { exportDataAppPackage } from './exportDataAppPackage.js';
import { copyPackageTree, replaceTokensInTree } from './packageFiles.js';

describe('exportDataAppPackage', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'data-app-export-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('archives manifest, extensions, and content at the zip root and keeps the source', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const source = join(root, 'pkg');
    await copyPackageTree(template, source);
    await replaceTokensInTree(source, (_path, text) =>
      text
        .replaceAll('TODO-MANIFEST-ID', 'com.example.app')
        .replaceAll('TODO-MANIFEST-VERSION', '1.2.3'),
    );
    await writeFile(join(source, 'scratch.tmp'), 'nope');
    const before = await readFile(join(source, 'manifest.json'), 'utf8');

    const result = await exportDataAppPackage({
      packageDir: source,
      exportsDir: join(root, 'exports'),
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.packageId).toBe('com.example.app');
    expect(result.value.version).toBe('1.2.3');
    expect(result.value.filePath.endsWith('com.example.app-1.2.3.tpkg')).toBe(true);
    expect(await readFile(join(source, 'manifest.json'), 'utf8')).toBe(before);
    const stat = await lstat(result.value.filePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it('rejects a symlink inside the package', async () => {
    const template = (await resolveTemplatePackageDir())!;
    const source = join(root, 'pkg');
    await copyPackageTree(template, source);
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(source, 'content', 'escape'));
    const result = await exportDataAppPackage({
      packageDir: source,
      exportsDir: join(root, 'exports'),
    });
    expect(result.isErr()).toBe(true);
  });
});
