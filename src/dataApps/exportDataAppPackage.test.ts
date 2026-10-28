import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'fs/promises';
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

  async function packageWithTrexUrl(url: string): Promise<string> {
    const template = (await resolveTemplatePackageDir())!;
    const source = join(root, 'pkg');
    await copyPackageTree(template, source);
    await replaceTokensInTree(source, (_path, text) =>
      text
        .replaceAll('TODO-MANIFEST-ID', 'com.example.app')
        .replaceAll('TODO-MANIFEST-VERSION', '1.2.3'),
    );
    const trexDir = join(source, 'extensions');
    const entries = await readdir(trexDir);
    const trexName = entries.find((name) => name.endsWith('.trex'));
    expect(trexName).toBeTruthy();
    const trexPath = join(trexDir, trexName!);
    const trex = await readFile(trexPath, 'utf8');
    await writeFile(trexPath, trex.replace(/<url>[^<]*<\/url>/, `<url>${url}</url>`));
    return source;
  }

  it('rejects a file: content URL', async () => {
    const source = await packageWithTrexUrl('file:///tmp/index.html');
    const result = await exportDataAppPackage({
      packageDir: source,
      exportsDir: join(root, 'exports'),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain('relative package path');
  });

  it('rejects a later absolute URL when an earlier url is relative', async () => {
    const source = await packageWithTrexUrl('index.html');
    const trexDir = join(source, 'extensions');
    const entries = await readdir(trexDir);
    const trexName = entries.find((name) => name.endsWith('.trex'));
    expect(trexName).toBeTruthy();
    const trexPath = join(trexDir, trexName!);
    const trex = await readFile(trexPath, 'utf8');
    await writeFile(
      trexPath,
      trex.replace(
        /<url>[^<]*<\/url>/,
        '<url>index.html</url><url>https://evil.example/x</url>',
      ),
    );
    const result = await exportDataAppPackage({
      packageDir: source,
      exportsDir: join(root, 'exports'),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.message).toContain('relative package path');
  });
});
