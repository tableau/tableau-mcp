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

  it('replaces every occurrence by default (or when occurrence is "all")', () => {
    expect(applyReplacements('<a/><a/>', [{ find: '<a/>', replace: 'X' }])).toBe('XX');
    expect(applyReplacements('<a/><a/>', [{ find: '<a/>', replace: 'X', occurrence: 'all' }])).toBe(
      'XX',
    );
  });

  it('with occurrence: "first", replaces only the first remaining occurrence, leaving later occurrences intact for a subsequent entry', () => {
    const out = applyReplacements('<a/><a/>', [
      { find: '<a/>', replace: 'ROOT', occurrence: 'first' },
      { find: '<a/>', replace: 'VIEW', occurrence: 'first' },
    ]);
    expect(out).toBe('ROOTVIEW');
  });

  it('with occurrence: "first", is a no-op when find does not appear', () => {
    const out = applyReplacements('no anchors here', [
      { find: '<a/>', replace: 'X', occurrence: 'first' },
    ]);
    expect(out).toBe('no anchors here');
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

describe('buildPostUnzipPlan', () => {
  it('builds edits plus deepest-first renames ending at the root dir', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const plan = buildPostUnzipPlan(identity);

    expect(plan.edits.map((e) => e.file)).toEqual([
      `${TEMPLATE_ROOT_DIRNAME}/${TWB_RELPATH}`,
      `${TEMPLATE_ROOT_DIRNAME}/${MANIFEST_RELPATH}`,
      `${TEMPLATE_ROOT_DIRNAME}/${TREX_RELPATH}`,
    ]);
    // Every edit carries the derived identity.
    expect(JSON.stringify(plan.edits)).toContain('com.tableau.mcp.sales-demo');
    expect(JSON.stringify(plan.edits)).toContain('jsmith@example.com via Tableau MCP');

    expect(plan.renames).toEqual([
      {
        from: `${TEMPLATE_ROOT_DIRNAME}/Packages/TODO-MANIFEST-ID`,
        to: `${TEMPLATE_ROOT_DIRNAME}/Packages/com.tableau.mcp.sales-demo`,
      },
      {
        from: `${TEMPLATE_ROOT_DIRNAME}/${TEMPLATE_TWB_FILENAME}`,
        to: `${TEMPLATE_ROOT_DIRNAME}/Sales Demo.twb`,
      },
      { from: TEMPLATE_ROOT_DIRNAME, to: 'Sales Demo' },
    ]);
  });

  it('leaves wiresDatasource unset and the .twb edits unchanged when wiringEdits is omitted', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const plan = buildPostUnzipPlan(identity);

    expect(plan.wiresDatasource).toBeUndefined();
    const twbEdit = plan.edits.find((e) => e.file === `${TEMPLATE_ROOT_DIRNAME}/${TWB_RELPATH}`);
    expect(twbEdit?.replacements).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
    ]);
  });

  it('sets wiresDatasource and appends two ordered occurrence:"first" <datasources /> replacements to the .twb edit when wiringEdits is given', () => {
    const identity = deriveIdentity('Sales Demo', 'jsmith@example.com');
    const plan = buildPostUnzipPlan(identity, {
      rootDatasourceXml: '<datasources>ROOT</datasources>',
      viewDatasourceXml: '<datasources>VIEW</datasources>',
    });

    expect(plan.wiresDatasource).toBe(true);
    const twbEdit = plan.edits.find((e) => e.file === `${TEMPLATE_ROOT_DIRNAME}/${TWB_RELPATH}`);
    expect(twbEdit?.replacements).toEqual([
      { find: 'TODO-MANIFEST-ID', replace: 'com.tableau.mcp.sales-demo' },
      { find: 'TODO App Name', replace: 'Sales Demo' },
      {
        find: '<datasources />',
        replace: '<datasources>ROOT</datasources>',
        occurrence: 'first',
      },
      {
        find: '<datasources />',
        replace: '<datasources>VIEW</datasources>',
        occurrence: 'first',
      },
    ]);

    // Other files' edits are untouched by wiringEdits.
    const manifestEdit = plan.edits.find(
      (e) => e.file === `${TEMPLATE_ROOT_DIRNAME}/${MANIFEST_RELPATH}`,
    );
    expect(manifestEdit?.replacements.some((r) => r.occurrence)).toBe(false);
  });
});
