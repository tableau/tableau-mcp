import {
  applyReplacements,
  buildPostUnzipPlan,
  buildTextReplacements,
  deriveIdentity,
  MANIFEST_RELPATH,
  mapToFinalRelativePath,
  slug,
  TEMPLATE_ROOT_DIRNAME,
  TEMPLATE_TWB_FILENAME,
  TREX_RELPATH,
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
  it('maps every placeholder token in manifest.json and data-app.trex', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const replacements = buildTextReplacements(identity);

    expect(replacements[MANIFEST_RELPATH]).toEqual([
      { find: 'com.example.name', replace: 'com.tableau.mcp.sales-demo' },
      { find: '<TODO Name>', replace: 'Sales Demo' },
      { find: '<TODO Username> via Tableau MCP', replace: 'jsmith@example.com via Tableau MCP' },
    ]);
    expect(replacements[TREX_RELPATH]).toEqual([
      { find: '<TODO-manifest-id>', replace: 'com.tableau.mcp.sales-demo' },
      { find: '<TODO Username> via Tableau MCP', replace: 'jsmith@example.com via Tableau MCP' },
    ]);
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
});

describe('mapToFinalRelativePath', () => {
  const identity = deriveIdentity('Sales Demo', undefined);

  it('renames the workbook to the display name', () => {
    expect(mapToFinalRelativePath(TEMPLATE_TWB_FILENAME, identity)).toBe('Sales Demo.twb');
  });

  it('renames the package directory to the package id', () => {
    expect(mapToFinalRelativePath('Packages/PackageId/manifest.json', identity)).toBe(
      'Packages/com.tableau.mcp.sales-demo/manifest.json',
    );
    expect(mapToFinalRelativePath('Packages/PackageId/content/src/app.js', identity)).toBe(
      'Packages/com.tableau.mcp.sales-demo/content/src/app.js',
    );
  });

  it('leaves unrelated paths unchanged', () => {
    expect(mapToFinalRelativePath('Packages', identity)).toBe('Packages');
  });
});

describe('buildPostUnzipPlan', () => {
  it('builds edits plus deepest-first renames ending at the root dir', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const plan = buildPostUnzipPlan(identity);

    expect(plan.edits.map((e) => e.file)).toEqual([
      `${TEMPLATE_ROOT_DIRNAME}/${MANIFEST_RELPATH}`,
      `${TEMPLATE_ROOT_DIRNAME}/${TREX_RELPATH}`,
    ]);
    // Every edit carries the derived identity.
    expect(JSON.stringify(plan.edits)).toContain('com.tableau.mcp.sales-demo');
    expect(JSON.stringify(plan.edits)).toContain('jsmith@example.com via Tableau MCP');

    expect(plan.renames).toEqual([
      {
        from: `${TEMPLATE_ROOT_DIRNAME}/Packages/PackageId`,
        to: `${TEMPLATE_ROOT_DIRNAME}/Packages/com.tableau.mcp.sales-demo`,
      },
      {
        from: `${TEMPLATE_ROOT_DIRNAME}/${TEMPLATE_TWB_FILENAME}`,
        to: `${TEMPLATE_ROOT_DIRNAME}/Sales Demo.twb`,
      },
      { from: TEMPLATE_ROOT_DIRNAME, to: 'Sales Demo' },
    ]);
  });
});
