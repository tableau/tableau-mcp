import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import {
  type ContainedFileReadOperations,
  getBookmarkPath,
  getTemplateCatalogEntry,
  listTemplateCatalog,
  listTemplateNames,
  MAX_EXTERNAL_TEMPLATE_BYTES,
  MAX_TEMPLATES_PER_ROOT,
  readBookmarkFromCatalogEntry,
} from './templatePath.js';

const BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.donor' caption='Donor Secret'>" +
  "<column name='[Donor Measure]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Donor Dimension]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.donor].[none:Donor Dimension:nk]</rows>' +
  '<cols>[federated.donor].[sum:Donor Measure:qk]</cols>' +
  '</table>' +
  '</bookmark>';

describe('template path', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    restoreEnvironment('TEMPLATES_DIR', originalTemplatesDir);
  });

  it('resolves the canonical TBM path', () => {
    process.env['TEMPLATES_DIR'] = '/tmp/tableau-template-path';
    expect(getBookmarkPath('ranking-ordered-bar')).toBe(
      '/tmp/tableau-template-path/ranking-ordered-bar.tbm',
    );
  });

  it('rejects traversal, separators, NUL, and empty names', () => {
    for (const name of ['', '.', '..', '../escape', 'nested/name', 'nested\\name', 'bad\0name']) {
      expect(() => getBookmarkPath(name), name).toThrow(/Invalid template name/);
    }
  });
});

describe('TBM catalog', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];
  const originalRepositoryDir = process.env['TABLEAU_REPOSITORY_DIR'];
  const temporaryRoots: string[] = [];

  afterEach(() => {
    restoreEnvironment('TEMPLATES_DIR', originalTemplatesDir);
    restoreEnvironment('TABLEAU_REPOSITORY_DIR', originalRepositoryDir);
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function temporaryDirectory(label: string): string {
    const root = mkdtempSync(join(process.cwd(), `tmp-template-${label}-`));
    temporaryRoots.push(root);
    return root;
  }

  function repositoryRoot(): string {
    const root = temporaryDirectory('repository');
    mkdirSync(join(root, 'Tableau Agent', 'templates', '.vendored', 'overridable'), {
      recursive: true,
    });
    mkdirSync(join(root, 'Bookmarks'), { recursive: true });
    process.env['TABLEAU_REPOSITORY_DIR'] = root;
    delete process.env['TEMPLATES_DIR'];
    return root;
  }

  function swapAfterOpen(
    cataloguedPath: string,
    replacementPath: string,
  ): ContainedFileReadOperations {
    let swapped = false;
    return {
      open: (path, flags) => openSync(path, flags),
      fstat: (fd) => {
        const opened = fstatSync(fd);
        if (!swapped) {
          swapped = true;
          unlinkSync(cataloguedPath);
          symlinkSync(replacementPath, cataloguedPath);
        }
        return opened;
      },
      realpath: (path) => realpathSync(path),
      stat: (path) => statSync(path),
      read: (fd) => readFileSync(fd),
      close: (fd) => closeSync(fd),
    };
  }

  function withoutStableInode(stats: Stats): Stats {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
    Object.defineProperty(copy, 'ino', { value: 0, configurable: true });
    return copy;
  }

  function inodeUnavailableOperations(): ContainedFileReadOperations {
    return {
      open: (path, flags) => openSync(path, flags),
      fstat: (fd) => withoutStableInode(fstatSync(fd)),
      realpath: (path) => realpathSync(path),
      stat: (path) => withoutStableInode(statSync(path)),
      read: (fd) => readFileSync(fd),
      close: (fd) => closeSync(fd),
    };
  }

  it('resolves custom over pack over protected and reveals the next tier after deletion', () => {
    const root = repositoryRoot();
    const customPath = join(root, 'Tableau Agent', 'templates', 'ranking-ordered-bar.tbm');
    const packPath = join(
      root,
      'Tableau Agent',
      'templates',
      '.vendored',
      'overridable',
      'ranking-ordered-bar.tbm',
    );
    writeFileSync(packPath, BOOKMARK.replaceAll('Donor Measure', 'Pack Measure'));
    writeFileSync(customPath, BOOKMARK.replaceAll('Donor Measure', 'Custom Measure'));

    const custom = getTemplateCatalogEntry('ranking-ordered-bar');
    expect(custom).toMatchObject({ provenance: 'custom', overridesLowerPrecedence: true });
    expect(readBookmarkFromCatalogEntry(custom!)).toContain('Custom Measure');

    unlinkSync(customPath);
    const pack = getTemplateCatalogEntry('ranking-ordered-bar');
    expect(pack).toMatchObject({ provenance: 'overridable', overridesLowerPrecedence: true });
    expect(readBookmarkFromCatalogEntry(pack!)).toContain('Pack Measure');

    unlinkSync(packPath);
    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'protected',
      overridesLowerPrecedence: false,
    });
  });

  it('can list only external repository tiers with custom precedence intact', () => {
    const root = repositoryRoot();
    const customPath = join(root, 'Tableau Agent', 'templates', 'shared.tbm');
    const packPath = join(
      root,
      'Tableau Agent',
      'templates',
      '.vendored',
      'overridable',
      'shared.tbm',
    );
    writeFileSync(packPath, BOOKMARK.replaceAll('Donor Measure', 'Pack Measure'));
    writeFileSync(customPath, BOOKMARK.replaceAll('Donor Measure', 'Custom Measure'));

    const catalog = listTemplateCatalog({ includeProtected: false });

    expect(catalog).not.toContainEqual(expect.objectContaining({ provenance: 'protected' }));
    expect(catalog).toContainEqual(
      expect.objectContaining({
        template: 'shared',
        provenance: 'custom',
        overridesLowerPrecedence: true,
      }),
    );
  });

  it('classifies canonical Bookmarks alongside template tiers without scanning nested files', () => {
    const root = repositoryRoot();
    const custom = join(root, 'Tableau Agent', 'templates');
    mkdirSync(join(custom, 'nested'));
    writeFileSync(join(root, 'Bookmarks', 'ordinary.tbm'), BOOKMARK);
    writeFileSync(join(custom, 'old.xml'), '<workbook/>');
    writeFileSync(join(custom, 'old.json'), '{}');
    writeFileSync(join(custom, 'nested', 'nested.tbm'), BOOKMARK);
    writeFileSync(join(custom, 'direct.tbm'), BOOKMARK);

    const catalog = listTemplateCatalog();
    const names = catalog.map((entry) => entry.template);
    expect(names).toContain('direct');
    expect(catalog).toContainEqual(
      expect.objectContaining({ template: 'ordinary', provenance: 'bookmark' }),
    );
    expect(names).not.toContain('old');
    expect(names).not.toContain('nested');
  });

  it('keeps custom over Bookmarks over pack over protected for the same TBM name', () => {
    const root = repositoryRoot();
    const customPath = join(root, 'Tableau Agent', 'templates', 'ranking-ordered-bar.tbm');
    const bookmarkPath = join(root, 'Bookmarks', 'ranking-ordered-bar.tbm');
    const packPath = join(
      root,
      'Tableau Agent',
      'templates',
      '.vendored',
      'overridable',
      'ranking-ordered-bar.tbm',
    );
    writeFileSync(packPath, BOOKMARK.replaceAll('Donor Measure', 'Pack Measure'));
    writeFileSync(bookmarkPath, BOOKMARK.replaceAll('Donor Measure', 'Bookmark Measure'));
    writeFileSync(customPath, BOOKMARK.replaceAll('Donor Measure', 'Custom Measure'));

    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
    });

    unlinkSync(customPath);
    const bookmark = getTemplateCatalogEntry('ranking-ordered-bar');
    expect(bookmark).toMatchObject({ provenance: 'bookmark', overridesLowerPrecedence: true });
    expect(readBookmarkFromCatalogEntry(bookmark!)).toContain('Bookmark Measure');

    unlinkSync(bookmarkPath);
    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'overridable',
      overridesLowerPrecedence: true,
    });

    unlinkSync(packPath);
    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'protected',
      overridesLowerPrecedence: false,
    });
  });

  it('keeps an invalid higher-tier collision as the winning failed claim', () => {
    const root = repositoryRoot();
    writeFileSync(
      join(root, 'Tableau Agent', 'templates', '.vendored', 'overridable', 'shared.tbm'),
      BOOKMARK,
    );
    writeFileSync(join(root, 'Tableau Agent', 'templates', 'shared.tbm'), '<not-a-bookmark/>');

    const winner = getTemplateCatalogEntry('shared');
    expect(winner).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
      discoveryIssue: 'invalid-or-unreadable',
    });
    expect(readBookmarkFromCatalogEntry(winner!)).toBeNull();
  });

  it('diagnoses malformed TBM filenames without disabling valid or protected entries', () => {
    const root = repositoryRoot();
    const custom = join(root, 'Tableau Agent', 'templates');
    writeFileSync(join(custom, '.tbm'), BOOKMARK);
    writeFileSync(join(custom, 'bad\\name.tbm'), BOOKMARK);
    writeFileSync(join(custom, 'valid.tbm'), BOOKMARK);

    const catalog = listTemplateCatalog();
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ template: 'valid', provenance: 'custom' }),
        expect.objectContaining({ template: 'ranking-ordered-bar', provenance: 'protected' }),
        expect.objectContaining({
          template: '',
          provenance: 'custom',
          discoveryIssue: 'invalid-name',
        }),
        expect.objectContaining({
          template: 'bad\\name',
          provenance: 'custom',
          discoveryIssue: 'invalid-name',
        }),
      ]),
    );
    expect(listTemplateNames()).toContain('valid');
    expect(listTemplateNames()).not.toContain('');
    expect(listTemplateNames()).not.toContain('bad\\name');
  });

  it('keeps TEMPLATES_DIR exclusive and accepts only TBM files from it', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Tableau Agent', 'templates', 'repository-only.tbm'), BOOKMARK);
    const override = temporaryDirectory('dev-override');
    writeFileSync(join(override, 'dev-only.tbm'), BOOKMARK);
    writeFileSync(join(override, 'ignored.xml'), '<workbook/>');
    writeFileSync(join(override, 'ignored.json'), '{}');
    process.env['TEMPLATES_DIR'] = override;

    expect(listTemplateCatalog()).toEqual([
      expect.objectContaining({ template: 'dev-only', provenance: 'dev-override' }),
    ]);
  });

  it('rejects symlinks that escape a source root', () => {
    const root = repositoryRoot();
    const outside = temporaryDirectory('outside');
    const outsideBookmark = join(outside, 'escaped.tbm');
    writeFileSync(outsideBookmark, BOOKMARK);
    symlinkSync(outsideBookmark, join(root, 'Tableau Agent', 'templates', 'escaped.tbm'));

    expect(getTemplateCatalogEntry('escaped')).toMatchObject({
      provenance: 'custom',
      discoveryIssue: 'invalid-or-unreadable',
    });
  });

  it('rejects directories and oversized files while preserving their claims', () => {
    const root = repositoryRoot();
    const custom = join(root, 'Tableau Agent', 'templates');
    mkdirSync(join(custom, 'directory.tbm'));
    writeFileSync(
      join(custom, 'oversized.tbm'),
      BOOKMARK.replace('</bookmark>', `${'x'.repeat(MAX_EXTERNAL_TEMPLATE_BYTES)}</bookmark>`),
    );

    expect(getTemplateCatalogEntry('directory')).toMatchObject({
      discoveryIssue: 'invalid-or-unreadable',
    });
    expect(getTemplateCatalogEntry('oversized')).toMatchObject({
      discoveryIssue: 'file-too-large',
    });
  });

  it('rejects a path swap after opening instead of reading the replacement', () => {
    const root = repositoryRoot();
    const source = join(root, 'Tableau Agent', 'templates', 'swap.tbm');
    writeFileSync(source, BOOKMARK);
    const outside = temporaryDirectory('swap-outside');
    const replacement = join(outside, 'replacement.tbm');
    writeFileSync(replacement, BOOKMARK.replaceAll('Donor Measure', 'Outside Measure'));

    expect(
      listTemplateCatalog({ operations: swapAfterOpen(source, replacement) }).find(
        (entry) => entry.template === 'swap',
      ),
    ).toMatchObject({ discoveryIssue: 'invalid-or-unreadable' });
  });

  it('uses the opened descriptor safely when the filesystem does not expose inode identity', () => {
    const root = repositoryRoot();
    const customPath = join(root, 'Tableau Agent', 'templates', 'inode-zero.tbm');
    writeFileSync(customPath, BOOKMARK);
    const operations = inodeUnavailableOperations();

    const entry = listTemplateCatalog({ operations }).find(
      (candidate) => candidate.template === 'inode-zero',
    );
    expect(entry).toMatchObject({ provenance: 'custom' });
    expect(entry?.discoveryIssue).toBeUndefined();
    expect(readBookmarkFromCatalogEntry(entry!, operations)).toBe(BOOKMARK);
  });

  it('fails closed when one external root exceeds the file-count bound', () => {
    const root = repositoryRoot();
    const custom = join(root, 'Tableau Agent', 'templates');
    for (let index = 0; index <= MAX_TEMPLATES_PER_ROOT; index += 1) {
      writeFileSync(join(custom, `template-${index}.tbm`), BOOKMARK);
    }

    expect(() => listTemplateCatalog()).toThrow(/exceeds the maximum/);
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
