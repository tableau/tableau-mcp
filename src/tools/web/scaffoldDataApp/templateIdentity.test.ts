import {
  buildPostUnzipPlan,
  buildRequestedOriginsGuide,
  buildTextReplacements,
  deriveIdentity,
  MANIFEST_RELPATH,
  slug,
  TEMPLATE_TWB_FILENAME,
  TREX_RELPATH,
  TWB_RELPATH,
} from './templateIdentity.js';

const productVersion = { value: '2026.3.2', build: '20263.26.1027.1340' };

describe('slug', () => {
  it('lowercases, replaces runs of non-alphanumerics with a single hyphen, and trims', () => {
    expect(slug('Sales Demo')).toBe('sales-demo');
    expect(slug('Sales & Marketing #1')).toBe('sales-marketing-1');
    expect(slug('ABC')).toBe('abc');
    expect(slug('2024 Q1')).toBe('2024-q1');
  });

  it('falls back to "app" when no alphanumerics remain', () => {
    expect(slug('   ')).toBe('app');
    expect(slug('---')).toBe('app');
    expect(slug('!@#')).toBe('app');
  });
});

describe('deriveIdentity', () => {
  it('derives packageId and displayName', () => {
    const identity = deriveIdentity('Sales Demo');
    expect(identity).toEqual({
      packageId: 'com.tableau.mcp.sales-demo',
      displayName: 'Sales Demo',
      version: '1.0.0',
      author: 'Tableau MCP',
    });
  });
});

describe('buildTextReplacements', () => {
  it.each([
    [{ value: '2027.1.0', build: '20271.26.1201.0102' }, '2027.1.0 (20271.26.1201.0102)'],
    [{ value: '0.0.0', build: 'main.26.1005.0759' }, '0.0.0 (main.26.1005.0759)'],
  ])('formats the supplied server version %j', (version, expected) => {
    const replacements = buildTextReplacements(deriveIdentity('Sales Demo'), version);
    expect(replacements[TWB_RELPATH]).toContainEqual({
      find: 'TODO-SOURCE-BUILD',
      replace: expected,
    });
  });

  it('preserves app names containing the source-build placeholder', () => {
    const replacements = buildTextReplacements(
      deriveIdentity('My TODO-SOURCE-BUILD App'),
      productVersion,
    )[TWB_RELPATH];
    let xml =
      '<workbook source-build="TODO-SOURCE-BUILD"><worksheet name="TODO Sheet Name" /></workbook>';
    for (const { find, replace } of replacements) {
      xml = xml.split(find).join(replace);
    }
    expect(xml).toBe(
      '<workbook source-build="2026.3.2 (20263.26.1027.1340)"><worksheet name="My TODO-SOURCE-BUILD App" /></workbook>',
    );
  });

  it('XML-escapes server version and build values', () => {
    const replacements = buildTextReplacements(deriveIdentity('Sales Demo'), {
      value: '2026.3&2',
      build: 'build"<test>\'',
    });
    expect(replacements[TWB_RELPATH]).toContainEqual({
      find: 'TODO-SOURCE-BUILD',
      replace: '2026.3&amp;2 (build&quot;&lt;test&gt;&apos;)',
    });
  });

  it('maps every placeholder token in the .twb, data-app.trex, and manifest.json', () => {
    const identity = deriveIdentity('Sales Demo');
    const replacements = buildTextReplacements(identity, productVersion);

    expect(replacements[TWB_RELPATH]).toEqual([
      { find: 'TODO-SOURCE-BUILD', replace: '2026.3.2 (20263.26.1027.1340)' },
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
      { find: 'TODO Sheet Name', replace: 'Sales Demo' },
      { find: 'TODO-MANIFEST-VERSION', replace: '1.0.0' },
    ]);
    const shared = [
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
      { find: 'TODO-MANIFEST-VERSION', replace: '1.0.0' },
      { find: 'TODO Author Name', replace: 'Tableau MCP' },
    ];
    expect(replacements[TREX_RELPATH]).toEqual(shared);
    expect(replacements[MANIFEST_RELPATH]).toEqual(shared);
  });

  it('escapes displayName for XML text in the .twb and data-app.trex', () => {
    const identity = deriveIdentity('Tom & "Jerry" <Co>');
    const replacements = buildTextReplacements(identity, productVersion);

    // & < > and quotes are all escaped, so the result is safe in XML text or an attribute value.
    const xmlName = {
      find: 'TODO App Name',
      replace: 'Tom &amp; &quot;Jerry&quot; &lt;Co&gt;',
    };
    expect(replacements[TWB_RELPATH]).toContainEqual(xmlName);
    expect(replacements[TREX_RELPATH]).toContainEqual(xmlName);

    // The worksheet/window/referenced-view name token is derived from the same escaped
    // displayName, so the sheet tab never shows an unescaped app name either.
    expect(replacements[TWB_RELPATH]).toContainEqual({
      find: 'TODO Sheet Name',
      replace: 'Tom &amp; &quot;Jerry&quot; &lt;Co&gt;',
    });
  });

  it('JSON-escapes (not XML-escapes) displayName and author for manifest.json', () => {
    const identity = { ...deriveIdentity('Tom & "Jerry" \\ <Co>'), author: 'A "B" & C' };
    const replacements = buildTextReplacements(identity, productVersion);

    expect(replacements[MANIFEST_RELPATH]).toContainEqual({
      find: 'TODO App Name',
      replace: 'Tom & \\"Jerry\\" \\\\ <Co>',
    });
    expect(replacements[MANIFEST_RELPATH]).toContainEqual({
      find: 'TODO Author Name',
      replace: 'A \\"B\\" & C',
    });
    expect(replacements[TREX_RELPATH]).toContainEqual({
      find: 'TODO Author Name',
      replace: 'A &quot;B&quot; &amp; C',
    });
  });
});

describe('buildPostUnzipPlan', () => {
  it('describes the same edits buildTextReplacements produces, rooted under the template dir', () => {
    const identity = deriveIdentity('Sales Demo');
    const plan = buildPostUnzipPlan(identity, productVersion);

    expect(plan.edits).toContainEqual({
      file: `Data App Name/${TWB_RELPATH}`,
      replacements: buildTextReplacements(identity, productVersion)[TWB_RELPATH],
    });
    expect(plan.edits).toContainEqual({
      file: `Data App Name/${TREX_RELPATH}`,
      replacements: buildTextReplacements(identity, productVersion)[TREX_RELPATH],
    });
    expect(plan.edits).toContainEqual({
      file: `Data App Name/${MANIFEST_RELPATH}`,
      replacements: buildTextReplacements(identity, productVersion)[MANIFEST_RELPATH],
    });
  });

  it('renames the package dir, workbook, and root dir, deepest paths first', () => {
    const identity = deriveIdentity('Sales Demo');
    const plan = buildPostUnzipPlan(identity, productVersion);

    expect(plan.renames).toEqual([
      {
        from: 'Data App Name/Packages/TODO-MANIFEST-ID',
        to: 'Data App Name/Packages/com.tableau.mcp.sales-demo',
      },
      { from: `Data App Name/${TEMPLATE_TWB_FILENAME}`, to: 'Data App Name/Sales Demo.twb' },
      { from: 'Data App Name', to: 'Sales Demo' },
    ]);
  });
});

describe('buildRequestedOriginsGuide', () => {
  it('points at the finalized manifest.json, the path the postUnzip renames produce', () => {
    const identity = deriveIdentity('Sales Demo');
    const guide = buildRequestedOriginsGuide(identity);

    expect(guide.file).toBe('Sales Demo/Packages/com.tableau.mcp.sales-demo/manifest.json');
    const plan = buildPostUnzipPlan(identity, productVersion);
    const manifestEdit = plan.edits.find((edit) => edit.file.endsWith('/manifest.json'))!;
    let finalized = manifestEdit.file;
    for (const { from, to } of plan.renames) {
      if (finalized.startsWith(`${from}/`)) finalized = to + finalized.slice(from.length);
    }
    expect(finalized).toBe(guide.file);
  });

  it('describes the space-separated format and ties it to allowedOrigins', () => {
    const { instructions } = buildRequestedOriginsGuide(deriveIdentity('Sales Demo'));
    expect(instructions).toContain('space-separated');
    expect(instructions).toContain('allowedOrigins');
  });
});
