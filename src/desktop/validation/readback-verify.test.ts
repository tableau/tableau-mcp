import { describe, expect, it } from 'vitest';

import {
  formatReadbackVerificationError,
  formatReadbackVerificationWarnings,
  verifyWorksheetReadback,
} from './readback-verify.js';

const GEO_FIELD = '[DS].[none:State:nk]';
const PROFIT_FIELD = '[DS].[sum:Profit:qk]';
const SALES_FIELD = '[DS].[sum:Sales:qk]';
const GROUP_FIELD = '[DS].[none:Group Name:nk]';
const SNAPSHOT_FIELD = 'Day-Trunc([DS].[Snapshot Time])';
const TEAM_FIELD = '[DS].[none:Team:nk]';
const BINARY_COPY_FIELD = '[DS].[none:Binary (copy):nk]';

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

  it.each([
    {
      shelf: 'cols',
      intended: GROUP_FIELD,
      readback: `(${GROUP_FIELD})`,
    },
    {
      shelf: 'cols',
      intended: `${GROUP_FIELD} / ${SNAPSHOT_FIELD}`,
      readback: `( ${SNAPSHOT_FIELD} * ${GROUP_FIELD} )`,
    },
    {
      shelf: 'cols',
      intended: `${GROUP_FIELD} / ${SNAPSHOT_FIELD} / ${TEAM_FIELD}`,
      readback: `( ${GROUP_FIELD} * ( ${SNAPSHOT_FIELD} * ${TEAM_FIELD} ) )`,
    },
    {
      shelf: 'rows',
      intended: GROUP_FIELD,
      readback: `(${GROUP_FIELD})`,
    },
    {
      shelf: 'rows',
      intended: `${GROUP_FIELD} / ${SNAPSHOT_FIELD}`,
      readback: `(${GROUP_FIELD}*${SNAPSHOT_FIELD})`,
    },
    {
      shelf: 'rows',
      intended: `${GROUP_FIELD} / ${SNAPSHOT_FIELD} / ${TEAM_FIELD}`,
      readback: `((${TEAM_FIELD} * ${GROUP_FIELD})*${SNAPSHOT_FIELD})`,
    },
  ])(
    'compares the declared field set for $shelf shelf expressions',
    ({ shelf, intended, readback }) => {
      const intendedXml = worksheet(`<${shelf}>${intended}</${shelf}>`);
      const readbackXml = worksheet(`<${shelf}>${readback}</${shelf}>`);

      expect(verifyWorksheetReadback(intendedXml, readbackXml)).toEqual([]);
    },
  );

  it('still flags a field genuinely absent from a combined shelf expression', () => {
    const intended = worksheet(`<cols>(${GROUP_FIELD} * ${SNAPSHOT_FIELD})</cols>`);
    const readback = worksheet(`<cols>${GROUP_FIELD}</cols>`);

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'shelf',
      node: 'cols',
      column: SNAPSHOT_FIELD,
      intended: SNAPSHOT_FIELD,
      readback: 'changed',
      severity: 'error',
    });
  });

  it('displays the raw field name while matching shelves by normalized value', () => {
    const intended = worksheet(`<cols>${BINARY_COPY_FIELD}</cols>`);
    const readback = worksheet('<cols></cols>');

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'shelf',
      node: 'cols',
      column: BINARY_COPY_FIELD,
      intended: BINARY_COPY_FIELD,
      readback: 'missing',
      severity: 'error',
    });
  });

  it('ignores spacing differences around plus shelf expressions', () => {
    const intended = worksheet(`<cols>(${PROFIT_FIELD} + ${SALES_FIELD})</cols>`);
    const readback = worksheet(`<cols>(${PROFIT_FIELD}+${SALES_FIELD})</cols>`);

    expect(verifyWorksheetReadback(intended, readback)).toEqual([]);
  });

  it('does not deduplicate a repeated field in a plus shelf expression', () => {
    const intended = worksheet(`<cols>(${SALES_FIELD} + ${SALES_FIELD})</cols>`);
    const readback = worksheet(`<cols>${SALES_FIELD}</cols>`);

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'shelf',
      node: 'cols',
      column: `${SALES_FIELD} + ${SALES_FIELD}`,
      intended: `${SALES_FIELD} + ${SALES_FIELD}`,
      readback: 'changed',
      severity: 'error',
    });
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

describe('readback finding messages', () => {
  it('describes the missing readback evidence without asserting chart failure', () => {
    const findings = [
      {
        kind: 'shelf',
        node: 'cols',
        column: SNAPSHOT_FIELD,
        intended: SNAPSHOT_FIELD,
        readback: 'missing',
        severity: 'error',
      },
    ] as const;

    expect(formatReadbackVerificationError([...findings])).toBe(
      `Readback had no exact match for intended <cols column="${SNAPSHOT_FIELD}">. Inspect the readback XML and rendered chart before relying on the result.`,
    );
  });

  it('describes the unmatched sort evidence in the warning', () => {
    const findings = [
      {
        kind: 'sort',
        node: 'computed-sort',
        column: GEO_FIELD,
        intended: '<computed-sort>',
        readback: 'changed',
        severity: 'warning',
      },
    ] as const;

    expect(formatReadbackVerificationWarnings([...findings])).toBe(
      `\n\n⚠️ Readback verification warning — readback had no exact match for intended <computed-sort column="${GEO_FIELD}">. Inspect the readback XML and rendered chart before relying on the result.`,
    );
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

  it('flags a surviving shelf pill whose column-instance declaration was dropped', () => {
    const binField = '[DS].[bin:Sales:qk]';
    const binCI =
      '<column-instance column="[Sales]" derivation="Bin" name="[bin:Sales:qk]" pivot="key" type="quantitative"/>';
    const intended = withDeps(binCI).replace(
      '<rows>[DS].[avg:Latitude:qk]</rows>',
      `<rows>${binField}</rows>`,
    );
    const readback = withDeps('').replace(
      '<rows>[DS].[avg:Latitude:qk]</rows>',
      `<rows>${binField}</rows>`,
    );

    expect(verifyWorksheetReadback(intended, readback)).toContainEqual({
      kind: 'encoding',
      node: 'column-instance',
      column: '[bin:Sales:qk]',
      intended: '<column-instance name="[bin:Sales:qk]">',
      readback: 'missing',
      severity: 'error',
    });
  });
});
