import { describe, expect, it } from 'vitest';

import { formatReadbackVerificationError, verifyWorksheetReadback } from './readback-verify.js';

const GEO_FIELD = '[DS].[none:State:nk]';
const PROFIT_FIELD = '[DS].[sum:Profit:qk]';
const SALES_FIELD = '[DS].[sum:Sales:qk]';

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

function filteredWorksheet({
  members,
  groupFunction = 'union',
  enumeration = 'inclusive',
}: {
  members: string[];
  groupFunction?: string;
  enumeration?: string;
}): string {
  const memberNodes = members
    .map((member) => `<groupfilter function="member" level="[none:Region:nk]" member="${member}"/>`)
    .join('');
  return worksheet(`
    <view>
      <filter class="categorical" column="[DS].[none:Region:nk]">
        <groupfilter function="${groupFunction}" user:ui-enumeration="${enumeration}">
          ${memberNodes}
        </groupfilter>
      </filter>
    </view>
  `);
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

  it('flags a filter whose readback dropped an intended member', () => {
    const intended = filteredWorksheet({ members: ['EMEA', 'AMER'] });
    const readback = filteredWorksheet({ members: ['EMEA'] });

    const findings = verifyWorksheetReadback(intended, readback);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'filter',
      node: 'filter',
      column: '[DS].[none:Region:nk]',
      readback: 'changed',
      severity: 'error',
      detail: 'members differ: expected AMER,EMEA; observed EMEA',
    });
    expect(formatReadbackVerificationError(findings)).toContain(
      'members differ: expected AMER,EMEA; observed EMEA',
    );
  });

  it('flags a filter whose inclusion mode changes to exclusion', () => {
    const intended = filteredWorksheet({ members: ['EMEA'], enumeration: 'inclusive' });
    const readback = filteredWorksheet({ members: ['EMEA'], enumeration: 'exclusive' });

    const findings = verifyWorksheetReadback(intended, readback);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'filter',
      readback: 'changed',
      severity: 'error',
      detail: 'mode differs: expected include; observed exclude',
    });
  });

  it('accepts identical filter members in a different XML order', () => {
    const intended = filteredWorksheet({ members: ['EMEA', 'AMER'] });
    const readback = filteredWorksheet({ members: ['AMER', 'EMEA'] });

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('accepts a readback that omits the default inclusive enumeration', () => {
    const intended = filteredWorksheet({ members: ['Consumer'] });
    const readback = intended.replace(' user:ui-enumeration="inclusive"', '');

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('accepts the Desktop exclude serialization documented in the filter corpus', () => {
    const intended = worksheet(`<view>
      <filter class="categorical" column="[Sample - Superstore].[none:Segment:nk]">
        <groupfilter function="except" user:ui-enumeration="exclusive">
          <groupfilter function="level-members" level="[none:Segment:nk]"/>
          <groupfilter function="union">
            <groupfilter function="member" level="[none:Segment:nk]" member="Home Office"/>
          </groupfilter>
        </groupfilter>
      </filter>
    </view>`);
    const readbackFilter = `<filter column="[Sample - Superstore].[none:Segment:nk]" class="categorical">
  <groupfilter function="except"
               user:ui-domain="relevant"
               user:ui-enumeration="exclusive"
               user:ui-marker="enumerate">
    <groupfilter function="level-members" level="[none:Segment:nk]" />
    <groupfilter function="union">
      <groupfilter function="member" level="[none:Segment:nk]" member="Home Office" />
    </groupfilter>
  </groupfilter>
</filter>`;
    const readback = worksheet(`<view>${readbackFilter}</view>`);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('accepts a bare-member Desktop readback for an authored union', () => {
    const intended = filteredWorksheet({ members: ['2024'] }).replace(
      '[DS].[none:Region:nk]',
      '[Sample - Superstore].[yr:Order Date:ok]',
    );
    const readbackFilter = `<filter column="[Sample - Superstore].[yr:Order Date:ok]" class="categorical">
  <groupfilter user:ui-marker="enumerate"
               user:ui-domain="database"
               function="member"
               user:ui-enumeration="inclusive"
               member="2024"
               level="[yr:Order Date:ok]" />
</filter>`;
    const readback = worksheet(`<view>${readbackFilter}</view>`);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('flags a changed groupfilter function', () => {
    const intended = filteredWorksheet({ members: [], groupFunction: 'union' });
    const readback = filteredWorksheet({ members: [], groupFunction: 'level-members' });

    const findings = verifyWorksheetReadback(intended, readback);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'filter',
      readback: 'changed',
      severity: 'error',
      detail: 'function differs: expected union; observed level-members',
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
