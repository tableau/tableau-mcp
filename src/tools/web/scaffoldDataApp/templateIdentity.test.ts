import {
  applyReplacements,
  buildTextReplacements,
  deriveIdentity,
  MANIFEST_RELPATH,
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
  it('derives packageId, author, and displayName', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    expect(identity).toEqual({
      packageId: 'com.tableau.mcp.sales-demo',
      author: 'jsmith@example.com via Tableau MCP',
      displayName: 'Sales Demo',
    });
  });

  it('falls back to "Tableau MCP" when no username is available', () => {
    expect(deriveIdentity('X', undefined).author).toBe('Tableau MCP');
    expect(deriveIdentity('X', '').author).toBe('Tableau MCP');
  });

  it('sanitizes usernames so the author is safe to embed in JSON and XML', () => {
    // Quotes/angle brackets collapse to a single space; result trimmed.
    expect(deriveIdentity('X', 'a<b>"c').author).toBe('a b c via Tableau MCP');
    // A username with no safe characters degrades to the fallback.
    expect(deriveIdentity('X', '<<<>>>').author).toBe('Tableau MCP');
  });
});

describe('buildTextReplacements', () => {
  it('maps every placeholder token in the .twb, manifest.json, and data-app.trex', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const replacements = buildTextReplacements(identity);

    expect(replacements[TWB_RELPATH]).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
    ]);
    expect(replacements[MANIFEST_RELPATH]).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
      { find: 'TODO Username via Tableau MCP', replace: 'jsmith@example.com via Tableau MCP' },
    ]);
    expect(replacements[TREX_RELPATH]).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
      { find: 'TODO Username via Tableau MCP', replace: 'jsmith@example.com via Tableau MCP' },
    ]);
  });

  it('escapes displayName for the target format of each file', () => {
    const identity = deriveIdentity('Tom & "Jerry" <Co>', undefined);
    const replacements = buildTextReplacements(identity);

    // XML text (.twb, .trex): & < > escaped, quotes left as-is.
    const xmlName = { find: 'TODO App Name', replace: 'Tom &amp; "Jerry" &lt;Co&gt;' };
    expect(replacements[TWB_RELPATH]).toContainEqual(xmlName);
    expect(replacements[TREX_RELPATH]).toContainEqual(xmlName);
    // JSON string (manifest.json): quotes/backslashes escaped, & < > left as-is.
    expect(replacements[MANIFEST_RELPATH]).toContainEqual({
      find: 'TODO App Name',
      replace: 'Tom & \\"Jerry\\" <Co>',
    });
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
  const identity = deriveIdentity('Sales Demo', undefined);

  it('renames the workbook to the display name', () => {
    expect(mapToFinalRelativePath(TEMPLATE_TWB_FILENAME, identity)).toBe('Sales Demo.twb');
  });

  it('renames the package directory to the package id', () => {
    expect(mapToFinalRelativePath('Packages/TODO-MANIFEST-ID/manifest.json', identity)).toBe(
      'Packages/com.tableau.mcp.sales-demo/manifest.json',
    );
    expect(mapToFinalRelativePath('Packages/TODO-MANIFEST-ID/content/src/app.js', identity)).toBe(
      'Packages/com.tableau.mcp.sales-demo/content/src/app.js',
    );
  });

  it('leaves unrelated paths unchanged', () => {
    expect(mapToFinalRelativePath('Packages', identity)).toBe('Packages');
  });
});
