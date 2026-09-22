import {
  applyReplacements,
  buildPostUnzipPlan,
  buildTextReplacements,
  deriveIdentity,
  mapToFinalRelativePath,
  slug,
  TEMPLATE_TWB_FILENAME,
  TREX_RELPATH,
  TWB_RELPATH,
} from './templateIdentity.js';

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
    });
  });
});

describe('buildTextReplacements', () => {
  it('maps every placeholder token in the .twb and data-app.trex', () => {
    const identity = deriveIdentity('Sales Demo');
    const replacements = buildTextReplacements(identity);

    expect(replacements[TWB_RELPATH]).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
    ]);
    expect(replacements[TREX_RELPATH]).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
    ]);
  });

  it('escapes displayName for XML text in the .twb and data-app.trex', () => {
    const identity = deriveIdentity('Tom & "Jerry" <Co>');
    const replacements = buildTextReplacements(identity);

    // XML text (.twb, .trex): & < > escaped, quotes left as-is.
    const xmlName = { find: 'TODO App Name', replace: 'Tom &amp; "Jerry" &lt;Co&gt;' };
    expect(replacements[TWB_RELPATH]).toContainEqual(xmlName);
    expect(replacements[TREX_RELPATH]).toContainEqual(xmlName);
  });
});

describe('applyReplacements', () => {
  it('applies literal find/replace edits in order', () => {
    const out = applyReplacements('id=com.example.name name=<TODO Name>', [
      { find: 'com.example.name', replace: 'com.tableau.mcp.x' },
      { find: '<TODO Name>', replace: 'My App' },
    ]);
    expect(out).toBe('id=com.tableau.mcp.x name=My App');
  });

  it('replaces every occurrence of each find', () => {
    expect(applyReplacements('<a/><a/>', [{ find: '<a/>', replace: 'X' }])).toBe('XX');
  });
});

describe('mapToFinalRelativePath', () => {
  const identity = deriveIdentity('Sales Demo');

  it('renames the workbook to the display name', () => {
    expect(mapToFinalRelativePath(TEMPLATE_TWB_FILENAME, identity)).toBe('Sales Demo.twb');
  });

  it('renames the package directory to the package id', () => {
    expect(mapToFinalRelativePath('Packages/TODO-MANIFEST-ID/content/src/app.js', identity)).toBe(
      'Packages/com.tableau.mcp.sales-demo/content/src/app.js',
    );
  });

  it('leaves unrelated paths unchanged', () => {
    expect(mapToFinalRelativePath('Packages', identity)).toBe('Packages');
  });
});

describe('buildPostUnzipPlan', () => {
  it('describes the same edits buildTextReplacements produces, rooted under the template dir', () => {
    const identity = deriveIdentity('Sales Demo');
    const plan = buildPostUnzipPlan(identity);

    expect(plan.edits).toContainEqual({
      file: `Data App Name/${TWB_RELPATH}`,
      replacements: buildTextReplacements(identity)[TWB_RELPATH],
    });
    expect(plan.edits).toContainEqual({
      file: `Data App Name/${TREX_RELPATH}`,
      replacements: buildTextReplacements(identity)[TREX_RELPATH],
    });
  });

  it('renames the package dir, workbook, and root dir, deepest paths first', () => {
    const identity = deriveIdentity('Sales Demo');
    const plan = buildPostUnzipPlan(identity);

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
