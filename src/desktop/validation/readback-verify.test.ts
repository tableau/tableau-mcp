import { describe, expect, it } from 'vitest';

import { verifyWorksheetReadback } from './readback-verify.js';

const GEO_FIELD = '[DS].[none:State:nk]';
const PROFIT_FIELD = '[DS].[sum:Profit:qk]';
const SALES_FIELD = '[DS].[sum:Sales:qk]';
const TOP_N_COLUMN = '[Sample - Superstore].[none:Product Name:nk]';
const TOP_N_LEVEL = '[none:Product Name:nk]';
const TOP_N_MEASURE = '[Sample - Superstore].[sum:Sales:qk]';

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

describe('verifyWorksheetReadback — column-instance co-dependency (RT finding RB-03)', () => {
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
