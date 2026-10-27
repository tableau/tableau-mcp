import { extractColorMaps } from '../../../../desktop/validation/colorMapReadback.js';
import { existingBuckets, spliceMemberColors } from './memberColorsSplice.js';
import { buildBuckets } from './memberColorsTarget.js';
import {
  BOOL_CI,
  BOOL_COLUMN_IN_DATASOURCE,
  datasourceDoc,
  DEFAULT_PALETTE_STYLE,
  encodingXml,
  STRING_CI,
  styleXml,
} from './memberColorsTestFixtures.js';

const FIELD = '[none:Category:nk]';

function splice(
  doc: string,
  buckets: Array<[string, string]>,
  instance = FIELD,
  instanceXml = STRING_CI,
): string {
  const built = buildBuckets(
    buckets.map(([member, color]) => ({ member, color })),
    'string',
  );
  if (!built.ok) throw new Error(built.message);
  const out = spliceMemberColors(doc, { instance, instanceXml }, built.buckets);
  if (out === undefined) throw new Error('splice failed');
  return out;
}

function mapsOf(xml: string): Array<[string, string]> {
  const maps = extractColorMaps(xml) ?? [];
  return maps.flatMap((map) => [...map.members]);
}

describe('spliceMemberColors', () => {
  it('copies the sheet column-instance after the last top-level column, past nested decoys', () => {
    const doc = datasourceDoc();
    const out = splice(doc, [['Furniture', '#ff0000']]);
    const salesColumn = out.indexOf("name='[Sales]' role='measure'");
    expect(out.indexOf(STRING_CI)).toBeGreaterThan(salesColumn);
    expect(out.indexOf(STRING_CI)).toBeLessThan(out.indexOf('<drill-paths>'));
    expect(out.match(/<column-instance /g)).toHaveLength(1);
  });

  it('puts the style after the layout and before semantic-values', () => {
    const out = splice(datasourceDoc({ instances: STRING_CI }), [['Furniture', '#ff0000']]);
    expect(out.indexOf('<layout ')).toBeLessThan(out.indexOf('<style>'));
    expect(out.indexOf('</style>')).toBeLessThan(out.indexOf('<semantic-values>'));
    expect(out).toContain(
      "<style><style-rule element='mark'><encoding attr='color' field='[none:Category:nk]' type='palette'><map to='#ff0000'><bucket>&quot;Furniture&quot;</bucket></map></encoding></style-rule></style>",
    );
  });

  it('reuses an existing column-instance without adding another', () => {
    const doc = datasourceDoc({ instances: STRING_CI });
    const out = splice(
      doc,
      [['Furniture', '#ff0000']],
      FIELD,
      '<column-instance name="never used" />',
    );
    expect(out.match(/<column-instance /g)).toHaveLength(1);
    expect(out).not.toContain('never used');
  });

  it('updates every encoding copy Desktop wrote, keeping other members and other fields', () => {
    const copy = encodingXml(FIELD, [
      ['#59a14f', '&quot;Office Supplies&quot;'],
      ['#9c755f', '&quot;Technology&quot;'],
    ]);
    const other = encodingXml('[none:Region:nk]', [['#111111', '&quot;East&quot;']]);
    const doc = datasourceDoc({ instances: STRING_CI, style: styleXml(copy, other, copy) });
    const out = splice(doc, [
      ['Technology', '#ff0000'],
      ['Furniture', '#0000ff'],
    ]);

    const copies = [
      ...out.matchAll(/<encoding attr='color' field='\[none:Category:nk\]'.*?<\/encoding>/g),
    ];
    expect(copies).toHaveLength(2);
    for (const [text] of copies) {
      expect(text).toContain('<bucket>&quot;Office Supplies&quot;</bucket>');
      expect(text).toContain("<map to='#ff0000'><bucket>&quot;Technology&quot;</bucket></map>");
      expect(text).toContain("<map to='#0000ff'><bucket>&quot;Furniture&quot;</bucket></map>");
      expect(text).not.toContain('#9c755f');
    }
    expect(out).toContain(other);
    expect(mapsOf(out)).toEqual(
      expect.arrayContaining([
        ['Office Supplies', '#59a14f'],
        ['Technology', '#ff0000'],
        ['Furniture', '#0000ff'],
        ['East', '#111111'],
      ]),
    );
  });

  it('removes a requested member from a shared map and drops the map only when it empties', () => {
    const shared = encodingXml(FIELD, [['#59a14f', '&quot;A&quot;</bucket><bucket>&quot;B&quot;']]);
    const out = splice(datasourceDoc({ instances: STRING_CI, style: styleXml(shared) }), [
      ['A', '#ff0000'],
    ]);
    expect(out).toContain(
      "<map to='#59a14f'><bucket>&quot;B&quot;</bucket></map><map to='#ff0000'><bucket>&quot;A&quot;</bucket></map>",
    );
    const emptied = splice(
      datasourceDoc({
        instances: STRING_CI,
        style: styleXml(encodingXml(FIELD, [['#59a14f', '&quot;A&quot;']])),
      }),
      [['A', '#ff0000']],
    );
    expect(emptied).not.toContain('#59a14f');
  });

  it('adds an encoding when the style holds only other fields, and fills a self-closing style', () => {
    const other = encodingXml('[none:Region:nk]', [['#111111', '&quot;East&quot;']]);
    const added = splice(datasourceDoc({ instances: STRING_CI, style: styleXml(other) }), [
      ['Furniture', '#ff0000'],
    ]);
    expect(added).toContain(other);
    expect(mapsOf(added)).toEqual(
      expect.arrayContaining([
        ['East', '#111111'],
        ['Furniture', '#ff0000'],
      ]),
    );
    const selfClosing = splice(datasourceDoc({ instances: STRING_CI, style: '<style />' }), [
      ['Furniture', '#ff0000'],
    ]);
    expect(mapsOf(selfClosing)).toEqual([['Furniture', '#ff0000']]);
    expect(selfClosing).not.toContain('<style />');
  });

  it('matches an encoding whose field is qualified with the datasource', () => {
    const qualified = encodingXml('[superstore].[none:Category:nk]', [
      ['#59a14f', '&quot;A&quot;'],
    ]);
    const out = splice(datasourceDoc({ instances: STRING_CI, style: styleXml(qualified) }), [
      ['B', '#ff0000'],
    ]);
    expect(out.match(/<encoding /g)).toHaveLength(1);
    expect(mapsOf(out)).toEqual(
      expect.arrayContaining([
        ['A', '#59a14f'],
        ['B', '#ff0000'],
      ]),
    );
  });

  it('writes boolean buckets bare and keeps a none: instance', () => {
    const built = buildBuckets(
      [
        { member: 'True', color: '#ff0000' },
        { member: 'false', color: '#d4c37a' },
      ],
      'boolean',
    );
    if (!built.ok) throw new Error(built.message);
    const out = spliceMemberColors(
      datasourceDoc({ columns: BOOL_COLUMN_IN_DATASOURCE }),
      { instance: '[none:Calculation_B001:nk]', instanceXml: BOOL_CI },
      built.buckets,
    );
    expect(out).toContain("<map to='#ff0000'><bucket>true</bucket></map>");
    expect(out).toContain("<map to='#d4c37a'><bucket>false</bucket></map>");
    expect(out).toContain(BOOL_CI);
  });

  it('returns undefined for a document that is not a datasource', () => {
    expect(
      spliceMemberColors('<workbook />', { instance: FIELD, instanceXml: STRING_CI }, []),
    ).toBeUndefined();
  });

  it('escapes member text in the spliced document', () => {
    const out = splice(datasourceDoc({ instances: STRING_CI }), [['R&D <East>', '#ff0000']]);
    expect(out).toContain('<bucket>&quot;R&amp;D &lt;East&gt;&quot;</bucket>');
    expect(mapsOf(out)).toEqual([['R&D <East>', '#ff0000']]);
  });

  it('writes the existing spelling for "furniture" on the real default-palette shape: one bucket, no duplicate', () => {
    const doc = datasourceDoc({ instances: STRING_CI, style: DEFAULT_PALETTE_STYLE });
    const existing = existingBuckets(doc, FIELD);
    expect(existing).toEqual(['"Technology"', '"Office Supplies"', '"Furniture"']);
    const built = buildBuckets([{ member: 'furniture', color: '#FF0000' }], 'string', { existing });
    if (!built.ok) throw new Error(built.message);
    const out = spliceMemberColors(doc, { instance: FIELD, instanceXml: STRING_CI }, built.buckets);
    expect(out?.match(/Furniture/gi)).toHaveLength(1);
    expect(out).toContain("<map to='#ff0000'><bucket>&quot;Furniture&quot;</bucket></map>");
    expect(out).not.toContain('f28e2b');
  });

  it('finds element names that start with an underscore', () => {
    const doc = datasourceDoc({
      instances: STRING_CI,
      extra:
        "<_.fcp.ObjectModelEncapsulateLegacy.true...object-graph><object id='x' /></_.fcp.ObjectModelEncapsulateLegacy.true...object-graph>",
      style: styleXml(encodingXml(FIELD, [['#59a14f', '&quot;A&quot;']])),
    });
    expect(mapsOf(splice(doc, [['B', '#ff0000']]))).toEqual(
      expect.arrayContaining([
        ['A', '#59a14f'],
        ['B', '#ff0000'],
      ]),
    );
    expect(existingBuckets(doc, FIELD)).toEqual(['"A"']);
  });
});

describe('existingBuckets', () => {
  it('returns undefined when the field has no color map', () => {
    expect(existingBuckets(datasourceDoc({ instances: STRING_CI }), FIELD)).toBeUndefined();
    expect(
      existingBuckets(
        datasourceDoc({
          style: styleXml(encodingXml('[none:Region:nk]', [['#111111', '&quot;East&quot;']])),
        }),
        FIELD,
      ),
    ).toBeUndefined();
  });

  it('collects buckets from every copy of the encoding, decoded and de-duplicated', () => {
    const copy = encodingXml(FIELD, [['#59a14f', '&quot;R&amp;D&quot;']]);
    expect(existingBuckets(datasourceDoc({ style: styleXml(copy, copy) }), FIELD)).toEqual([
      '"R&D"',
    ]);
  });
});
