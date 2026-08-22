import { describe, expect, it } from 'vitest';

import {
  formatVerificationWarnings,
  type ReadbackFinding,
  readbackFindingsToVerification,
  type VerificationFinding,
  type VerificationReport,
  verifyWorksheetReadback,
  withVerificationFinding,
} from './readback-verify.js';

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

describe('readbackFindingsToVerification', () => {
  const sortFinding: ReadbackFinding = {
    kind: 'sort',
    node: 'computed-sort',
    column: '[DS].[none:State:nk]',
    intended: '<computed-sort column="[DS].[none:State:nk]">',
    readback: 'changed',
    severity: 'warning',
  };

  it('maps each readback finding onto a source-tagged VerificationFinding', () => {
    const [mapped] = readbackFindingsToVerification([sortFinding]);
    expect(mapped).toEqual({
      severity: 'warning',
      source: 'readback',
      message: '<computed-sort column="[DS].[none:State:nk]">',
    });
  });

  it('preserves severity and renders the node fragment as the message', () => {
    const errorFinding: ReadbackFinding = { ...sortFinding, node: 'lod', severity: 'error' };
    const [mapped] = readbackFindingsToVerification([errorFinding]);
    expect(mapped.severity).toBe('error');
    expect(mapped.message).toBe('<lod column="[DS].[none:State:nk]">');
  });
});

describe('formatVerificationWarnings', () => {
  const readbackWarning: VerificationFinding = {
    severity: 'warning',
    source: 'readback',
    message: '<computed-sort column="[DS].[none:State:nk]">',
  };
  const visualWarning: VerificationFinding = {
    severity: 'warning',
    source: 'visual',
    message: 'a red field pill shape was detected on a shelf',
  };

  it('returns empty when there are no warnings', () => {
    expect(formatVerificationWarnings([])).toBe('');
    expect(formatVerificationWarnings([{ ...readbackWarning, severity: 'error' }])).toBe('');
  });

  it('renders readback warnings under the exact existing readback sentence', () => {
    expect(formatVerificationWarnings([readbackWarning])).toBe(
      '\n\n⚠️ Readback verification warning — Tableau changed or dropped: <computed-sort column="[DS].[none:State:nk]">. Re-check the rendered chart before moving on.',
    );
  });

  it('renders a visual warning under its own lead-in', () => {
    expect(formatVerificationWarnings([visualWarning])).toBe(
      '\n\n⚠️ Visual check — a red field pill shape was detected on a shelf.',
    );
  });

  it('groups readback warnings together and appends visual warnings after them', () => {
    const text = formatVerificationWarnings([readbackWarning, visualWarning]);
    expect(text).toContain('⚠️ Readback verification warning');
    expect(text).toContain('⚠️ Visual check');
    // Readback grouping leads; the visual lead-in follows.
    expect(text.indexOf('Readback verification warning')).toBeLessThan(
      text.indexOf('Visual check'),
    );
  });
});

describe('withVerificationFinding', () => {
  const passed: VerificationReport = { ok: true, status: 'passed', findings: [] };
  const skipped: VerificationReport = {
    ok: true,
    status: 'skipped',
    message: 'could not re-read the latest workbook after apply',
    findings: [],
  };
  const failed: VerificationReport = {
    ok: false,
    status: 'failed',
    findings: [{ severity: 'error', source: 'readback', message: '<lod>' }],
  };
  const visualWarning: VerificationFinding = {
    severity: 'warning',
    source: 'visual',
    message: 'a red field pill shape was detected on a shelf',
  };

  it('returns the report unchanged for a null finding (the common no-op)', () => {
    expect(withVerificationFinding(passed, null)).toBe(passed);
  });

  it('escalates a passed report to warning and surfaces the finding message', () => {
    const merged = withVerificationFinding(passed, visualWarning);
    expect(merged.status).toBe('warning');
    expect(merged.ok).toBe(true);
    expect(merged.message).toBe(`⚠️ Visual check — ${visualWarning.message}.`);
    expect(merged.findings).toEqual([visualWarning]);
  });

  it('escalates a skipped report to warning and appends after the skip reason', () => {
    const merged = withVerificationFinding(skipped, visualWarning);
    expect(merged.status).toBe('warning');
    expect(merged.message).toBe(
      `could not re-read the latest workbook after apply\n\n⚠️ Visual check — ${visualWarning.message}.`,
    );
    expect(merged.findings).toHaveLength(1);
  });

  it('never downgrades a failed report; keeps failed and appends the finding', () => {
    const merged = withVerificationFinding(failed, visualWarning);
    expect(merged.status).toBe('failed');
    expect(merged.ok).toBe(false);
    expect(merged.findings).toHaveLength(2);
  });

  it('escalates to failed when the folded finding is itself an error', () => {
    const merged = withVerificationFinding(passed, { ...visualWarning, severity: 'error' });
    expect(merged.status).toBe('failed');
    expect(merged.ok).toBe(false);
  });
});
