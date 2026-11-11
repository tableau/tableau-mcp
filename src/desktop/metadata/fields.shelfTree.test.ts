import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { addFieldToEncoding, addFieldToRows, listFields, removeFieldFromRows } from './fields.js';
import { parseShelfTree, parseShelfValue, serializeShelfTree } from './shelfTree.js';

const TEMPLATES_DIR = join(__dirname, '..', 'data', 'templates');

function shelfXml(rows: string, panes = ''): string {
  return `<worksheet name="S"><table><view><datasources><datasource name="DS"/></datasources>
<datasource-dependencies datasource="DS">
<column name="[A]" datatype="real" role="measure" type="quantitative"/>
<column name="[B]" datatype="real" role="measure" type="quantitative"/>
<column name="[C]" datatype="real" role="measure" type="quantitative"/>
<column-instance name="[none:A:nk]" column="[A]" derivation="None" pivot="key" type="nominal"/>
<column-instance name="[none:B:nk]" column="[B]" derivation="None" pivot="key" type="nominal"/>
<column-instance name="[none:C:nk]" column="[C]" derivation="None" pivot="key" type="nominal"/>
<column name="[D]" datatype="real" role="measure" type="quantitative"/>
<column name="[N]" datatype="real" role="measure" type="quantitative"/>
<column-instance name="[none:D:nk]" column="[D]" derivation="None" pivot="key" type="nominal"/>
<column-instance name="[none:N:nk]" column="[N]" derivation="None" pivot="key" type="nominal"/>
</datasource-dependencies></view><rows>${rows}</rows><cols></cols>${panes}</table></worksheet>`;
}

describe('shelf tree', () => {
  it('reads leaf refs through grouping parens and operators', () => {
    expect(parseShelfValue('([DS].[none:A:nk] / [DS].[none:B:nk])')).toEqual([
      '[DS].[none:A:nk]',
      '[DS].[none:B:nk]',
    ]);
    expect(parseShelfValue('([DS].[none:A:nk] + ([DS].[none:B:nk] * [DS].[none:C:nk]))')).toEqual([
      '[DS].[none:A:nk]',
      '[DS].[none:B:nk]',
      '[DS].[none:C:nk]',
    ]);
  });

  it('keeps ] escapes and operator characters inside brackets', () => {
    const text = '([DS].[none:A]]+B/C:nk] + [DS].[none:D:nk])';
    expect(parseShelfValue(text)).toEqual(['[DS].[none:A]]+B/C:nk]', '[DS].[none:D:nk]']);
    expect(serializeShelfTree(parseShelfTree(text))).toBe(text);
  });

  it('round-trips every shelf in the shipped templates byte for byte', () => {
    const shelves: string[] = [];
    for (const file of readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.tbm'))) {
      const xml = readFileSync(join(TEMPLATES_DIR, file), 'utf8');
      for (const match of xml.matchAll(/<(rows|cols)>([^<]*)<\/\1>/g)) {
        if (match[2].trim()) shelves.push(match[2]);
      }
    }
    expect(shelves.length).toBeGreaterThanOrEqual(255);
    expect(shelves.some((s) => s.startsWith('('))).toBe(true);
    for (const shelf of shelves) {
      expect(serializeShelfTree(parseShelfTree(shelf))).toBe(shelf);
    }
  });

  it('removes a leaf from a grouped shelf and leaves balanced parens', () => {
    const xml = shelfXml('(([DS].[none:A:nk] + [DS].[none:B:nk]) / [DS].[none:C:nk])');
    const out = removeFieldFromRows(xml, '[DS].[none:A:nk]');
    expect(out).toContain('<rows>([DS].[none:B:nk] / [DS].[none:C:nk])</rows>');
    const last = removeFieldFromRows(
      removeFieldFromRows(out, '[DS].[none:C:nk]'),
      '[DS].[none:B:nk]',
    );
    expect(last).not.toMatch(/<rows>[^<]/);
  });

  it('collapses a two-leaf group to the bare remaining leaf', () => {
    const out = removeFieldFromRows(
      shelfXml('([DS].[none:A:nk] * [DS].[none:B:nk])'),
      '[DS].[none:A:nk]',
    );
    expect(out).toContain('<rows>[DS].[none:B:nk]</rows>');
  });

  it('lists the real refs on a grouped shelf', () => {
    const rows = listFields(shelfXml('([DS].[none:A:nk] / [DS].[none:B:nk])')).filter(
      (f) => f.location === 'rows',
    );
    expect(rows.map((f) => f.column)).toEqual(['[DS].[none:A:nk]', '[DS].[none:B:nk]']);
  });
});

describe('addFieldToEncoding text label rule', () => {
  it('does not append a second mark-labels-show rule', () => {
    const xml = shelfXml('[DS].[none:A:nk]', '<panes><pane><encodings></encodings></pane></panes>');
    const once = addFieldToEncoding(xml, 'text', '[DS].[none:B:nk]');
    const twice = addFieldToEncoding(once, 'text', '[DS].[none:C:nk]');
    expect(twice.match(/mark-labels-show/g)).toHaveLength(1);
  });
});

describe('addFieldToRows with an index on grouped shelves', () => {
  const N = '[DS].[none:N:nk]';
  const rowsOf = (xml: string): string => /<rows>([^<]*)<\/rows>/.exec(xml)?.[1] ?? '';
  const add = (rows: string, index: number): string =>
    rowsOf(addFieldToRows(shelfXml(rows), N, index));

  it.each([
    ['(A + B)', 0, 'N / (A + B)'],
    ['(A + B)', 1, '(A + B) / N'],
    ['(A * B)', 0, 'N / (A * B)'],
    ['(A * B)', 1, '(A * B) / N'],
  ])('never joins a + or * group: %s @%i', (rows, index, expected) => {
    const ref = (t: string): string => t.replace(/\b([A-D])\b/g, '[DS].[none:$1:nk]');
    const out = add(ref(rows), index);
    expect(out).toBe(ref(expected).replace(/\bN\b/, N));
  });

  it('inserts beside the whole + group under a / parent, right-nested like Tableau', () => {
    const ref = (t: string): string => t.replace(/\b([A-D])\b/g, '[DS].[none:$1:nk]');
    expect(add(ref('(D / (A + B))'), 1)).toBe(ref('(D / (N / (A + B)))').replace(/\bN\b/, N));
  });

  it('right-nests an indexed add into a / group like the shipped templates', () => {
    const ref = (t: string): string => t.replace(/\b([A-D])\b/g, '[DS].[none:$1:nk]');
    expect(add(ref('(A / B)'), 0)).toBe(ref('(N / (A / B))').replace(/\bN\b/, N));
  });
});

describe('addFieldToRows appending to an unparenthesized + or * shelf', () => {
  it.each([
    ['+', '[DS].[none:A:nk] + [DS].[none:B:nk]'],
    ['*', '[DS].[none:A:nk] * [DS].[none:B:nk]'],
  ])('joins with / outside the %s group', (_op, rows) => {
    const out = addFieldToRows(shelfXml(rows), '[DS].[none:D:nk]');
    expect(out).toContain(`<rows>(${rows}) / [DS].[none:D:nk]</rows>`);
  });
});
