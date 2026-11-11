import { buildBuckets, resolveColorTarget } from './memberColorsTarget.js';
import {
  AGG_CI,
  AGG_COLUMN,
  BOOL_CI,
  BOOL_COLUMN,
  CATEGORY_COLUMN,
  ORDINAL_STRING_CI,
  SET_CI,
  STRING_CI,
  worksheetXml,
} from './memberColorsTestFixtures.js';

const FIELD = '[none:Category:nk]';

function targetFor(xml: string, field?: string): ReturnType<typeof resolveColorTarget> {
  return resolveColorTarget(xml, field);
}

describe('resolveColorTarget', () => {
  it('finds a plain string dimension on Color', () => {
    const result = targetFor(worksheetXml());
    expect(result).toMatchObject({
      ok: true,
      target: {
        datasource: 'superstore',
        instance: FIELD,
        column: '[Category]',
        datatype: 'string',
      },
    });
    expect(result.ok && result.target.instanceXml).toBe(STRING_CI);
  });

  it('reads the boolean datatype from the column, not the none: derivation prefix', () => {
    const result = targetFor(
      worksheetXml({
        panes: ['[superstore].[none:Calculation_B001:nk]'],
        columns: [BOOL_COLUMN, CATEGORY_COLUMN],
        instances: [BOOL_CI, STRING_CI],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      target: { instance: '[none:Calculation_B001:nk]', datatype: 'boolean', label: 'Is Tech 1' },
    });
  });

  it('accepts a usr: aggregate calculation of string type', () => {
    const result = targetFor(
      worksheetXml({
        panes: ['[superstore].[usr:Calculation_7001:nk]'],
        columns: [AGG_COLUMN],
        instances: [AGG_CI],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      target: { instance: '[usr:Calculation_7001:nk]', datatype: 'string', label: 'Plan Status' },
    });
  });

  it('accepts the same field in several panes', () => {
    const result = targetFor(
      worksheetXml({
        panes: ['[superstore].[none:Category:nk]', '[superstore].[none:Category:nk]'],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('asks for field when panes color different fields, and then matches by caption, column or instance', () => {
    const xml = worksheetXml({
      panes: ['[superstore].[none:Category:nk]', '[superstore].[none:Calculation_B001:nk]'],
      columns: [BOOL_COLUMN, CATEGORY_COLUMN],
      instances: [BOOL_CI, STRING_CI],
    });
    const ambiguous = targetFor(xml);
    expect(ambiguous).toEqual({
      ok: false,
      message:
        "Several fields are on Color across the sheet's panes: Category, Is Tech 1. Pass field to choose one.",
    });
    for (const field of ['Is Tech 1', '[Calculation_B001]', 'none:Calculation_B001:nk']) {
      expect(targetFor(xml, field)).toMatchObject({
        ok: true,
        target: { instance: '[none:Calculation_B001:nk]' },
      });
    }
    expect(targetFor(xml, 'Region')).toMatchObject({
      ok: false,
      message: 'Field "Region" is not on Color. Fields on Color: Category, Is Tech 1.',
    });
  });

  it('tells the agent to put a discrete field on Color when nothing is there', () => {
    expect(targetFor(worksheetXml({ panes: [null] }))).toEqual({
      ok: false,
      message: 'Put a discrete field on Color first.',
    });
  });

  it('refuses Measure Names, also in a multi-pane sheet', () => {
    const measureNames = worksheetXml({ panes: ['[superstore].[:Measure Names]'] });
    expect(targetFor(measureNames)).toEqual({
      ok: false,
      message: 'Measure Names and Measure Values colors are not supported.',
    });
    const mixed = worksheetXml({
      panes: ['[superstore].[none:Category:nk]', '[superstore].[:Measure Names]'],
    });
    expect(targetFor(mixed, 'Measure Names')).toMatchObject({ ok: false });
    expect(targetFor(mixed, 'Category').ok).toBe(true);
  });

  it('lets field "Measure Names" reach the Measure Names refusal beside another color field', () => {
    const mixed = worksheetXml({
      panes: ['[superstore].[none:Category:nk]', '[superstore].[:Measure Names]'],
    });
    expect(targetFor(mixed, 'Measure Names')).toEqual({
      ok: false,
      message: 'Measure Names and Measure Values colors are not supported.',
    });
  });

  it('refuses a multi-field color', () => {
    const xml = worksheetXml().replace(
      "<color column='[superstore].[none:Category:nk]' />",
      "<color column='[superstore].[none:Category:nk]' /><color column='[superstore].[none:Region:nk]' />",
    );
    expect(targetFor(xml)).toEqual({
      ok: false,
      message: 'More than one field is on Color; this tool needs exactly one.',
    });
  });

  it('refuses a continuous instance, by type or by the :qk suffix', () => {
    const xml = worksheetXml({
      panes: ['[superstore].[sum:Sales:qk]'],
      instances: [STRING_CI],
    });
    expect(targetFor(xml)).toMatchObject({
      ok: false,
      message: expect.stringContaining('continuous'),
    });
    const typed = worksheetXml({
      panes: ['[superstore].[none:Category:nk]'],
      instances: [STRING_CI.replace("type='nominal'", "type='quantitative'")],
    });
    expect(targetFor(typed)).toMatchObject({
      ok: false,
      message: expect.stringContaining('continuous'),
    });
  });

  it('refuses a set with the live shape: an io: InOut instance and no column on the sheet', () => {
    const xml = worksheetXml({
      panes: ['[superstore].[io:Sub-Category Set:nk]'],
      columns: [],
      instances: [SET_CI],
    });
    expect(targetFor(xml)).toEqual({
      ok: false,
      message: '"Sub-Category Set" is a set; colors can be set only on fields.',
    });
  });

  it('lets a discrete ordinal field reach the datatype rule instead of calling it continuous', () => {
    const ordinal = (datatype: string): string =>
      worksheetXml({
        panes: ['[superstore].[none:Postal Code:ok]'],
        columns: [{ datatype, name: '[Postal Code]', role: 'dimension' }],
        instances: [ORDINAL_STRING_CI],
      });
    expect(targetFor(ordinal('string'))).toMatchObject({
      ok: true,
      target: { instance: '[none:Postal Code:ok]', datatype: 'string' },
    });
    expect(targetFor(ordinal('integer'))).toEqual({
      ok: false,
      message: '"Postal Code" has datatype integer; only string and boolean fields are supported.',
    });
  });

  it('refuses a group (categorical-bin) and a datatype other than string or boolean', () => {
    const group = worksheetXml({
      columns: [
        {
          caption: 'Manufacturer',
          datatype: 'string',
          name: '[Category]',
          role: 'dimension',
          calc: "<calculation class='categorical-bin' column='[Product Name]' new-bin='true' />",
        },
      ],
    });
    expect(targetFor(group)).toEqual({
      ok: false,
      message: '"Manufacturer" is a group; colors can be set only on fields.',
    });
    const integer = worksheetXml({
      columns: [{ datatype: 'integer', name: '[Category]', role: 'dimension' }],
    });
    expect(targetFor(integer)).toEqual({
      ok: false,
      message: '"Category" has datatype integer; only string and boolean fields are supported.',
    });
  });

  it('resolves an unqualified color column against the one non-Parameters datasource', () => {
    const xml = worksheetXml({ panes: ['[none:Category:nk]'] });
    expect(targetFor(xml)).toMatchObject({ ok: true, target: { datasource: 'superstore' } });
  });

  it('takes the column-instance from the chosen datasource when a blend repeats the name', () => {
    const other = STRING_CI.replace("derivation='None'", "derivation='None' caption='other'");
    const xml = worksheetXml().replace(
      '</table>',
      `<datasource-dependencies datasource='orders2'>${other}</datasource-dependencies></table>`,
    );
    const result = targetFor(xml);
    expect(result.ok && result.target.instanceXml).toBe(STRING_CI);
  });
});

describe('buildBuckets', () => {
  it('quotes string members and lowercases the color', () => {
    expect(buildBuckets([{ member: 'Furniture', color: '#FF0000' }], 'string')).toEqual({
      ok: true,
      buckets: [
        {
          member: 'Furniture',
          requested: 'Furniture',
          bucket: '"Furniture"',
          color: '#ff0000',
          via: 'unchecked',
        },
      ],
    });
  });

  it('accepts true/false in any case for a boolean and writes them bare', () => {
    expect(
      buildBuckets(
        [
          { member: 'TRUE', color: '#ff0000' },
          { member: ' False ', color: '#00ff00' },
        ],
        'boolean',
      ),
    ).toEqual({
      ok: true,
      buckets: [
        { member: 'true', requested: 'TRUE', bucket: 'true', color: '#ff0000', via: 'unchecked' },
        {
          member: 'false',
          requested: 'False',
          bucket: 'false',
          color: '#00ff00',
          via: 'unchecked',
        },
      ],
    });
  });

  it.each([
    [[{ member: 'yes', color: '#ff0000' }], 'boolean', 'is not valid for a boolean field'],
    [[{ member: 'A', color: 'red' }], 'string', 'must be #rrggbb'],
    [[{ member: '', color: '#ff0000' }], 'string', 'non-empty'],
    [[{ member: 'say "hi"', color: '#ff0000' }], 'string', 'no double quotes'],
    [
      [
        { member: 'A', color: '#ff0000' },
        { member: 'A', color: '#00ff00' },
      ],
      'string',
      'listed more than once',
    ],
    [
      [
        { member: 'true', color: '#ff0000' },
        { member: 'TRUE', color: '#00ff00' },
      ],
      'boolean',
      'listed more than once',
    ],
  ] as const)('rejects %j', (colors, datatype, expected) => {
    const result = buildBuckets(colors, datatype);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(expected) });
  });

  it('writes the existing spelling when a string member matches a bucket case-insensitively', () => {
    const existing = ['"Technology"', '"Office Supplies"', '"Furniture"'];
    expect(
      buildBuckets(
        [
          { member: ' furniture ', color: '#FF0000' },
          { member: 'Chairs', color: '#00ff00' },
        ],
        'string',
        { existing },
      ),
    ).toMatchObject({
      ok: true,
      buckets: [
        { member: 'Furniture', bucket: '"Furniture"', color: '#ff0000', via: 'existing' },
        { member: 'Chairs', bucket: '"Chairs"', color: '#00ff00', via: 'unchecked' },
      ],
    });
  });

  it('prefers the exact spelling over a case-insensitive match, in either order', () => {
    for (const existing of [
      ['"furniture"', '"Furniture"'],
      ['"Furniture"', '"furniture"'],
    ]) {
      expect(
        buildBuckets([{ member: ' Furniture ', color: '#ff0000' }], 'string', { existing }),
      ).toMatchObject({ ok: true, buckets: [{ member: 'Furniture', bucket: '"Furniture"' }] });
      expect(
        buildBuckets([{ member: 'furniture', color: '#ff0000' }], 'string', { existing }),
      ).toMatchObject({ ok: true, buckets: [{ bucket: '"furniture"' }] });
    }
  });

  it('rejects two spellings of one existing member', () => {
    expect(
      buildBuckets(
        [
          { member: 'furniture', color: '#ff0000' },
          { member: 'FURNITURE', color: '#00ff00' },
        ],
        'string',
        { existing: ['"Furniture"'] },
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('listed more than once') });
  });

  it('trims the member it writes and refuses a blank one', () => {
    expect(buildBuckets([{ member: '  Furniture  ', color: '#ff0000' }], 'string')).toMatchObject({
      ok: true,
      buckets: [{ member: 'Furniture', bucket: '"Furniture"' }],
    });
    expect(buildBuckets([{ member: '   ', color: '#ff0000' }], 'string')).toMatchObject({
      ok: false,
      message: expect.stringContaining('non-empty'),
    });
  });

  describe('against the sheet data', () => {
    const data = { values: ['Europe', 'Asia', 'EU'], complete: true };
    const build = (
      member: string,
      lookup: Parameters<typeof buildBuckets>[2],
    ): ReturnType<typeof buildBuckets> =>
      buildBuckets([{ member, color: '#ff0000' }], 'string', lookup);

    it('writes the data spelling for a wrong-case member (the case-sensitive source)', () => {
      expect(build('europe', { data, existing: ['"europe"'] })).toMatchObject({
        ok: true,
        buckets: [{ member: 'Europe', bucket: '"Europe"', via: 'data' }],
      });
    });

    it('prefers an exact data value over a case-insensitive hit', () => {
      expect(build('EU', { data: { values: ['Eu', 'EU'], complete: true } })).toMatchObject({
        buckets: [{ member: 'EU', via: 'data' }],
      });
    });

    it('resolves an alias display value to the raw member', () => {
      expect(
        build('eu', {
          data: { ...data, values: ['Europe', 'Asia'] },
          aliases: new Map([['EU', ['Europe']]]),
        }),
      ).toMatchObject({ buckets: [{ member: 'Europe', requested: 'eu', via: 'alias' }] });
    });

    it('falls to the existing map only when the data has no hit', () => {
      const incomplete = { values: ['Africa'], complete: false };
      expect(build('asia', { data: incomplete, existing: ['"asia"'] })).toMatchObject({
        buckets: [{ member: 'asia', via: 'existing' }],
      });
    });

    it('refuses the whole call, listing data members, when a member matches nothing in complete data', () => {
      const result = buildBuckets(
        [
          { member: 'Europe', color: '#ff0000' },
          { member: 'Mars', color: '#00ff00' },
        ],
        'string',
        { data },
      );
      expect(result).toMatchObject({
        ok: false,
        message: expect.stringContaining(
          "Mars is not in this sheet's data, so nothing was changed.",
        ),
      });
      expect(result.ok === false && result.message).toContain(
        'Members in the data: Europe, Asia, EU.',
      );
      expect(result.ok === false && result.message).toContain('colored from a sheet that shows it');
    });

    it('writes the raw data value when it has whitespace around it', () => {
      expect(build('europe', { data: { values: [' Europe'], complete: true } })).toMatchObject({
        ok: true,
        buckets: [{ member: ' Europe', bucket: '" Europe"', via: 'data' }],
      });
    });

    it('refuses a member that matches two spellings that differ only by case', () => {
      expect(
        build('europe', { data: { values: ['Europe', 'EUROPE'], complete: true } }),
      ).toMatchObject({ ok: false, message: expect.stringContaining('Europe, EUROPE') });
    });

    it('refuses an alias shared by two raw members, and an alias that clashes with a data value', () => {
      expect(build('eu', { aliases: new Map([['EU', ['Europe', 'Asia']]]) })).toMatchObject({
        ok: false,
        message: expect.stringContaining('Europe, Asia'),
      });
      expect(
        build('eu', {
          data: { values: ['Europe', 'Eu'], complete: true },
          aliases: new Map([['EU', ['Europe']]]),
        }),
      ).toMatchObject({ ok: false, message: expect.stringContaining('Europe, Eu') });
    });

    it("refuses an exact data value that is also another member's alias", () => {
      expect(
        build('EU', {
          data: { values: ['Europe', 'EU', 'Asia'], complete: true },
          aliases: new Map([
            ['EU', ['Europe']],
            ['European Union', ['EU']],
          ]),
        }),
      ).toMatchObject({
        ok: false,
        message: expect.stringContaining('matches more than one value or alias (EU, Europe)'),
      });
    });

    it.each(['Null', 'null', '%null%', '%all%'])('refuses the Null member "%s"', (member) => {
      expect(build(member, { data })).toMatchObject({
        ok: false,
        message: expect.stringContaining('cannot color the Null member'),
      });
    });

    it('refuses an alias that points at the Null member', () => {
      expect(build('none', { data, aliases: new Map([['None', ['%null%']]]) })).toMatchObject({
        ok: false,
        message: expect.stringContaining('cannot color the Null member'),
      });
    });

    it('does not refuse when the read hit the row cap', () => {
      expect(build('Mars', { data: { ...data, complete: false } })).toMatchObject({
        ok: true,
        buckets: [{ member: 'Mars', via: 'unmatched' }],
      });
    });
  });
});
