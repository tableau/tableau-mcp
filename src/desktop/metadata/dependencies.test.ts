import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDependencyGraph,
  DEPENDENCIES_NOT_COVERED,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyTrace,
  findDependencyRoots,
  getFieldDependencies,
  MAX_DEPENDENCY_ROOTS,
  traceDependencies,
} from './dependencies.js';

const SUPERSTORE = readFileSync(
  join(
    process.cwd(),
    'src/tools/desktop/authoring/datasource/__fixtures__/real-superstore-document.twb.xml',
  ),
  'utf-8',
);
const DS = 'Sample - Superstore';
const STANDOUTS = 'Profit by Sub-Category: Standouts vs Everyone Else';

const id = (datasource: string, name: string): string => `${datasource}\u0000${name}`;
const sheetId = (name: string): string => `worksheet\u0000${name}`;

function namesAtDepth(trace: DependencyTrace, depth: number): string[] {
  return trace.nodes
    .filter((node) => node.depth === depth)
    .map((node) => node.name)
    .sort();
}

function traceOne(
  graph: DependencyGraph,
  query: string,
  direction: 'dependents' | 'dependencies',
): DependencyTrace {
  const roots = findDependencyRoots(graph, query);
  expect(roots).toHaveLength(1);
  return traceDependencies(graph, roots[0].id, direction);
}

function workbook(datasources: string, worksheets = ''): string {
  return `<?xml version='1.0'?><workbook><datasources>${datasources}</datasources><worksheets>${worksheets}</worksheets></workbook>`;
}

function calc(name: string, formula: string, caption?: string): string {
  const captionAttr = caption ? ` caption='${caption}'` : '';
  return `<column${captionAttr} datatype='real' name='[${name}]' role='measure' type='quantitative'><calculation class='tableau' formula='${formula}' /></column>`;
}

describe('buildDependencyGraph on the real Superstore document', () => {
  const graph = buildDependencyGraph(SUPERSTORE);

  it('lists Member Profit dependents by shortest depth and stops before any dashboard', () => {
    const trace = traceOne(graph, 'Member Profit', 'dependents');

    expect(trace.root.id).toBe(id(DS, 'Calc_MemberProfit'));
    expect(namesAtDepth(trace, 1)).toEqual([
      'Calc_BottomThreshold',
      'Calc_ProfitTier',
      'Calc_TopThreshold',
    ]);
    expect(namesAtDepth(trace, 2)).toEqual(
      expect.arrayContaining(['Calc_DisplayProfit', 'Calc_SubCatGrouped', STANDOUTS]),
    );
    expect(trace.nodes.some((node) => node.kind === 'dashboard')).toBe(false);
    expect(trace.cycles).toEqual([]);
  });

  it('lists exactly Sub-Category and Profit as Member Profit dependencies', () => {
    const trace = traceOne(graph, 'Member Profit', 'dependencies');

    expect(namesAtDepth(trace, 1)).toEqual(['Profit', 'Sub-Category']);
    expect(trace.nodes.map((node) => node.name).sort()).toEqual([
      'Calc_MemberProfit',
      'Profit',
      'Sub-Category',
    ]);
    expect(trace.edges).toEqual([
      { from: id(DS, 'Calc_MemberProfit'), to: id(DS, 'Sub-Category'), kind: 'formula' },
      { from: id(DS, 'Calc_MemberProfit'), to: id(DS, 'Profit'), kind: 'formula' },
    ]);
  });

  it('reaches the dashboard through the worksheet that uses Region', () => {
    const trace = traceOne(graph, 'Region', 'dependents');

    expect(trace.nodes.map(({ kind, name, depth }) => ({ kind, name, depth }))).toEqual([
      { kind: 'field', name: 'Region', depth: 0 },
      { kind: 'worksheet', name: 'stage-encore-canon', depth: 1 },
      { kind: 'dashboard', name: 'Sales by Region', depth: 2 },
    ]);
    expect(trace.edges).toEqual([
      {
        from: sheetId('stage-encore-canon'),
        to: id(DS, 'Region'),
        kind: 'uses',
        locations: ['columns', 'filter', 'sort'],
      },
      {
        from: 'dashboard\u0000Sales by Region',
        to: sheetId('stage-encore-canon'),
        kind: 'contains',
      },
    ]);
  });

  it('takes worksheet uses from column-instances only, not declared input columns', () => {
    const standoutUses = graph.edges.filter(
      (edge) => edge.kind === 'uses' && edge.from === sheetId(STANDOUTS),
    );

    // Sub-Category is declared as a <column> on this sheet only because a calc on it needs it.
    expect(standoutUses).toEqual([
      {
        from: sheetId(STANDOUTS),
        to: id(DS, 'Calc_ProfitTier'),
        kind: 'uses',
        locations: ['encoding:color'],
      },
      {
        from: sheetId(STANDOUTS),
        to: id(DS, 'Calc_SubCatGrouped'),
        kind: 'uses',
        locations: ['rows', 'sort'],
      },
      {
        from: sheetId(STANDOUTS),
        to: id(DS, 'Calc_DisplayProfit'),
        kind: 'uses',
        locations: ['columns', 'sort'],
      },
    ]);
  });

  it('builds the measured formula edge set from workbook-level calcs', () => {
    const formulaEdges = graph.edges
      .filter((edge) => edge.kind === 'formula')
      .map((edge) => `${edge.from.split('\u0000')[1]} -> ${edge.to.split('\u0000')[1]}`)
      .sort();

    expect(formulaEdges).toEqual(
      [
        'Calc_BottomThreshold -> Calc_MemberProfit',
        'Calc_DisplayProfit -> Calc_ProfitTier',
        'Calc_DisplayProfit -> Profit',
        'Calc_DisplayProfit -> Sub-Category',
        'Calc_MemberProfit -> Profit',
        'Calc_MemberProfit -> Sub-Category',
        'Calc_ProfitTier -> Calc_BottomThreshold',
        'Calc_ProfitTier -> Calc_MemberProfit',
        'Calc_ProfitTier -> Calc_TopThreshold',
        'Calc_SubCatGrouped -> Calc_ProfitTier',
        'Calc_SubCatGrouped -> Sub-Category',
        'Calc_TopThreshold -> Calc_MemberProfit',
        'Calculation_1784458677440 -> Sales',
        'Calculation_1784459700001 -> Sales',
        'Calculation_1784470000001 -> Order Date',
        'Calculation_1784470000001 -> Sales',
      ].sort(),
    );
    expect(graph.nodes.some((node) => node.unresolved)).toBe(false);
  });

  it('summarizes the Member Profit blast radius in one sentence', () => {
    expect(getFieldDependencies(SUPERSTORE, 'member profit').summary).toBe(
      'Changing Member Profit (Sample - Superstore) affects 5 fields, 1 worksheet and no dashboards.',
    );
  });
});

describe('dependency graph edge cases', () => {
  it('ends a two-calc cycle in both directions and reports it', () => {
    const graph = buildDependencyGraph(
      workbook(`<datasource name='ds'>${calc('A', '[B] + 1')}${calc('B', '[A] * 2')}</datasource>`),
    );

    for (const direction of ['dependents', 'dependencies'] as const) {
      const trace = traceOne(graph, 'A', direction);
      expect(trace.nodes.map(({ name, depth }) => ({ name, depth }))).toEqual([
        { name: 'A', depth: 0 },
        { name: 'B', depth: 1 },
      ]);
      expect(trace.cycles).toHaveLength(1);
      expect([...trace.cycles[0]].sort()).toEqual([id('ds', 'A'), id('ds', 'B')]);
    }
  });

  it('ends and reports a calc that names itself', () => {
    const graph = buildDependencyGraph(
      workbook(`<datasource name='ds'>${calc('A', '[A]')}</datasource>`),
    );

    const trace = traceOne(graph, 'A', 'dependents');
    expect(trace.nodes.map((node) => node.name)).toEqual(['A']);
    expect(trace.edges).toEqual([{ from: id('ds', 'A'), to: id('ds', 'A'), kind: 'formula' }]);
    expect(trace.cycles).toEqual([[id('ds', 'A')]]);
  });

  it('says the root is in a cycle only when it is', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[R]' role='measure' type='quantitative' />" +
        `${calc('A', '[R] + [B]')}${calc('B', '[A]')}${calc('S', '[S]')}</datasource>`,
    );

    const outside = getFieldDependencies(xml, 'R');
    expect(outside.roots[0].cycles).toHaveLength(1);
    expect(outside.roots[0].cycles[0]).not.toContain(id('ds', 'R'));
    expect(outside.summary).toBe(
      'Changing R (ds) affects 2 fields, no worksheets and no dashboards. The walk reaches a formula cycle.',
    );

    expect(getFieldDependencies(xml, 'A').summary).toBe(
      'Changing A (ds) affects 1 field, no worksheets and no dashboards. It is part of a formula cycle.',
    );
    expect(getFieldDependencies(xml, 'S').summary).toBe(
      'Changing S (ds) affects no fields, no worksheets and no dashboards. It is part of a formula cycle.',
    );
    expect(getFieldDependencies(xml, 'S', { direction: 'dependencies' }).summary).toBe(
      'S (ds) depends on no fields. It is part of a formula cycle.',
    );
  });

  it('returns every datasource match and narrows to one with datasource', () => {
    const profit = (name: string): string =>
      `<column caption='Profit' datatype='real' name='[${name}]' role='measure' type='quantitative' />`;
    const xml = workbook(
      `<datasource name='east'>${profit('Profit')}</datasource>` +
        `<datasource caption='West Sales' name='west'>${profit('Profit (West)')}</datasource>`,
    );

    const both = getFieldDependencies(xml, 'Profit');
    expect(both.ambiguous).toBe(true);
    expect(both.roots.map((root) => root.root.id)).toEqual([
      id('east', 'Profit'),
      id('west', 'Profit (West)'),
    ]);

    const narrowed = getFieldDependencies(xml, 'Profit', { datasource: 'West Sales' });
    expect(narrowed.ambiguous).toBe(false);
    expect(narrowed.roots.map((root) => root.root.id)).toEqual([id('west', 'Profit (West)')]);
  });

  it('finds a parameter by caption and lists the calc that reads it', () => {
    const xml = workbook(
      "<datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>" +
        "<column caption='Top N' datatype='integer' name='[Parameter 1]' param-domain-type='range' role='measure' type='quantitative' value='10'>" +
        "<calculation class='tableau' formula='10' /></column></datasource>" +
        `<datasource name='ds'>${calc('Scaled', '[Sales] * [Parameters].[Parameter 1]')}` +
        "<column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
    );

    const result = getFieldDependencies(xml, 'top n');
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].root).toMatchObject({ kind: 'parameter', name: 'Parameter 1' });
    expect(result.roots[0].nodes.map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: 'Parameter 1', depth: 0 },
      { name: 'Scaled', depth: 1 },
    ]);
    // A parameter's formula is its current value, so it has no inputs of its own.
    expect(
      getFieldDependencies(xml, 'Top N', { direction: 'dependencies' }).roots[0].edges,
    ).toEqual([]);
  });

  it('finds no root for an unknown name and does no fuzzy matching', () => {
    const xml = workbook(
      "<datasource name='ds'><column caption='Profit Ratio' datatype='real' name='[Profit Ratio]' role='measure' type='quantitative' /></datasource>",
    );

    expect(getFieldDependencies(xml, 'Missing Field').roots).toEqual([]);
    expect(getFieldDependencies(xml, 'Profit').roots).toEqual([]);
    expect(getFieldDependencies(xml, '[Profit Ratio]').roots).toHaveLength(1);
  });

  it('keeps a reference to an undeclared field as an unresolved node', () => {
    const graph = buildDependencyGraph(
      workbook(`<datasource name='ds'>${calc('A', '[Ghost] + 1')}</datasource>`),
    );

    const trace = traceOne(graph, 'A', 'dependencies');
    expect(trace.nodes[1]).toEqual({
      id: id('ds', 'Ghost'),
      kind: 'field',
      name: 'Ghost',
      datasource: 'ds',
      unresolved: true,
      depth: 1,
    });
    expect(findDependencyRoots(graph, 'Ghost')).toEqual([]);
  });

  it('ignores formula copies in worksheet datasource-dependencies', () => {
    const xml = workbook(
      `<datasource name='ds'>${calc('A', '[B]')}<column datatype='real' name='[B]' role='measure' type='quantitative' /></datasource>`,
      "<worksheet name='Sheet 1'><table><view><datasource-dependencies datasource='ds'>" +
        `${calc('A', '[Stale]')}` +
        "<column-instance column='[A]' derivation='Sum' name='[sum:A:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view><rows>[ds].[sum:A:qk]</rows></table></worksheet>',
    );

    const trace = traceOne(buildDependencyGraph(xml), 'B', 'dependents');
    expect(trace.nodes.map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: 'B', depth: 0 },
      { name: 'A', depth: 1 },
      { name: 'Sheet 1', depth: 2 },
    ]);
    expect(trace.edges[1]).toEqual({
      from: sheetId('Sheet 1'),
      to: id('ds', 'A'),
      kind: 'uses',
      locations: ['rows'],
    });
  });

  it('follows an ad-hoc calc that exists only in a worksheet, scoped to that sheet', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
        "<column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='Sheet 1'><table><view><datasource-dependencies datasource='ds'>" +
        "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
        "<column caption='Margin' datatype='real' name='[Calculation_123]' role='measure' type='quantitative'>" +
        "<calculation class='tableau' formula='SUM([Profit]) / SUM([ds].[Sales])' /></column>" +
        "<column-instance column='[Calculation_123]' derivation='User' name='[usr:Calculation_123:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view><rows>[ds].[usr:Calculation_123:qk]</rows></table></worksheet>' +
        "<worksheet name='Sheet 2'><table><view><datasource-dependencies datasource='ds'>" +
        "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
        "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view><rows>[ds].[sum:Sales:qk]</rows></table></worksheet>',
    );

    const profit = getFieldDependencies(xml, 'Profit');
    expect(profit.roots[0].nodes.map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: 'Profit', depth: 0 },
      { name: 'Calculation_123', depth: 1 },
      { name: 'Sheet 1', depth: 2 },
    ]);
    expect(profit.summary).toBe(
      'Changing Profit (ds) affects 1 field, 1 worksheet and no dashboards.',
    );
    expect(profit.roots[0].nodes[1]).toMatchObject({ kind: 'calculation', worksheet: 'Sheet 1' });
    expect(getFieldDependencies(xml, 'Sales').roots[0].nodes.map((node) => node.name)).toEqual([
      'Sales',
      'Calculation_123',
      'Sheet 2',
      'Sheet 1',
    ]);
    expect(profit.notCovered).toEqual(DEPENDENCIES_NOT_COVERED);
  });

  it('follows a parameter that drives a top-N group filter, and the order-by field', () => {
    const xml = workbook(
      "<datasource hasconnection='false' inline='true' name='Parameters'>" +
        "<column caption='Top N' datatype='integer' name='[Parameter 1]' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column></datasource>" +
        "<datasource name='ds'><column datatype='string' name='[Region]' role='dimension' type='nominal' />" +
        "<column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='Top Regions'><table><view><datasource-dependencies datasource='ds'>" +
        "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />" +
        '</datasource-dependencies>' +
        "<filter class='categorical' column='[ds].[none:Region:nk]'>" +
        "<groupfilter count='[Parameters].[Parameter 1]' end='top' function='end' units='records'>" +
        "<groupfilter direction='DESC' expression='SUM([Sales])' function='order'>" +
        "<groupfilter function='level-members' level='[none:Region:nk]' />" +
        '</groupfilter></groupfilter></filter></view></table></worksheet>',
    );

    const parameter = getFieldDependencies(xml, 'Top N');
    expect(parameter.roots[0].nodes.map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: 'Parameter 1', depth: 0 },
      { name: 'Top Regions', depth: 1 },
    ]);
    expect(parameter.roots[0].edges[0].locations).toEqual(['filter']);
    expect(getFieldDependencies(xml, 'Sales').summary).toContain('1 worksheet');
  });

  it('follows a computed-sort field', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='Sorted'><table><view><datasource-dependencies datasource='ds'>" +
        "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />" +
        "</datasource-dependencies><computed-sort column='[ds].[none:Region:nk]' direction='DESC' using='[ds].[sum:Sales:qk]' />" +
        '</view></table></worksheet>',
    );

    expect(getFieldDependencies(xml, 'Sales').summary).toContain('1 worksheet');
  });

  it('fails closed: unreadable sheet parts are listed and never summarized as none', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='Odd'><table><view><datasource-dependencies datasource='ds'>" +
        "<column datatype='string' name='[Bucket]' role='dimension' type='nominal'><calculation class='categorical-bin' column='[Sales]' /></column>" +
        "</datasource-dependencies><filter class='categorical' column='[weird]' /></view>" +
        "<panes><pane><reference-line formula='average' value='[ds].[avg:Sales:qk]' /></pane></panes></table></worksheet>",
    );

    const result = getFieldDependencies(xml, 'Sales');
    expect(result.summary).toBe(
      "Changing Sales (ds) affects no fields, no worksheets found and no dashboards. 1 sheet has parts this tool can't read, none on the paths traced here.",
    );
    expect(result.notCovered).toEqual([
      ...DEPENDENCIES_NOT_COVERED,
      'worksheet Odd: calculation Bucket has no readable formula',
      'worksheet Odd: a filter on [weird], which is not a datasource-qualified field',
      'worksheet Odd: reference lines, whose formulas this tool does not read',
    ]);
  });

  it('skips pseudo-columns such as Measure Names', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='S'><table><view><datasource-dependencies datasource='ds'>" +
        "<column-instance column='[:Measure Names]' derivation='None' name='[:Measure Names]' pivot='key' type='nominal' />" +
        '</datasource-dependencies></view></table></worksheet>',
    );

    const graph = buildDependencyGraph(xml);
    expect(graph.nodes.some((node) => node.name.includes('Measure Names'))).toBe(false);
  });
});

describe('dependency graph on a Superstore copy with groups, sets, parameters and text', () => {
  const PARAMETERS =
    "<datasource hasconnection='false' inline='true' name='Parameters'><column caption='Top N' datatype='integer' name='[Parameter 1]' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column></datasource>";
  const DATASOURCE_FIELDS =
    "<column caption='Region Bucket' datatype='string' name='[Region Bucket]' role='dimension' type='nominal'><calculation class='categorical-bin' column='[Segment]' /></column>" +
    "<group caption='West Set' name='[West Set]' name-style='unqualified' user:ui-builder='filter-group'>" +
    "<groupfilter function='member' level='[Region]' member='&quot;West&quot;' user:ui-domain='database' user:ui-marker='enumerate' />" +
    '</group>';
  const SHEET_TEXT =
    '<layout-options><title><formatted-text><run>Top &lt;[Parameters].[Parameter 1]&gt;</run></formatted-text></title></layout-options>';
  const TOOLTIP =
    "<customized-tooltip><formatted-text><run fontcolor='#000000'>Disc: &lt;[Sample - Superstore].[sum:Discount:qk]&gt;</run></formatted-text></customized-tooltip>";

  function edited(): string {
    return SUPERSTORE.replace(
      /<column (?=[^>]*name='\[)/,
      (match) => `${DATASOURCE_FIELDS}${match}`,
    )
      .replace(
        "<datasources>\n    <datasource inline='true'",
        () => `<datasources>\n    ${PARAMETERS}\n    <datasource inline='true'`,
      )
      .replace(
        "<worksheet name='stage-encore-canon'>",
        () => `<worksheet name='stage-encore-canon'>${SHEET_TEXT}`,
      )
      .replace(
        "<datasource-dependencies datasource='Sample - Superstore'>\n            <column aggregate-role-from",
        () =>
          "<datasource-dependencies datasource='Parameters'><column caption='Top N' datatype='integer' name='[Parameter 1]' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column></datasource-dependencies>" +
          "<datasource-dependencies datasource='Sample - Superstore'>\n            <column aggregate-role-from",
      )
      .replace(
        /(<worksheet name='stage-encore-canon'>[\s\S]*?<pane[^>]*>)/,
        (match) => `${match}${TOOLTIP}`,
      );
  }

  it('applies every edit to the fixture', () => {
    const xml = edited();
    expect(xml).toContain('categorical-bin');
    expect(xml).toContain('West Set');
    expect(xml).toContain('Top &lt;[Parameters]');
    expect(xml).toContain('sum:Discount:qk');
  });

  it('follows a categorical-bin group to its source column', () => {
    const trace = traceOne(buildDependencyGraph(edited()), 'Region Bucket', 'dependencies');
    expect(namesAtDepth(trace, 1)).toEqual(['Segment']);
    expect(trace.edges.every((edge) => edge.kind === 'formula')).toBe(true);
  });

  it('follows a datasource set to the fields its group filter names', () => {
    const graph = buildDependencyGraph(edited());
    expect(namesAtDepth(traceOne(graph, 'West Set', 'dependencies'), 1)).toEqual(['Region']);
    const dependents = traceOne(graph, 'Region', 'dependents');
    expect(namesAtDepth(dependents, 1)).toEqual(
      expect.arrayContaining(['West Set', 'stage-encore-canon']),
    );
  });

  it('counts a parameter named only in a sheet title as used by that sheet', () => {
    const graph = buildDependencyGraph(edited());
    const trace = traceOne(graph, 'Top N', 'dependents');
    const use = trace.edges.find((edge) => edge.from === sheetId('stage-encore-canon'));
    expect(use?.locations).toEqual(expect.arrayContaining(['declared', 'text']));
  });

  it('counts a field named only in a tooltip as used by that sheet', () => {
    const trace = traceOne(buildDependencyGraph(edited()), 'Discount', 'dependents');
    const use = trace.edges.find((edge) => edge.from === sheetId('stage-encore-canon'));
    expect(use?.locations).toEqual(['text']);
  });

  it('reads parameters and tooltip fields from the real Desktop-saved shape', () => {
    const sheet = (name: string): string => `<worksheet name='${name}'>`;
    const xml = workbook(
      "<datasource name='Parameters'><column caption='Integer List' datatype='integer' name='[Integer List]' role='measure' type='quantitative' value='13'><calculation class='tableau' formula='13' /></column></datasource>" +
        "<datasource name='ds'><column datatype='real' name='[Profit]' role='measure' type='quantitative' /></datasource>",
      `${sheet('Sheet 1')}<layout-options><title><formatted-text><run fontcolor='#b40f1e'>A Parameter: &lt;[Parameters].[Integer List]&gt;&#10;</run></formatted-text></title></layout-options><table><view><datasource-dependencies datasource='ds'><column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' /></datasource-dependencies></view></table></worksheet>`,
    );
    const result = getFieldDependencies(xml, 'Integer List');
    expect(result.summary).toContain('1 worksheet');
  });

  it('reports a column-instance on an unknown column as unreadable for that sheet', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>",
      "<worksheet name='Odd'><table><view><datasource-dependencies datasource='ds'>" +
        "<column-instance column='[Mystery]' derivation='Sum' name='[sum:Mystery:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view></table></worksheet>',
    );

    const result = getFieldDependencies(xml, 'Sales');
    expect(result.summary).toContain("1 sheet has parts this tool can't read");
    expect(result.summary).not.toMatch(/affects no fields, no worksheets and/);
    expect(result.notCovered).toContain('worksheet Odd: Mystery is not a field this tool can read');
  });
});

describe('dependency graph fix round 3', () => {
  const DS_COLS =
    "<column datatype='string' name='[Cat]' role='dimension' type='nominal' />" +
    "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
    "<column datatype='string' name='[Calc]' role='dimension' type='nominal'><calculation class='tableau' formula='[Cat]' /></column>";

  it('reads four-part Desktop instance names as the real calc, in a filter and in a tooltip', () => {
    const xml = workbook(
      `<datasource name='ds'>${DS_COLS}</datasource>`,
      "<worksheet name='S'><table><view><datasource-dependencies datasource='ds'>" +
        "<column-instance column='[Calc]' derivation='User' name='[usr:Calc:nk:13]' pivot='key' type='nominal' />" +
        "</datasource-dependencies><filter class='categorical' column='[ds].[usr:Calc:nk:13]'><groupfilter function='member' level='[ds].[usr:Calc:nk:13]' member='&quot;a&quot;' /></filter></view>" +
        '<panes><pane><customized-tooltip><formatted-text><run>&lt;[ds].[usr:Calc:nk:2]&gt;</run></formatted-text></customized-tooltip></pane></panes></table></worksheet>',
    );
    const graph = buildDependencyGraph(xml);
    expect(graph.unreadable).toEqual([]);
    const use = graph.edges.find(
      (edge) => edge.from === sheetId('S') && edge.to === id('ds', 'Calc'),
    );
    expect(use?.locations).toEqual(expect.arrayContaining(['filter', 'text']));
    expect(graph.nodes.some((node) => node.unresolved)).toBe(false);
  });

  it('finds a field the sheet declares but its datasource does not list', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='string' name='[Cat]' role='dimension' type='nominal' /></datasource>",
      "<worksheet name='S'><table><view><datasource-dependencies datasource='ds'>" +
        "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
        "<column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view><rows>[ds].[sum:Profit:qk]</rows></table></worksheet>',
    );
    const result = getFieldDependencies(xml, 'Profit');
    expect(result.roots).toHaveLength(1);
    expect(result.summary).toContain('1 worksheet');
    expect(result.summary).not.toMatch(/can't read/);
    expect(buildDependencyGraph(xml).unreadable).toEqual([]);
  });

  it('puts the unreadable note once and traces at most five matching fields', () => {
    const datasources = Array.from(
      { length: 7 },
      (_, i) =>
        `<datasource name='d${i}'><column datatype='real' name='[Sales]' role='measure' type='quantitative' /></datasource>`,
    ).join('');
    const xml = workbook(
      datasources,
      "<worksheet name='Odd'><table><view><datasource-dependencies datasource='d0'>" +
        "<column-instance column='[Mystery]' derivation='Sum' name='[sum:Mystery:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view></table></worksheet>',
    );
    const result = getFieldDependencies(xml, 'Sales');
    expect(result.roots).toHaveLength(MAX_DEPENDENCY_ROOTS);
    expect(result.ambiguous).toBe(true);
    expect(result.summary).toContain("2 more fields match 'Sales'; pass datasource to narrow.");
    expect(result.summary.match(/parts this tool can't read/g)).toHaveLength(1);
  });

  const DASHBOARD_BASE =
    "<datasource name='Parameters' hasconnection='false'><column caption='Region Pick' datatype='string' name='[Parameter 1]' role='measure' type='nominal' value='&quot;East&quot;'><calculation class='tableau' formula='&quot;East&quot;' /></column></datasource>" +
    "<datasource name='ds'><column datatype='string' name='[Cat]' role='dimension' type='nominal' /></datasource>";

  function withDashboard(zones: string, title = ''): string {
    return workbook(DASHBOARD_BASE).replace(
      '</workbook>',
      `<dashboards><dashboard name='D'>${title}<zones>${zones}</zones></dashboard></dashboards></workbook>`,
    );
  }

  it('counts a parameter named in a dashboard title or text zone as used by the dashboard', () => {
    const xml = withDashboard(
      "<zone id='2' type-v2='text' h='1' w='1' x='0' y='0'><formatted-text><run>&lt;[Parameters].[Parameter 1]&gt;</run></formatted-text></zone>",
      '<layout-options><title><formatted-text><run>R: &lt;[Parameters].[Parameter 1]&gt;</run></formatted-text></title></layout-options>',
    );
    const result = getFieldDependencies(xml, 'Region Pick');
    expect(result.summary).toContain('1 dashboard');
    const use = result.roots[0].edges.find((edge) => edge.from === 'dashboard\u0000D');
    expect(use?.locations).toEqual(['text']);
  });

  it('counts a parameter-control zone as a control use by the dashboard', () => {
    const xml = withDashboard(
      "<zone id='3' h='1' w='1' x='0' y='0' param='[Parameters].[Parameter 1]' type-v2='paramctrl' />",
    );
    const result = getFieldDependencies(xml, 'Region Pick');
    expect(result.summary).toContain('1 dashboard');
    expect(result.roots[0].edges[0].locations).toEqual(['control']);
  });

  it('flags a dashboard whose text names an unknown field', () => {
    const xml = withDashboard(
      "<zone id='2' type-v2='text' h='1' w='1' x='0' y='0'><formatted-text><run>&lt;[ds].[Nope]&gt;</run></formatted-text></zone>",
    );
    const result = getFieldDependencies(xml, 'Cat');
    expect(result.notCovered).toContain('dashboard D: Nope is not a field this tool can read');
  });

  const zoneXml = (type: string, param: string): string =>
    `<zone id='${type}' type-v2='${type}' h='1' w='1' x='0' y='0' param='${param}' />`;
  const dashboardEdge = (xml: string, query: string): DependencyEdge | undefined =>
    getFieldDependencies(xml, query).roots[0].edges.find(
      (edge) => edge.from === 'dashboard\u0000D',
    );

  it('labels filter-card and legend zones by type', () => {
    const xml = withDashboard(
      zoneXml('filter', '[ds].[none:Cat:nk]') + zoneXml('color', '[ds].[none:Cat:nk]'),
    );
    expect(dashboardEdge(xml, 'Cat')?.locations).toEqual(['filter', 'legend']);
  });

  it('reads the legacy zone type attribute when type-v2 is absent', () => {
    const xml = withDashboard(
      "<zone id='1' type='filter' h='1' w='1' x='0' y='0' param='[ds].[none:Cat:nk]' />",
    );
    expect(dashboardEdge(xml, 'Cat')?.locations).toEqual(['filter']);
  });

  it('labels highlighter and currpage zones', () => {
    const xml = withDashboard(
      zoneXml('highlighter', '[ds].[none:Cat:nk]') + zoneXml('currpage', '[ds].[none:Cat:nk]'),
    );
    expect(dashboardEdge(xml, 'Cat')?.locations).toEqual(['highlight', 'pages']);
    expect(
      getFieldDependencies(xml, 'Cat').notCovered.some((entry) => entry.startsWith('dashboard D')),
    ).toBe(false);
  });

  it('counts an unclassified zone as a dashboard use and records it as unreadable', () => {
    const xml = withDashboard(zoneXml('map', '[ds].[none:Cat:nk]'));
    const result = getFieldDependencies(xml, 'Cat');
    expect(result.summary).toContain('1 dashboard');
    expect(result.roots[0].edges.find((e) => e.from === 'dashboard\u0000D')?.locations).toEqual([
      'other',
    ]);
    expect(result.notCovered).toContain(
      "dashboard D: a map zone uses Cat, which this tool doesn't classify",
    );
  });

  it('treats an unclassified zone on a parameter as a control use without a flag', () => {
    const xml = withDashboard(zoneXml('map', '[Parameters].[Parameter 1]'));
    const result = getFieldDependencies(xml, 'Region Pick');
    expect(result.roots[0].edges[0].locations).toEqual(['control']);
    expect(result.notCovered.some((entry) => entry.startsWith('dashboard D'))).toBe(false);
  });

  it('keeps a ghost-datasource placeholder unresolved and flagged', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Calc]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([ghost].[Extra])' /></column></datasource>",
      "<worksheet name='B'><table><view><datasource-dependencies datasource='ghost'>" +
        "<column datatype='real' name='[Extra]' role='measure' type='quantitative' />" +
        "<column-instance column='[Extra]' derivation='Sum' name='[sum:Extra:qk]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view></table></worksheet>',
    );
    expect(getFieldDependencies(xml, 'Extra').roots).toHaveLength(0);
    expect(getFieldDependencies(xml, 'Calc').notCovered).toContain(
      'worksheet B: Extra is not a field this tool can read',
    );
  });

  it('keeps a sheet-declared group unresolved and flagged', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='real' name='[Calc]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([G])' /></column></datasource>",
      "<worksheet name='B'><table><view><datasource-dependencies datasource='ds'>" +
        "<column datatype='string' name='[G]' role='dimension' type='nominal'><group name='[G]'><groupfilter function='member' level='[Cat]' member='&quot;a&quot;' /></group></column>" +
        '</datasource-dependencies></view></table></worksheet>',
    );
    const graph = buildDependencyGraph(xml);
    expect(graph.nodes.find((node) => node.name === 'G')?.unresolved).toBe(true);
    expect(graph.unreadable).toContainEqual({
      worksheet: 'B',
      reason: 'group G declared in the worksheet',
    });
  });

  it('does not flag an earlier sheet for a field a later sheet declares', () => {
    const sheet = (name: string, declared: boolean): string =>
      `<worksheet name='${name}'><table><view><datasource-dependencies datasource='ds'>` +
      (declared
        ? "<column datatype='real' name='[Extra]' role='measure' type='quantitative' />"
        : '') +
      "<column-instance column='[Extra]' derivation='Sum' name='[sum:Extra:qk]' pivot='key' type='quantitative' />" +
      '</datasource-dependencies></view></table></worksheet>';
    const xml = workbook(
      "<datasource name='ds'><column datatype='string' name='[Cat]' role='dimension' type='nominal' /></datasource>",
      sheet('A', false) + sheet('B', true),
    );
    const result = getFieldDependencies(xml, 'Extra');
    expect(result.summary).toContain('2 worksheets');
    expect(result.notCovered.some((entry) => entry.includes('not a field'))).toBe(false);
  });

  it('finds a sheet-only field that a datasource calc named first', () => {
    const xml = workbook(
      "<datasource name='ds'><column caption='Calc' datatype='real' name='[Calc]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([Extra])' /></column></datasource>",
      "<worksheet name='B'><table><view><datasource-dependencies datasource='ds'>" +
        "<column caption='Extra Cap' datatype='real' name='[Extra]' role='measure' type='quantitative' />" +
        "<column-instance column='[Extra]' derivation='Sum' name='[sum:Extra:qk:3]' pivot='key' type='quantitative' />" +
        '</datasource-dependencies></view><rows>[ds].[sum:Extra:qk:3]</rows></table></worksheet>',
    );
    const result = getFieldDependencies(xml, 'Extra Cap');
    expect(result.roots).toHaveLength(1);
    expect(result.summary).toContain('1 field, 1 worksheet');
    expect(result.notCovered.filter((entry) => entry.startsWith('worksheet B'))).toEqual([]);
    expect(getFieldDependencies(xml, 'Calc', { direction: 'dependencies' }).summary).toContain(
      'depends on 1 field',
    );
  });
});

describe('bin size parameters and colon-bearing field names', () => {
  const binXml = workbook(
    "<datasource hasconnection='false' inline='true' name='Parameters'>" +
      "<column caption='Profit Bin Size' datatype='integer' name='[Parameter 2]' param-domain-type='range' role='measure' type='quantitative' value='200'><calculation class='tableau' formula='200' /></column></datasource>" +
      "<datasource name='ds'><column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
      "<column aggregation='None' caption='Profit (bin)' datatype='integer' name='[Profit (bin)]' role='dimension' type='ordinal'>" +
      "<calculation class='bin' decimals='0' formula='[Profit]' peg='0' size-parameter='[Parameters].[Parameter 2]' /></column></datasource>",
  );

  it('lists the bin column as a dependent of its size parameter', () => {
    const result = getFieldDependencies(binXml, 'Profit Bin Size');
    const names = result.roots[0].nodes.map((node) => node.name);
    expect(names).toContain('Profit (bin)');
    expect(result.summary).not.toContain('affects no fields');
  });

  it('still reaches the bin column from the field it bins', () => {
    const names = getFieldDependencies(binXml, 'Profit').roots[0].nodes.map((node) => node.name);
    expect(names).toContain('Profit (bin)');
  });

  it('keeps a set built on a field whose name has several colons as its dependent', () => {
    const xml = workbook(
      "<datasource name='ds'><column datatype='string' name='[Q1: Net: Sales]' role='dimension' type='nominal' />" +
        "<group name='[Top Set]' name-style='unqualified' user:ui-builder='filter-group'>" +
        "<groupfilter function='level-members' level='[Q1: Net: Sales]' /></group></datasource>",
    );
    const names = getFieldDependencies(xml, 'Q1: Net: Sales').roots[0].nodes.map((n) => n.name);
    expect(names).toContain('Top Set');
  });
});
