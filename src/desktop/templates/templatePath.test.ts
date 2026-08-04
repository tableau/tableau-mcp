import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import {
  type ContainedFileReadOperations,
  getTemplateCatalogEntry,
  getTemplatePath,
  listBookmarkNames,
  listTemplateCatalog,
  listTemplateNames,
  MAX_EXTERNAL_TEMPLATE_BYTES,
  readBookmark,
  readBookmarkFromCatalogEntry,
  readTemplate,
  readTemplateArtifact,
  readXmlFromCatalogEntry,
  type TemplateCatalogEntry,
} from './templatePath.js';

// A modern bookmark with a real donor <column> dictionary — the metadata-free drop-in
// case. No manifest, no tokenized `.xml`; everything an agent needs is inferred from this.
const DROPPED_IN_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.x' caption='Superstore'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.x].[none:Category:nk]</rows>' +
  '<cols>[federated.x].[sum:Sales:qk]</cols>' +
  '</table>' +
  '</bookmark>';

const bookmarkWithField = (field: string): string => DROPPED_IN_BOOKMARK.replaceAll('Sales', field);

describe('getTemplatePath', () => {
  it('builds a path for a normal template name', () => {
    const p = getTemplatePath('ranking-ordered-bar');
    expect(p.endsWith('ranking-ordered-bar.xml')).toBe(true);
  });

  it('rejects path-traversal in the template name', () => {
    expect(() => getTemplatePath('../../etc/secret')).toThrow(/Invalid template name/);
  });

  it('rejects names with path separators or traversal while allowing safe punctuation', () => {
    expect(() => getTemplatePath('foo/bar')).toThrow(/Invalid template name/);
    expect(() => getTemplatePath('..')).toThrow(/Invalid template name/);
    expect(getTemplatePath('Sales..2025')).toContain('Sales..2025.xml');
    expect(getTemplatePath('My Sales View (Q4)!')).toContain('My Sales View (Q4)!.xml');
  });
});

describe('listTemplateNames', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
  });

  it('lists every backed template (.tbm bookmark or manifest-backed .xml), hiding raw orphans', () => {
    const templates = listTemplateNames();

    // Every `.tbm` bookmark is listable; the listing is the deduped union of those with
    // the manifest-backed `.xml` names. Assert against the live sources, not a magic count,
    // so dropping in another bookmark doesn't require touching this test.
    const bookmarks = listBookmarkNames();
    expect(new Set(templates).size).toBe(templates.length); // deduped
    expect(templates.length).toBeGreaterThanOrEqual(bookmarks.length);
    for (const b of bookmarks) expect(templates).toContain(b);

    expect(templates).toContain('ranking-ordered-bar');
    expect(templates).toContain('ranking-ordered-column');
    // Raw orphans — a `.xml` with neither a curated manifest nor a `.tbm` — stay hidden.
    expect(templates).not.toContain('ranking-bullet-chart');
    expect(templates).not.toContain('part-to-whole-waterfall-chart');
    expect(templates).not.toContain('spatial-filled-map');
  });

  it('keeps manifest-less templates from TEMPLATES_DIR discoverable', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'custom-chart.xml'), '<workbook/>');
      process.env['TEMPLATES_DIR'] = templatesDir;

      const templates = listTemplateNames();

      expect(templates).toContain('custom-chart');
      expect(templates).not.toContain('ranking-bullet-chart');
      expect(templates).not.toContain('part-to-whole-waterfall-chart');
      expect(templates).not.toContain('spatial-filled-map');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('surfaces a metadata-free `.tbm` drop-in (no manifest, no .xml)', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      expect(listBookmarkNames()).toEqual(['dropped-in-chart']);
      expect(listTemplateNames()).toContain('dropped-in-chart');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});

describe('readTemplate — `.tbm` is the canonical source', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
  });

  it('produces tokenized injectable XML from the bookmark when no `.xml` exists', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      const xml = readTemplate('dropped-in-chart');
      expect(xml).not.toBeNull();
      // The inject core's shape, parameterized to the generic tokens.
      expect(xml).toContain('<worksheet');
      expect(xml).toContain('{{TITLE}}');
      expect(xml).toContain('{{DATASOURCE}}');
      expect(xml).toContain('{{field_base_1}}');
      // The donor's identity must never survive into the injectable template.
      expect(xml).not.toContain('Sales');
      expect(xml).not.toContain('Category');
      expect(xml).not.toContain('Superstore');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('computes pass-1 eligibility alongside the canonical bookmark conversion', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      process.env['TEMPLATES_DIR'] = templatesDir;

      expect(readTemplateArtifact('dropped-in-chart')).toMatchObject({
        eligibility: { pass1_eligible: true, pass1_blockers: [] },
      });
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('treats an XML-only curated template as pass-1 eligible', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'curated-chart.xml'), '<workbook/>');
      process.env['TEMPLATES_DIR'] = templatesDir;

      expect(readTemplateArtifact('curated-chart')).toEqual({
        xml: '<workbook/>',
        eligibility: { pass1_eligible: true, pass1_blockers: [] },
      });
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it('prefers the bookmark over a tokenized `.xml` when both exist (TBM is canonical)', () => {
    const templatesDir = mkdtempSync(join(process.cwd(), 'tmp-template-path-test-'));
    try {
      writeFileSync(join(templatesDir, 'dropped-in-chart.tbm'), DROPPED_IN_BOOKMARK);
      writeFileSync(join(templatesDir, 'dropped-in-chart.xml'), '<workbook data-xml-tier/>');
      process.env['TEMPLATES_DIR'] = templatesDir;

      // The `.tbm` wins: the served XML is the freshly-inferred injectable workbook, NOT
      // the stale `.xml` fallback. Tokenization is a computed detail of the canonical .tbm.
      const xml = readTemplate('dropped-in-chart');
      expect(xml).not.toBe('<workbook data-xml-tier/>');
      expect(xml).toContain('{{field_base_1}}');
    } finally {
      rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});

describe('repository template discovery', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];
  const originalRepositoryDir = process.env['TABLEAU_REPOSITORY_DIR'];
  const temporaryRoots: string[] = [];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
    if (originalRepositoryDir === undefined) delete process.env['TABLEAU_REPOSITORY_DIR'];
    else process.env['TABLEAU_REPOSITORY_DIR'] = originalRepositoryDir;
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
          rmSync(cataloguedPath);
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

  it('resolves unqualified collisions custom > bookmark > overridable > protected', () => {
    const root = repositoryRoot();
    const custom = join(root, 'Tableau Agent', 'templates');
    const overridable = join(custom, '.vendored', 'overridable');
    const bookmarks = join(root, 'Bookmarks');

    writeFileSync(join(overridable, 'ranking-ordered-bar.tbm'), bookmarkWithField('OverrideField'));
    writeFileSync(join(bookmarks, 'ranking-ordered-bar.tbm'), bookmarkWithField('BookmarkField'));
    writeFileSync(join(custom, 'ranking-ordered-bar.tbm'), bookmarkWithField('CustomField'));
    writeFileSync(join(custom, 'custom-only.tbm'), bookmarkWithField('CustomOnlyField'));
    writeFileSync(
      join(overridable, 'ranking-ordered-column.tbm'),
      bookmarkWithField('OverrideField'),
    );
    writeFileSync(
      join(bookmarks, 'ranking-ordered-column.tbm'),
      bookmarkWithField('BookmarkField'),
    );

    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
    });
    expect(readBookmarkFromCatalogEntry(getTemplateCatalogEntry('ranking-ordered-bar')!)).toContain(
      'CustomField',
    );
    expect(readBookmark('ranking-ordered-bar')).not.toContain('CustomField');
    expect(getTemplateCatalogEntry('ranking-ordered-column')).toMatchObject({
      provenance: 'bookmark',
      overridesLowerPrecedence: true,
    });
    expect(
      readBookmarkFromCatalogEntry(getTemplateCatalogEntry('ranking-ordered-column')!),
    ).toContain('BookmarkField');
    expect(getTemplateCatalogEntry('kpi-text')).toMatchObject({
      provenance: 'protected',
      overridesLowerPrecedence: false,
    });
    const names = listTemplateCatalog().map((entry) => entry.template);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain('custom-only');
    expect(listTemplateNames()).not.toContain('custom-only');
  });

  it('keeps bundled protected templates available when repository roots are missing', () => {
    const root = temporaryDirectory('empty-repository');
    process.env['TABLEAU_REPOSITORY_DIR'] = root;
    delete process.env['TEMPLATES_DIR'];

    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'protected',
      overridesLowerPrecedence: false,
    });
  });

  it('rejects a bookmark symlink that resolves outside its source root', () => {
    const root = repositoryRoot();
    const outside = temporaryDirectory('outside');
    const outsideBookmark = join(outside, 'Escaped.tbm');
    writeFileSync(outsideBookmark, DROPPED_IN_BOOKMARK);
    symlinkSync(outsideBookmark, join(root, 'Bookmarks', 'Escaped.tbm'));

    expect(listTemplateNames()).not.toContain('Escaped');
    expect(readBookmark('Escaped')).toBeNull();
  });

  it('rechecks containment when a catalogued bookmark is replaced by an escaping symlink', () => {
    const root = repositoryRoot();
    const bookmarkPath = join(root, 'Bookmarks', 'Swap.tbm');
    writeFileSync(bookmarkPath, DROPPED_IN_BOOKMARK);
    const catalogEntry = getTemplateCatalogEntry('Swap');
    expect(catalogEntry).not.toBeNull();

    const outside = temporaryDirectory('swap-outside');
    const outsideBookmark = join(outside, 'Outside.tbm');
    writeFileSync(outsideBookmark, bookmarkWithField('OutsideField'));
    rmSync(bookmarkPath);
    symlinkSync(outsideBookmark, bookmarkPath);

    expect(readBookmarkFromCatalogEntry(catalogEntry!)).toBeNull();
  });

  it('reads no bookmark bytes when its path swaps after the file descriptor opens', () => {
    const root = repositoryRoot();
    const bookmarkPath = join(root, 'Bookmarks', 'FdSwap.tbm');
    writeFileSync(bookmarkPath, DROPPED_IN_BOOKMARK);
    const catalogEntry = getTemplateCatalogEntry('FdSwap');
    expect(catalogEntry).not.toBeNull();

    const outside = temporaryDirectory('fd-swap-outside');
    const outsideBookmark = join(outside, 'Outside.tbm');
    writeFileSync(outsideBookmark, bookmarkWithField('OutsideField'));

    expect(
      readBookmarkFromCatalogEntry(catalogEntry!, swapAfterOpen(bookmarkPath, outsideBookmark)),
    ).toBeNull();
  });

  it('does not admit a bookmark that swaps paths during scan-time validation', () => {
    const root = repositoryRoot();
    const bookmarkPath = join(root, 'Bookmarks', 'ScanSwap.tbm');
    writeFileSync(bookmarkPath, DROPPED_IN_BOOKMARK);
    const outside = temporaryDirectory('scan-swap-outside');
    const outsideBookmark = join(outside, 'Outside.tbm');
    writeFileSync(outsideBookmark, bookmarkWithField('OutsideField'));

    expect(
      listTemplateCatalog({
        operations: swapAfterOpen(bookmarkPath, outsideBookmark),
      }).find((entry) => entry.template === 'ScanSwap'),
    ).toMatchObject({ discoveryIssue: 'invalid-or-unreadable' });
  });

  it('accepts an explicit repository root without mutating request-global environment', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Bookmarks', 'ExplicitRoot.tbm'), DROPPED_IN_BOOKMARK);
    delete process.env['TABLEAU_REPOSITORY_DIR'];

    expect(listTemplateCatalog({ repositoryRoot: root }).map((entry) => entry.template)).toContain(
      'ExplicitRoot',
    );
    expect(process.env['TABLEAU_REPOSITORY_DIR']).toBeUndefined();
  });

  it('reads no dev XML bytes when its path swaps after the file descriptor opens', () => {
    const devRoot = temporaryDirectory('xml-fd-swap');
    const xmlPath = join(devRoot, 'FdSwap.xml');
    writeFileSync(xmlPath, '<workbook source="inside"/>');
    const outside = temporaryDirectory('xml-fd-swap-outside');
    const outsideXml = join(outside, 'Outside.xml');
    writeFileSync(outsideXml, '<workbook source="outside"/>');
    const entry: TemplateCatalogEntry = {
      template: 'FdSwap',
      provenance: 'dev-override',
      overridesLowerPrecedence: false,
      format: 'xml',
      xmlPath,
      sourceRoot: realpathSync(devRoot),
    };

    expect(readXmlFromCatalogEntry(entry, swapAfterOpen(xmlPath, outsideXml))).toBeNull();
  });

  it('skips a malformed user bookmark without hiding valid templates', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Bookmarks', 'Broken.tbm'), '<bookmark><table>');
    writeFileSync(join(root, 'Bookmarks', 'Valid.tbm'), DROPPED_IN_BOOKMARK);

    const catalogNames = listTemplateCatalog().map((entry) => entry.template);
    expect(catalogNames).toContain('Valid');
    expect(catalogNames).toContain('Broken');
    expect(getTemplateCatalogEntry('Broken')).toMatchObject({
      discoveryIssue: 'invalid-or-unreadable',
    });
    expect(readBookmarkFromCatalogEntry(getTemplateCatalogEntry('Broken')!)).toBeNull();
    expect(readTemplateArtifact('Valid')).toBeNull();
  });

  it('supports safe native bookmark names with spaces and punctuation end to end', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Bookmarks', 'Sales..2025 (Q4)!.tbm'), DROPPED_IN_BOOKMARK);

    const entry = getTemplateCatalogEntry('Sales..2025 (Q4)!');
    expect(entry).not.toBeNull();
    expect(readBookmarkFromCatalogEntry(entry!)).toContain('<bookmark');
    expect(listTemplateNames()).not.toContain('Sales..2025 (Q4)!');
    expect(() => readBookmark('../escape')).toThrow(/Invalid template name/);
    expect(() => readBookmark('nested/name')).toThrow(/Invalid template name/);
    expect(() => readBookmark('bad\0name')).toThrow(/Invalid template name/);
  });

  it('lets an invalid higher-precedence file claim its name instead of falling back', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Tableau Agent', 'templates', 'ranking-ordered-bar.tbm'), '<bad>');

    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
      discoveryIssue: 'invalid-or-unreadable',
    });
    expect(
      readBookmarkFromCatalogEntry(getTemplateCatalogEntry('ranking-ordered-bar')!),
    ).toBeNull();
  });

  it('rejects an oversized custom file while preserving its higher-precedence claim', () => {
    const root = repositoryRoot();
    const oversized =
      "<bookmark><datasources><datasource name='d'><column name='[Metric]' caption='" +
      'x'.repeat(MAX_EXTERNAL_TEMPLATE_BYTES) +
      "' datatype='real' role='measure' type='quantitative'/></datasource></datasources>" +
      '<table><cols>[d].[sum:Metric:qk]</cols></table></bookmark>';
    writeFileSync(join(root, 'Tableau Agent', 'templates', 'ranking-ordered-bar.tbm'), oversized);

    expect(getTemplateCatalogEntry('ranking-ordered-bar')).toMatchObject({
      provenance: 'custom',
      overridesLowerPrecedence: true,
      discoveryIssue: 'file-too-large',
    });
    expect(
      readBookmarkFromCatalogEntry(getTemplateCatalogEntry('ranking-ordered-bar')!),
    ).toBeNull();
  });

  it('keeps a legitimate large external bookmark below the byte limit usable', () => {
    const root = repositoryRoot();
    const largeBookmark = DROPPED_IN_BOOKMARK.replace(
      '</bookmark>',
      `<!--${'x'.repeat(300 * 1024)}--></bookmark>`,
    );
    writeFileSync(join(root, 'Bookmarks', 'large-valid.tbm'), largeBookmark);

    const entry = getTemplateCatalogEntry('large-valid');
    expect(entry).toMatchObject({ provenance: 'bookmark' });
    expect(entry?.discoveryIssue).toBeUndefined();
    expect(readBookmarkFromCatalogEntry(entry!)).toHaveLength(largeBookmark.length);
  });

  it('keeps TEMPLATES_DIR exclusive when a repository root is also configured', () => {
    const root = repositoryRoot();
    writeFileSync(join(root, 'Bookmarks', 'repository-only.tbm'), DROPPED_IN_BOOKMARK);
    const overrideDir = temporaryDirectory('dev-override');
    writeFileSync(join(overrideDir, 'dev-only.tbm'), DROPPED_IN_BOOKMARK);
    process.env['TEMPLATES_DIR'] = overrideDir;

    expect(listTemplateCatalog()).toEqual([
      expect.objectContaining({ template: 'dev-only', provenance: 'dev-override' }),
    ]);
    expect(listTemplateNames()).not.toContain('repository-only');
    expect(listTemplateNames()).not.toContain('ranking-ordered-bar');
  });
});
