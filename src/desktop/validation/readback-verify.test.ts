import { describe, expect, it } from 'vitest';

import {
  isReadbackUnsettled,
  type ReadbackFinding,
  verifyWorksheetReadback,
} from './readback-verify.js';

const GEO_FIELD = '[DS].[none:State:nk]';
const PROFIT_FIELD = '[DS].[sum:Profit:qk]';
const SALES_FIELD = '[DS].[sum:Sales:qk]';
const TOP_N_COLUMN = '[Sample - Superstore].[none:Product Name:nk]';
const TOP_N_LEVEL = '[none:Product Name:nk]';
const TOP_N_MEASURE = '[Sample - Superstore].[sum:Sales:qk]';
const CATEGORICAL_COLUMN = '[Sample - Superstore].[none:Region:nk]';
const CATEGORICAL_LEVEL = '[none:Region:nk]';

function worksheet(inner: string): string {
  return `<worksheet name="Blank Map"><table>${inner}</table></worksheet>`;
}

function encodedWorksheet(extra = ''): string {
  return worksheet(`
    <view>
      <computed-sort column="${GEO_FIELD}" direction="DESC" using="${PROFIT_FIELD}"/>
    </view>
    <panes><pane>
      <mark class="Shape"/>
      <encodings>
        <lod column="${GEO_FIELD}"/>
        <color column="${PROFIT_FIELD}"/>
      </encodings>
    </pane></panes>
    <filter class="categorical" column="${GEO_FIELD}"/>
    <rows>${GEO_FIELD}</rows>
    <cols>${PROFIT_FIELD}</cols>
    ${extra}
  `);
}

function topNGroupfilter(count: string, userAttributes: string): string {
  return `<groupfilter function="end" count="${count}" end="top" units="records" ${userAttributes}>
    <groupfilter function="order" direction="DESC" expression="SUM([Sales])" ${userAttributes}>
      <groupfilter function="level-members" level="${TOP_N_LEVEL}" ${userAttributes}/>
    </groupfilter>
  </groupfilter>`;
}

function topNWorksheet(groupfilter: string): string {
  return `<worksheet name="Top Products" xmlns:user="http://www.tableausoftware.com/xml/user">
    <table>
      <view>
        <datasource-dependencies datasource="Sample - Superstore">
          <column-instance column="[Product Name]" derivation="None" name="${TOP_N_LEVEL}" pivot="key" type="nominal"/>
          <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
        </datasource-dependencies>
        <filter class="categorical" column="${TOP_N_COLUMN}">${groupfilter}</filter>
        <computed-sort column="${TOP_N_COLUMN}" direction="DESC" using="${TOP_N_MEASURE}"/>
        <slices><column>${TOP_N_COLUMN}</column></slices>
      </view>
      <panes><pane><mark class="Bar"/></pane></panes>
      <rows>${TOP_N_COLUMN}</rows>
      <cols>[Sample - Superstore].[sum:Sales:qk]</cols>
    </table>
  </worksheet>`;
}

function categoricalWorksheet(filterAttributes: string, groupfilter: string): string {
  return `<worksheet name="Regions" xmlns:user="http://www.tableausoftware.com/xml/user">
    <table>
      <view>
        <filter ${filterAttributes}>${groupfilter}</filter>
      </view>
    </table>
  </worksheet>`;
}

const EAST_MEMBER = `<groupfilter function="member" level="${CATEGORICAL_LEVEL}" member="East" user:ui-enumeration="inclusive" user:ui-marker="east"/>`;
const WEST_MEMBER = `<groupfilter function="member" level="${CATEGORICAL_LEVEL}" member="West" user:ui-enumeration="inclusive" user:ui-marker="west"/>`;
const MEMBER_UNION = `<groupfilter function="union" user:ui-enumeration="inclusive" user:ui-marker="intended">${EAST_MEMBER}${WEST_MEMBER}</groupfilter>`;
const CATEGORICAL_FILTER_FINDING = {
  kind: 'filter',
  node: 'filter',
  column: CATEGORICAL_COLUMN,
  intended: `<filter class="categorical" column="${CATEGORICAL_COLUMN}">`,
  readback: 'changed',
  severity: 'error',
} as const;
const CATEGORICAL_FILTER_WARNING = { ...CATEGORICAL_FILTER_FINDING, severity: 'warning' } as const;

describe('verifyWorksheetReadback', () => {
  it('flags intended lod encodings that Tableau silently strips on readback', () => {
    const readback = encodedWorksheet().replace(`<lod column="${GEO_FIELD}"/>`, '');

    const findings = verifyWorksheetReadback(encodedWorksheet(), readback);

    expect(findings).toContainEqual({
      kind: 'encoding',
      node: 'lod',
      column: GEO_FIELD,
      intended: `<lod column="${GEO_FIELD}">`,
      readback: 'missing',
      severity: 'error',
    });
  });

  it('returns no findings for an identical readback', () => {
    const xml = encodedWorksheet();

    expect(verifyWorksheetReadback(xml, xml)).toEqual([]);
  });

  it('flags dropped filters by filter class and column', () => {
    const readback = encodedWorksheet().replace(
      `<filter class="categorical" column="${GEO_FIELD}"/>`,
      '',
    );

    const findings = verifyWorksheetReadback(encodedWorksheet(), readback);

    expect(findings).toContainEqual({
      kind: 'filter',
      node: 'filter',
      column: GEO_FIELD,
      intended: `<filter class="categorical" column="${GEO_FIELD}">`,
      readback: 'missing',
      severity: 'error',
    });
  });

  it('flags changed sorts as warnings', () => {
    const readback = encodedWorksheet().replace(
      `direction="DESC" using="${PROFIT_FIELD}"`,
      `direction="ASC" using="${SALES_FIELD}"`,
    );

    const findings = verifyWorksheetReadback(encodedWorksheet(), readback);

    expect(findings).toContainEqual({
      kind: 'sort',
      node: 'computed-sort',
      column: GEO_FIELD,
      intended: `<computed-sort column="${GEO_FIELD}" direction="DESC" using="${PROFIT_FIELD}">`,
      readback: 'changed',
      severity: 'warning',
    });
  });

  it('flags changed shelf expressions and mark classes as errors', () => {
    const readback = encodedWorksheet()
      .replace(`<rows>${GEO_FIELD}</rows>`, `<rows>${SALES_FIELD}</rows>`)
      .replace('<mark class="Shape"/>', '<mark class="Bar"/>');

    const findings = verifyWorksheetReadback(encodedWorksheet(), readback);

    expect(findings).toEqual(
      expect.arrayContaining([
        {
          kind: 'shelf',
          node: 'rows',
          column: GEO_FIELD,
          intended: GEO_FIELD,
          readback: 'changed',
          severity: 'error',
        },
        {
          kind: 'mark',
          node: 'mark',
          intended: '<mark class="Shape">',
          readback: 'changed',
          severity: 'error',
        },
      ]),
    );
  });

  it('does not flag Tableau grouping parentheses around nested discrete shelf pills', () => {
    const group = '[DS].[none:group:nk]';
    const country = '[DS].[none:country:nk]';
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>${group} / ${country}</rows>`,
    );
    const readback = intended.replace(
      `<rows>${group} / ${country}</rows>`,
      `<rows>(${group} / ${country})</rows>`,
    );

    expect(verifyWorksheetReadback(intended, readback).filter((f) => f.kind === 'shelf')).toEqual(
      [],
    );
  });

  it('treats (A / (B / C)) and (A / B / C) as the same operator structure', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((n) => `[DS].[none:${n}:nk]`);
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>(${a} / ${b} / ${c})</rows>`,
    );
    const readback = intended.replace(
      `<rows>(${a} / ${b} / ${c})</rows>`,
      `<rows>(${a} / (${b} / ${c}))</rows>`,
    );
    expect(verifyWorksheetReadback(intended, readback).filter((f) => f.kind === 'shelf')).toEqual(
      [],
    );
  });

  it('flags a / to + operator change on the same pills', () => {
    const [a, b] = ['a', 'b'].map((n) => `[DS].[none:${n}:nk]`);
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>(${a} / ${b})</rows>`,
    );
    const readback = intended.replace(`(${a} / ${b})`, `(${a} + ${b})`);
    const findings = verifyWorksheetReadback(intended, readback).filter((f) => f.kind === 'shelf');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      node: 'rows',
      intended: `(${a} / ${b})`,
      readback: `(${a} + ${b})`,
    });
  });

  it('still flags a nested shelf pill that Tableau actually dropped', () => {
    const group = '[DS].[none:group:nk]';
    const country = '[DS].[none:country:nk]';
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>${group} / ${country}</rows>`,
    );
    const readback = intended.replace(
      `<rows>${group} / ${country}</rows>`,
      `<rows>${group}</rows>`,
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'shelf',
      node: 'rows',
      column: country,
      intended: country,
      readback: 'changed',
      severity: 'error',
    });
  });

  it('downgrades a grouped readback whose same-class nested pills were reordered to a warning', () => {
    const group = '[DS].[none:group:nk]';
    const country = '[DS].[none:country:nk]';
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>${group} / ${country}</rows>`,
    );
    const readback = intended.replace(
      `<rows>${group} / ${country}</rows>`,
      `<rows>(${country} / ${group})</rows>`,
    );

    const shelfFindings = verifyWorksheetReadback(intended, readback).filter(
      (f) => f.kind === 'shelf',
    );
    expect(shelfFindings.length).toBeGreaterThan(0);
    expect(shelfFindings).toContainEqual({
      kind: 'shelf',
      node: 'rows',
      column: group,
      intended: group,
      readback: 'changed',
      severity: 'warning',
    });
  });

  it('flags a grouped readback that dropped a repeated nested pill', () => {
    const group = '[DS].[none:group:nk]';
    const country = '[DS].[none:country:nk]';
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>${group} / ${country} / ${group}</rows>`,
    );
    const readback = intended.replace(
      `<rows>${group} / ${country} / ${group}</rows>`,
      `<rows>(${group} / ${country})</rows>`,
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'shelf',
      node: 'rows',
      column: group,
      intended: group,
      readback: 'changed',
      severity: 'error',
    });
  });

  it('does not flag grouping parentheses when a bracketed name contains an unmatched parenthesis', () => {
    const weird = '[DS].[none:Foo):nk]';
    const country = '[DS].[none:country:nk]';
    const intended = encodedWorksheet().replace(
      `<rows>${GEO_FIELD}</rows>`,
      `<rows>${weird} / ${country}</rows>`,
    );
    const readback = intended.replace(
      `<rows>${weird} / ${country}</rows>`,
      `<rows>(${weird} / ${country})</rows>`,
    );

    expect(verifyWorksheetReadback(intended, readback).filter((f) => f.kind === 'shelf')).toEqual(
      [],
    );
  });

  it('does not flag an authored Automatic mark that Tableau resolved to a concrete class', () => {
    const intended = encodedWorksheet().replace(
      '<mark class="Shape"/>',
      '<mark class="Automatic"/>',
    );
    const readback = encodedWorksheet().replace('<mark class="Shape"/>', '<mark class="Bar"/>');

    const findings = verifyWorksheetReadback(intended, readback);

    expect(findings.some((f) => f.kind === 'mark')).toBe(false);
  });

  it('still flags an Automatic mark that is entirely absent from the readback (real drop)', () => {
    const intended = encodedWorksheet().replace(
      '<mark class="Shape"/>',
      '<mark class="Automatic"/>',
    );
    const readback = encodedWorksheet()
      .replace('<panes><pane>', '<panes><pane2>')
      .replace('</pane></panes>', '</pane2></panes>');

    const findings = verifyWorksheetReadback(intended, readback);

    expect(findings).toContainEqual({
      kind: 'mark',
      node: 'mark',
      intended: '<mark class="Automatic">',
      readback: 'missing',
      severity: 'error',
    });
  });

  it('tolerates Tableau-added readback noise such as style and formatting nodes', () => {
    const readback = encodedWorksheet(`
      <style><style-rule element="worksheet"><format attr="font-size" value="10"/></style-rule></style>
      <format attr="border-color" value="#ffffff"/>
    `);

    expect(verifyWorksheetReadback(encodedWorksheet(), readback)).toEqual([]);
  });
});

describe('verifyWorksheetReadback — nested Top-N filter semantics', () => {
  const intended = topNWorksheet(
    topNGroupfilter('10', 'user:ui-marker="intended" user:ui-top-by-field="true"'),
  );

  it('passes when the nested Top-N semantics match despite readback-only user attributes', () => {
    const readback = topNWorksheet(
      topNGroupfilter('10', 'user:ui-domain="database" user:ui-marker="readback"'),
    );

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('fails when Tableau drops the nested Top-N groupfilter', () => {
    const findings = verifyWorksheetReadback(intended, topNWorksheet(''));

    expect(findings).toContainEqual({
      kind: 'filter',
      node: 'filter',
      column: TOP_N_COLUMN,
      intended: `<filter class="categorical" column="${TOP_N_COLUMN}">`,
      readback: 'changed',
      severity: 'error',
    });
  });

  it('fails when Tableau changes the intended Top-N count from 10 to 50', () => {
    const readback = topNWorksheet(
      topNGroupfilter('50', 'user:ui-domain="database" user:ui-marker="readback"'),
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'filter',
      node: 'filter',
      column: TOP_N_COLUMN,
      intended: `<filter class="categorical" column="${TOP_N_COLUMN}">`,
      readback: 'changed',
      severity: 'error',
    });
  });

  it('fails when Tableau keeps the Top-N filter but drops its required slice', () => {
    const readback = intended.replace(
      `<slices><column>${TOP_N_COLUMN}</column></slices>`,
      '<slices/>',
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'filter',
      node: 'filter',
      column: TOP_N_COLUMN,
      intended: `<filter class="categorical" column="${TOP_N_COLUMN}">`,
      readback: 'changed',
      severity: 'error',
    });
  });

  it.each([
    ['drops', '', 'missing'],
    [
      'changes',
      `<computed-sort column="${TOP_N_COLUMN}" direction="ASC" using="${TOP_N_MEASURE}"/>`,
      'changed',
    ],
  ] as const)('fails when Tableau %s the Top-N computed sort', (_, replacement, readbackState) => {
    const readback = intended.replace(
      `<computed-sort column="${TOP_N_COLUMN}" direction="DESC" using="${TOP_N_MEASURE}"/>`,
      replacement,
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'sort',
      node: 'computed-sort',
      column: TOP_N_COLUMN,
      intended: `<computed-sort column="${TOP_N_COLUMN}" direction="DESC" using="${TOP_N_MEASURE}">`,
      readback: readbackState,
      severity: 'error',
    });
  });

  it('does not require a surviving slice for an ordinary categorical filter', () => {
    const intendedOrdinaryFilter = encodedWorksheet().replace(
      '</view>',
      `<slices><column>${GEO_FIELD}</column></slices></view>`,
    );
    const readback = intendedOrdinaryFilter.replace(
      `<slices><column>${GEO_FIELD}</column></slices>`,
      '<slices/>',
    );

    expect(verifyWorksheetReadback(intendedOrdinaryFilter, readback)).toEqual([]);
  });
});

describe('verifyWorksheetReadback — ordinary categorical filter semantics', () => {
  const filterAttributes = `class="categorical" column="${CATEGORICAL_COLUMN}" context="true"`;
  const intended = categoricalWorksheet(filterAttributes, MEMBER_UNION);

  it.each([
    ['drops the intended context flag', `class="categorical" column="${CATEGORICAL_COLUMN}"`],
    [
      'changes the intended context flag to false',
      `class="categorical" column="${CATEGORICAL_COLUMN}" context="false"`,
    ],
  ])('fails when Tableau %s', (_, readbackFilterAttributes) => {
    const readback = categoricalWorksheet(readbackFilterAttributes, MEMBER_UNION);

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual(CATEGORICAL_FILTER_FINDING);
  });

  it.each([
    ['drops a member from the explicit union', MEMBER_UNION.replace(WEST_MEMBER, '')],
    [
      'changes a member in the explicit union',
      MEMBER_UNION.replace('member="West"', 'member="Central"'),
    ],
  ])('warns when Tableau %s', (_, readbackGroupfilter) => {
    const readback = categoricalWorksheet(filterAttributes, readbackGroupfilter);

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual(CATEGORICAL_FILTER_WARNING);
  });

  it.each([
    ['level', MEMBER_UNION.replace(`level="${CATEGORICAL_LEVEL}"`, 'level="[none:State:nk]"')],
  ])('warns when Tableau changes the nested groupfilter %s', (_, readbackGroupfilter) => {
    const readback = categoricalWorksheet(filterAttributes, readbackGroupfilter);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_WARNING]);
  });

  it.each([
    ['function', MEMBER_UNION.replace('function="union"', 'function="except"')],
    [
      'enumeration',
      MEMBER_UNION.replace('user:ui-enumeration="inclusive"', 'user:ui-enumeration="all"'),
    ],
  ])('fails when Tableau inverts the top-level groupfilter %s', (_, readbackGroupfilter) => {
    const readback = categoricalWorksheet(filterAttributes, readbackGroupfilter);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_FINDING]);
  });

  it('fails when the surviving categorical filter has no groupfilter at all', () => {
    const readback = categoricalWorksheet(filterAttributes, '');

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_FINDING]);
  });

  it('tolerates attribute order, quote, whitespace, and non-semantic user attribute noise', () => {
    const readback = categoricalWorksheet(
      `context='true' column='${CATEGORICAL_COLUMN}' class='categorical'`,
      `<groupfilter user:ui-domain="database" user:ui-enumeration="inclusive"
          function="union" user:ui-marker="readback">
        <groupfilter member="East" user:ui-marker="readback-east"
          function="member" user:ui-enumeration="inclusive" level="${CATEGORICAL_LEVEL}" />
        <groupfilter user:ui-enumeration="inclusive" function="member"
          level="${CATEGORICAL_LEVEL}" user:ui-marker="readback-west" member="West" />
      </groupfilter>`,
    );

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('tolerates reordered members in an explicit union', () => {
    const reorderedUnion = MEMBER_UNION.replace(
      `${EAST_MEMBER}${WEST_MEMBER}`,
      `${WEST_MEMBER}${EAST_MEMBER}`,
    );

    expect(
      verifyWorksheetReadback(intended, categoricalWorksheet(filterAttributes, reorderedUnion)),
    ).toEqual([]);
  });
});

describe('verifyWorksheetReadback — column-instance co-dependency', () => {
  const withDeps = (deps: string): string =>
    `<worksheet name="Map"><table>
      <view><datasource-dependencies datasource="DS">${deps}</datasource-dependencies></view>
      <panes><pane><mark class="Shape"/><encodings><lod column="[DS].[none:Location:nk]"/></encodings></pane></panes>
      <rows>[DS].[avg:Latitude:qk]</rows>
    </table></worksheet>`;
  const CI =
    '<column-instance column="[Location]" derivation="None" name="[none:Location:nk]" pivot="key" type="nominal"/>';

  it('flags a surviving <lod> tag whose column-instance declaration was dropped', () => {
    const findings = verifyWorksheetReadback(withDeps(CI), withDeps(''));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'encoding',
      node: 'column-instance',
      column: '[none:Location:nk]',
      readback: 'missing',
      severity: 'error',
    });
  });

  it('passes when the declaration survives with the tag', () => {
    expect(verifyWorksheetReadback(withDeps(CI), withDeps(CI))).toHaveLength(0);
  });

  it('does not double-report when the encoding itself is missing (tag finding already covers it)', () => {
    const readbackNoLod = withDeps(CI)
      .replace('<encodings><lod column="[DS].[none:Location:nk]"/></encodings>', '<encodings/>')
      .replace(CI, '');
    const findings = verifyWorksheetReadback(withDeps(CI), readbackNoLod);
    expect(findings.filter((f) => f.node === 'column-instance')).toHaveLength(0);
    expect(findings.filter((f) => f.node === 'lod')).toHaveLength(1);
  });

  it('does not fire when the intended XML never declared the instance either', () => {
    expect(verifyWorksheetReadback(withDeps(''), withDeps(''))).toHaveLength(0);
  });
});

describe('verifyWorksheetReadback — filter column-instance co-dependency', () => {
  const FILTER_COLUMN = '[DS].[none:Region:nk]';
  const FILTER_INSTANCE = '[none:Region:nk]';
  const FILTER_CI =
    '<column-instance column="[Region]" derivation="None" name="[none:Region:nk]" pivot="key" type="nominal"/>';
  const filterWithDeps = (deps: string): string =>
    `<worksheet name="Regions"><table>
      <view>
        <datasource-dependencies datasource="DS">${deps}</datasource-dependencies>
        <filter class="categorical" column="${FILTER_COLUMN}"/>
      </view>
    </table></worksheet>`;

  it('flags a surviving filter whose declared column-instance was dropped', () => {
    const findings = verifyWorksheetReadback(filterWithDeps(FILTER_CI), filterWithDeps(''));

    expect(findings).toContainEqual({
      kind: 'filter',
      node: 'column-instance',
      column: FILTER_INSTANCE,
      intended: `<column-instance name="${FILTER_INSTANCE}">`,
      readback: 'missing',
      severity: 'error',
    });
  });

  it('flags a surviving filter whose required declaration was replaced by another instance', () => {
    const otherInstance = FILTER_CI.replace('[none:Region:nk]', '[none:Segment:nk]');

    expect(
      verifyWorksheetReadback(filterWithDeps(FILTER_CI), filterWithDeps(otherInstance)),
    ).toContainEqual({
      kind: 'filter',
      node: 'column-instance',
      column: FILTER_INSTANCE,
      intended: `<column-instance name="${FILTER_INSTANCE}">`,
      readback: 'missing',
      severity: 'error',
    });
  });

  it('does not require a filter column-instance that the intended XML never declared', () => {
    expect(verifyWorksheetReadback(filterWithDeps(''), filterWithDeps(''))).toEqual([]);
  });
});

describe('verifyWorksheetReadback - shelf severity (W-24366132)', () => {
  const CITY = '[DS].[none:City:nk]';
  const PROFIT = '[DS].[sum:Profit:qk]';
  const severities = (
    intendedRows: string,
    readbackRows: string,
    shelf = 'rows',
  ): ReadbackFinding['severity'][] =>
    verifyWorksheetReadback(
      worksheet(`<${shelf}>${intendedRows}</${shelf}>`),
      worksheet(readbackRows ? `<${shelf}>${readbackRows}</${shelf}>` : ''),
    )
      .filter((f) => f.kind === 'shelf')
      .map((f) => f.severity);

  it('warns when the same categorical fields are reordered', () => {
    expect(severities(`${GEO_FIELD} / ${CITY}`, `${CITY} / ${GEO_FIELD}`)).toEqual([
      'warning',
      'warning',
    ]);
  });

  it('warns on a reordered cols shelf as well', () => {
    expect(severities(`${GEO_FIELD} / ${CITY}`, `${CITY} / ${GEO_FIELD}`, 'cols')).toEqual([
      'warning',
      'warning',
    ]);
  });

  it('warns when the derivation changes but the field and class are the same', () => {
    expect(severities(SALES_FIELD, '[DS].[avg:Sales:qk]')).toEqual(['warning']);
  });

  it('warns when two quantitative fields on a shared axis are reordered', () => {
    expect(severities(`${SALES_FIELD} + ${PROFIT}`, `${PROFIT} + ${SALES_FIELD}`)).toEqual([
      'warning',
    ]);
  });

  it('errors when a field is dropped from the shelf', () => {
    expect(severities(`${GEO_FIELD} / ${CITY}`, GEO_FIELD)).toEqual(['error']);
  });

  it('errors when the whole shelf is missing from the readback', () => {
    const findings = verifyWorksheetReadback(
      worksheet(`<rows>${GEO_FIELD}</rows>`),
      worksheet(''),
    ).filter((f) => f.kind === 'shelf');

    expect(findings).toEqual([expect.objectContaining({ readback: 'missing', severity: 'error' })]);
  });

  it('errors when a different field replaces the intended one', () => {
    expect(severities(GEO_FIELD, CITY)).toEqual(['error']);
  });

  it('errors when a quantitative pill moves before a categorical pill', () => {
    expect(severities(`${GEO_FIELD} / ${SALES_FIELD}`, `${SALES_FIELD} / ${GEO_FIELD}`)).toEqual([
      'error',
      'error',
    ]);
  });

  it('errors when a field changes between quantitative and categorical', () => {
    expect(severities(SALES_FIELD, '[DS].[none:Sales:nk]')).toEqual(['error']);
  });

  it('errors when classes are swapped between fields but the positional sequence is unchanged', () => {
    expect(
      severities(
        '[DS].[none:Region:nk] / [DS].[sum:Sales:qk]',
        '[DS].[attr:Sales:nk] / [DS].[cnt:Region:qk]',
      ),
    ).toEqual(['error', 'error']);
  });

  it('errors when the readback pill is a none-derivation reference absent from the intended shelf', () => {
    expect(severities(SALES_FIELD, '[DS].[none:Sales:qk]')).toEqual(['error']);
  });

  it('errors when the readback pill has the same field but an unparseable form', () => {
    expect(severities(SALES_FIELD, '[DS].[sum:Sales]')).toEqual(['error']);
  });

  it('keeps a datasource name containing a dot out of the column match', () => {
    expect(
      severities(
        '[My.DS].[none:A:nk] / [My.DS].[none:B:nk]',
        '[My.DS].[none:B:nk] / [My.DS].[none:A:nk]',
      ),
    ).toEqual(['warning', 'warning']);
  });
});

describe('verifyWorksheetReadback - filter severity (W-24366132)', () => {
  const filterAttributes = `class="categorical" column="${CATEGORICAL_COLUMN}"`;
  const intended = categoricalWorksheet(filterAttributes, MEMBER_UNION);

  it('warns when a same-column categorical filter survives with different members', () => {
    const readback = categoricalWorksheet(filterAttributes, MEMBER_UNION.replace(WEST_MEMBER, ''));

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_WARNING]);
  });

  it('errors when the categorical filter is missing from the readback', () => {
    const readback = categoricalWorksheet('class="categorical" column="[DS].[none:Other:nk]"', '');

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_FINDING]);
  });

  it('errors when the surviving filter has a different class', () => {
    const readback = categoricalWorksheet(
      `class="quantitative" column="${CATEGORICAL_COLUMN}"`,
      MEMBER_UNION,
    );

    expect(verifyWorksheetReadback(intended, readback)).toEqual([
      { ...CATEGORICAL_FILTER_FINDING, readback: 'missing' },
    ]);
  });

  it('errors when only the context flag changes', () => {
    const readback = categoricalWorksheet(`${filterAttributes} context="true"`, MEMBER_UNION);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([CATEGORICAL_FILTER_FINDING]);
  });

  it('errors when a Top-N filter changes', () => {
    const topN = topNWorksheet(topNGroupfilter('10', 'user:ui-marker="a"'));
    const readback = topNWorksheet(topNGroupfilter('50', 'user:ui-marker="a"'));

    expect(verifyWorksheetReadback(topN, readback)).toContainEqual(
      expect.objectContaining({ node: 'filter', severity: 'error' }),
    );
  });

  it('errors when members differ and the intended column-instance declaration was dropped', () => {
    const withDeps = (deps: string, groupfilter: string): string =>
      `<worksheet name="Regions" xmlns:user="http://www.tableausoftware.com/xml/user"><table><view>
        <datasource-dependencies datasource="Sample - Superstore">${deps}</datasource-dependencies>
        <filter ${filterAttributes}>${groupfilter}</filter>
      </view></table></worksheet>`;
    const ci = `<column-instance column="[Region]" derivation="None" name="${CATEGORICAL_LEVEL}" pivot="key" type="nominal"/>`;

    const findings = verifyWorksheetReadback(
      withDeps(ci, MEMBER_UNION),
      withDeps('', MEMBER_UNION.replace(WEST_MEMBER, '')),
    );

    expect(findings).toEqual([CATEGORICAL_FILTER_FINDING]);
  });
});

describe('isReadbackUnsettled', () => {
  const base = { column: 'c', intended: 'i', readback: 'changed' } as const;

  it.each([
    ['an error', { ...base, kind: 'mark', node: 'mark', severity: 'error' }, true],
    ['a shelf warning', { ...base, kind: 'shelf', node: 'rows', severity: 'warning' }, true],
    ['a filter warning', { ...base, kind: 'filter', node: 'filter', severity: 'warning' }, true],
    [
      'a sort warning',
      { ...base, kind: 'sort', node: 'computed-sort', severity: 'warning' },
      false,
    ],
  ] as const)('treats %s correctly', (_, finding, expected) => {
    expect(isReadbackUnsettled([finding])).toBe(expected);
  });

  it('treats no findings as settled', () => {
    expect(isReadbackUnsettled([])).toBe(false);
  });
});
