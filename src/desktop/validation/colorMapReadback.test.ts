import { readFileSync } from 'fs';
import { join } from 'path';

import {
  colorMapVerificationResult,
  colorReadbackUnavailableFinding,
  compareColorMaps,
  extractColorMaps,
  extractWorksheetStyleColorMaps,
  formatColorMapCheck,
  formatStaleWorksheetStyleLead,
  mergeColorMapVerification,
  splitWorksheetStyleColorMaps,
  staleWorksheetStyleFindings,
} from './colorMapReadback.js';
import { classifyWorksheetPromiseOutcome } from './promise-check.js';
import type { ReadbackVerificationResult } from './readback-verify.js';

const FIXTURE_DIR = join(
  process.cwd(),
  'src',
  'desktop',
  'validation',
  '__fixtures__',
  'color-map',
);

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

const CATEGORY_MEMBERS = [
  ['Furniture', '#59a14f'],
  ['Technology', '#9c755f'],
  ['Office Supplies', '#b07aa1'],
];

function styleBlock(encoding: string): string {
  return `<style><style-rule element='mark'>${encoding}</style-rule></style>`;
}

function datasourceXml(encoding: string, extra = ''): string {
  return `<datasource name='superstore'>${extra}${styleBlock(encoding)}</datasource>`;
}

const CATEGORY_ENCODING = `<encoding attr='color' field='[none:Category:nk]' type='palette'>
  <map to='#59a14f'><bucket>&quot;Furniture&quot;</bucket></map>
  <map to='#9c755f'><bucket>&quot;Technology&quot;</bucket></map>
</encoding>`;

describe('extractColorMaps', () => {
  it('reads a datasource-root style map from the live L1a payload and ignores <cols> map keys', () => {
    const maps = extractColorMaps(fixture('apply-L1a-ds.xml'));
    expect(maps).toHaveLength(1);
    expect(maps?.[0].datasource).toBe('superstore');
    expect(maps?.[0].field).toBe('[none:Category:nk]');
    expect([...(maps?.[0].members ?? [])]).toEqual(CATEGORY_MEMBERS);
  });

  it('reads a worksheet <datasource-dependencies> map from the live L2 payload, not pane encodings', () => {
    const maps = extractColorMaps(fixture('apply-L2-ws.xml'));
    expect(maps).toHaveLength(1);
    expect(maps?.[0]).toMatchObject({ datasource: 'superstore', field: '[none:Category:nk]' });
    expect([...(maps?.[0].members ?? [])]).toEqual(CATEGORY_MEMBERS);
  });

  it('reads workbook datasources and workbook worksheets', () => {
    const xml = `<workbook><datasources>
      <datasource name='Parameters' />
      <datasource name='superstore'>${styleBlock(CATEGORY_ENCODING)}</datasource>
    </datasources><worksheets><worksheet name='L4'><table><view>
      <datasource-dependencies datasource='superstore'>${styleBlock(
        `<encoding attr='color' field='[usr:Calculation_7001:nk]' type='palette'>
          <map to='#59A14F'><bucket>&quot;Favorable&quot;</bucket></map>
          <map to='#9c755f'><bucket>&quot;Off plan&quot;</bucket></map>
        </encoding>`,
      )}</datasource-dependencies>
    </view></table></worksheet></worksheets></workbook>`;

    const maps = extractColorMaps(xml);
    expect(maps?.map((map) => [map.datasource, map.field, [...map.members]])).toEqual([
      [
        'superstore',
        '[none:Category:nk]',
        [
          ['Furniture', '#59a14f'],
          ['Technology', '#9c755f'],
        ],
      ],
      [
        'superstore',
        '[usr:Calculation_7001:nk]',
        [
          ['Favorable', '#59a14f'],
          ['Off plan', '#9c755f'],
        ],
      ],
    ]);
  });

  it('collapses identical copies, as in the live L1b readback that carries the map twice', () => {
    const maps = extractColorMaps(fixture('rb-L1b-ds.xml'));
    expect(maps).toHaveLength(1);
    expect([...(maps?.[0].members ?? [])]).toEqual(CATEGORY_MEMBERS);
  });

  it('lets the last copy in document order win per member instead of unioning copies', () => {
    const other = CATEGORY_ENCODING.replace('#9c755f', '#111111');
    for (const order of [`${CATEGORY_ENCODING}${other}`, `${other}${CATEGORY_ENCODING}`]) {
      const maps = extractColorMaps(datasourceXml(order));
      expect(maps).toHaveLength(1);
      expect(maps?.[0].members.get('Technology')).toBe(
        order.endsWith(other) ? '#111111' : '#9c755f',
      );
    }
  });

  it('returns no maps for a readback whose style was dropped', () => {
    expect(extractColorMaps(fixture('rb-L1a-ds.xml'))).toEqual([]);
  });

  it('skips multi-field encodings', () => {
    const xml = datasourceXml(
      `<encoding attr='color' field='[none:Category:nk]&#10;[none:Region:nk]' type='palette'>
        <map to='#59a14f'><bucket>&quot;Furniture&quot;</bucket></map>
      </encoding>`,
    );
    expect(extractColorMaps(xml)).toEqual([]);
  });

  it('reads every direct bucket of a map and skips <multibucket>', () => {
    const xml = datasourceXml(
      `<encoding attr='color' field='[none:Category:nk]' type='palette'>
        <map to='#59a14f'>
          <bucket>&quot;Furniture&quot;</bucket>
          <bucket>&quot;Technology&quot;</bucket>
        </map>
        <map to='#b07aa1'>
          <multibucket><bucket>&quot;Office Supplies&quot;</bucket><bucket>&quot;East&quot;</bucket></multibucket>
        </map>
      </encoding>`,
    );
    expect([...(extractColorMaps(xml)?.[0].members ?? [])]).toEqual([
      ['Furniture', '#59a14f'],
      ['Technology', '#59a14f'],
    ]);
  });

  it('skips numeric, date and null buckets and non-hex colors', () => {
    const xml = datasourceXml(
      `<encoding attr='color' field='[none:Category:nk]' type='palette'>
        <map to='#59a14f'><bucket>1</bucket></map>
        <map to='#59a14f'><bucket>-2.5</bucket></map>
        <map to='#59a14f'><bucket>#2024-01-01#</bucket></map>
        <map to='#59a14f'><bucket>%null%</bucket></map>
        <map to='red'><bucket>&quot;Furniture&quot;</bucket></map>
        <map to='#abc'><bucket>&quot;Technology&quot;</bucket></map>
        <map to='#B07AA1'><bucket>&quot;Office Supplies&quot;</bucket></map>
      </encoding>`,
    );
    expect([...(extractColorMaps(xml)?.[0].members ?? [])]).toEqual([
      ['Office Supplies', '#b07aa1'],
    ]);
  });

  it('skips quoted numbers and dates, leading-dot numbers and any %…% token, but keeps booleans', () => {
    const xml = datasourceXml(
      `<encoding attr='color' field='[none:Category:nk]' type='palette'>
        <map to='#59a14f'><bucket>&quot;2019&quot;</bucket></map>
        <map to='#59a14f'><bucket>&quot;2019-01-01&quot;</bucket></map>
        <map to='#59a14f'><bucket>&quot;#2019-01-01#&quot;</bucket></map>
        <map to='#59a14f'><bucket>.5</bucket></map>
        <map to='#59a14f'><bucket>%missing%</bucket></map>
        <map to='#59a14f'><bucket>&quot;%null%&quot;</bucket></map>
        <map to='#ff0000'><bucket>True</bucket></map>
        <map to='#00ff00'><bucket>&quot;true&quot;</bucket></map>
      </encoding>`,
    );
    expect([...(extractColorMaps(xml)?.[0].members ?? [])]).toEqual([
      ['True', '#ff0000'],
      ['true', '#00ff00'],
    ]);
  });

  it('ignores non-mark rules and non-palette or non-color encodings', () => {
    const xml = `<datasource name='superstore'><style>
      <style-rule element='cell'>${CATEGORY_ENCODING}</style-rule>
      <style-rule element='mark'>
        <encoding attr='size' field='[none:Category:nk]' type='palette'><map to='#59a14f'><bucket>&quot;A&quot;</bucket></map></encoding>
        <encoding attr='color' field='[sum:Sales:qk]' type='interpolated'><map to='#59a14f'><bucket>&quot;A&quot;</bucket></map></encoding>
      </style-rule>
    </style></datasource>`;
    expect(extractColorMaps(xml)).toEqual([]);
  });

  it('returns undefined for unparseable or unrecognized XML', () => {
    expect(extractColorMaps('<datasource name=')).toBeUndefined();
    expect(extractColorMaps('<dashboard name="D" />')).toBeUndefined();
  });
});

describe('compareColorMaps', () => {
  const intended = extractColorMaps(fixture('apply-L1b-ds.xml')) ?? [];

  it('passes when the readback carries every member color', () => {
    expect(compareColorMaps(intended, extractColorMaps(fixture('rb-L1b-ds.xml')) ?? [])).toEqual(
      [],
    );
  });

  it('reports every member as dropped when the field is missing from the readback', () => {
    const findings = compareColorMaps(intended, extractColorMaps(fixture('rb-L1a-ds.xml')) ?? []);
    expect(findings.map((finding) => finding.message)).toEqual([
      '[none:Category:nk]: Furniture expected #59a14f, found missing',
      '[none:Category:nk]: Technology expected #9c755f, found missing',
      '[none:Category:nk]: Office Supplies expected #b07aa1, found missing',
    ]);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      source: 'color-map',
      datasource: 'superstore',
      fieldName: '[none:Category:nk]',
      reason: 'color-map-dropped',
    });
  });

  it('reports a wrong color and a missing member', () => {
    const readback = extractColorMaps(
      datasourceXml(
        `<encoding attr='color' field='[none:Category:nk]' type='palette'>
          <map to='#59a14f'><bucket>&quot;Furniture&quot;</bucket></map>
          <map to='#4e79a7'><bucket>&quot;Technology&quot;</bucket></map>
        </encoding>`,
      ),
    );
    const findings = compareColorMaps(intended, readback ?? []);
    expect(findings.map((finding) => [finding.message, finding.reason])).toEqual([
      ['[none:Category:nk]: Technology expected #9c755f, found #4e79a7', 'color-mismatch'],
      [
        '[none:Category:nk]: Office Supplies expected #b07aa1, found missing',
        'color-member-missing',
      ],
    ]);
  });

  it('reads the first readback copy, which the chart draws (live wb-smoke f1/f2)', () => {
    const other = CATEGORY_ENCODING.replace('#9c755f', '#4e79a7');
    const wanted = extractColorMaps(datasourceXml(CATEGORY_ENCODING)) ?? [];
    const firstWins =
      extractColorMaps(datasourceXml(`${CATEGORY_ENCODING}${other}`), { winner: 'first' }) ?? [];
    expect(firstWins).toHaveLength(1);
    expect(compareColorMaps(wanted, firstWins)).toEqual([]);
    const lastWins =
      extractColorMaps(datasourceXml(`${other}${CATEGORY_ENCODING}`), { winner: 'first' }) ?? [];
    expect(compareColorMaps(wanted, lastWins).map((finding) => finding.message)).toEqual([
      '[none:Category:nk]: Technology expected #9c755f, found #4e79a7',
    ]);
  });

  it('does not match a readback map for another datasource', () => {
    const readback = (extractColorMaps(fixture('rb-L1b-ds.xml')) ?? []).map((map) => ({
      ...map,
      datasource: 'other',
    }));
    expect(compareColorMaps(intended, readback)).toHaveLength(3);
  });
});

describe('review regressions', () => {
  it('takes the worksheet copy as intended when it follows a differing datasource copy', () => {
    const xml = `<workbook><datasources>
      <datasource name='superstore'>${styleBlock(CATEGORY_ENCODING)}</datasource>
    </datasources><worksheets><worksheet name='L2'><table><view>
      <datasource-dependencies datasource='superstore'>${styleBlock(
        CATEGORY_ENCODING.replace('#9c755f', '#4e79a7'),
      )}</datasource-dependencies>
    </view></table></worksheet></worksheets></workbook>`;
    const intended = extractColorMaps(xml) ?? [];
    expect(intended).toHaveLength(1);

    const sheetWon = extractColorMaps(
      datasourceXml(CATEGORY_ENCODING.replace('#9c755f', '#4e79a7')),
    );
    expect(compareColorMaps(intended, sheetWon ?? [])).toEqual([]);

    const datasourceWon = extractColorMaps(datasourceXml(CATEGORY_ENCODING));
    expect(
      compareColorMaps(intended, datasourceWon ?? []).map((finding) => finding.message),
    ).toEqual(['[none:Category:nk]: Technology expected #4e79a7, found #9c755f']);
  });

  it('strips the owning datasource qualifier so a qualified field matches the readback key', () => {
    const qualified = fixture('apply-L2-ws.xml').replace(
      "field='[none:Category:nk]'",
      "field='[superstore].[none:Category:nk]'",
    );
    const intended = extractColorMaps(qualified) ?? [];
    expect(intended[0].field).toBe('[none:Category:nk]');
    expect(compareColorMaps(intended, extractColorMaps(fixture('rb-L2-ds.xml')) ?? [])).toEqual([]);
  });

  it('trims whitespace around bucket text before keying it', () => {
    const xml = datasourceXml(
      `<encoding attr='color' field='[none:Category:nk]' type='palette'>
        <map to='#59a14f'><bucket>
          &quot;Furniture&quot;
        </bucket></map>
        <map to='#9c755f'><bucket> 3 </bucket></map>
      </encoding>`,
    );
    expect([...(extractColorMaps(xml)?.[0].members ?? [])]).toEqual([['Furniture', '#59a14f']]);
  });

  it('keeps a color warning with no structural readback from classifying as verified', () => {
    const warning = colorMapVerificationResult(
      [colorReadbackUnavailableFinding('superstore', 'document read failed')],
      '',
    );
    const merged = mergeColorMapVerification(undefined, warning);
    expect(merged).toEqual({
      ok: true,
      status: 'skipped',
      message: warning.message,
      findings: warning.findings,
    });
    expect(classifyWorksheetPromiseOutcome({ validationWarnings: [], readback: merged })).not.toBe(
      'verified',
    );

    const failed = colorMapVerificationResult(
      compareColorMaps(
        extractColorMaps(fixture('apply-L2-ws.xml')) ?? [],
        extractColorMaps(fixture('rb-L1a-ds.xml')) ?? [],
      ),
      '',
    );
    expect(mergeColorMapVerification(undefined, failed)).toBe(failed);
  });
});

describe('colorMapVerificationResult', () => {
  const dropped = (applied: string): ReadbackVerificationResult =>
    colorMapVerificationResult(
      compareColorMaps(
        extractColorMaps(fixture(applied)) ?? [],
        extractColorMaps(fixture('rb-L1a-ds.xml')) ?? [],
      ),
      fixture(applied),
    );

  it('fails with the column-instance hint when the payload lacks one for the field', () => {
    const result = dropped('apply-L1a-ds.xml');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toBe(
      '3 requested member color(s) did not take: [none:Category:nk]: Furniture expected #59a14f, found missing; [none:Category:nk]: Technology expected #9c755f, found missing; [none:Category:nk]: Office Supplies expected #b07aa1, found missing. Do not tell the user these colors are set. The datasource needs a <column-instance> for [none:Category:nk] next to its <style>.',
    );
    expect(result.findings).toHaveLength(3);
  });

  it('omits the hint when the payload already carries the column-instance', () => {
    expect(dropped('apply-L1b-ds.xml').message).not.toContain('<column-instance>');
  });

  it('omits the hint for a worksheet payload, which has no datasource-level element', () => {
    expect(dropped('apply-L2-ws.xml').message).not.toContain('<column-instance>');
  });

  it('omits the column-instance hint for [:Measure Names]', () => {
    const finding = {
      severity: 'error' as const,
      source: 'color-map' as const,
      message: '[:Measure Names]: Sales expected #ff0000, found missing',
      datasource: 'superstore',
      fieldName: '[:Measure Names]',
      reason: 'color-member-missing',
    };
    const result = colorMapVerificationResult([finding], '<datasource name="superstore" />');
    expect(result.message).not.toContain('<column-instance>');
  });

  it('adds the apply-workbook hint only when asked', () => {
    const finding = {
      severity: 'error' as const,
      source: 'color-map' as const,
      message: 'x',
      reason: 'color-mismatch',
    };
    const hint = 'apply-workbook does not replace a datasource color map that already exists';
    expect(colorMapVerificationResult([finding], '<x />').message).not.toContain(hint);
    expect(
      colorMapVerificationResult([finding], '<x />', { existingMapNotReplaced: true }).message,
    ).toContain(hint);
  });

  it('warns without failing when only unavailable findings exist', () => {
    const result = colorMapVerificationResult(
      [colorReadbackUnavailableFinding('superstore', 'document read failed')],
      fixture('apply-L1b-ds.xml'),
    );
    expect(result).toMatchObject({ ok: true, status: 'warning' });
    expect(result.message).toBe(
      'color readback unavailable for datasource "superstore": document read failed',
    );
  });

  it('passes with no findings', () => {
    expect(colorMapVerificationResult([], '<datasource name="x" />')).toEqual({
      ok: true,
      status: 'passed',
    });
  });
});

describe('mergeColorMapVerification', () => {
  const base: ReadbackVerificationResult = {
    ok: true,
    status: 'passed',
    message: 'Readback matched.',
    findings: [],
  };
  const failed = dropColor();

  function dropColor(): ReadbackVerificationResult {
    return colorMapVerificationResult(
      compareColorMaps(
        extractColorMaps(fixture('apply-L2-ws.xml')) ?? [],
        extractColorMaps(fixture('rb-L1a-ds.xml')) ?? [],
      ),
      fixture('apply-L2-ws.xml'),
    );
  }

  it('leaves the base untouched for a pass or no check', () => {
    expect(mergeColorMapVerification(base, undefined)).toBe(base);
    expect(mergeColorMapVerification(base, { ok: true, status: 'passed' })).toBe(base);
  });

  it('fails the merged result on a color failure and keeps both messages', () => {
    const merged = mergeColorMapVerification(base, failed);
    expect(merged).toMatchObject({ ok: false, status: 'failed' });
    expect(merged?.message).toBe(`Readback matched. ${failed.message}`);
    expect(merged?.findings).toHaveLength(3);
  });

  it('downgrades a passed base to warning and carries the color message', () => {
    const warning = colorMapVerificationResult(
      [colorReadbackUnavailableFinding('superstore', 'document read failed')],
      '',
    );
    const merged = mergeColorMapVerification(base, warning);
    expect(merged).toMatchObject({ ok: true, status: 'warning', message: warning.message });
    expect(merged?.findings).toEqual(warning.findings);
  });

  it('keeps a base warning as it is', () => {
    const warned: ReadbackVerificationResult = {
      ok: true,
      status: 'warning',
      message: 'Sort changed.',
    };
    const warning = colorMapVerificationResult(
      [colorReadbackUnavailableFinding('superstore', 'document read failed')],
      '',
    );
    expect(mergeColorMapVerification(warned, warning)).toMatchObject({
      status: 'warning',
      message: 'Sort changed.',
    });
  });
});

describe('formatColorMapCheck', () => {
  it('names a pass, a warning, and leaves a failure to the headline', () => {
    expect(formatColorMapCheck({ ok: true, status: 'passed' })).toBe(
      ' Read back the datasource document: every requested member color matched.',
    );
    expect(formatColorMapCheck({ ok: true, status: 'warning', message: 'x' })).toBe(
      ' Requested member colors are not verified: x.',
    );
    expect(formatColorMapCheck({ ok: false, status: 'failed', message: 'x' })).toBe('');
  });
});

function worksheetWithStyles({
  dependencies = "<datasource-dependencies datasource='superstore' />",
  tableStyle = '',
  paneStyle = '',
}: {
  dependencies?: string;
  tableStyle?: string;
  paneStyle?: string;
}): string {
  return `<worksheet name='S'><table><view>${dependencies}</view>${tableStyle}<panes><pane>${paneStyle}</pane></panes></table></worksheet>`;
}

const FURNITURE_ENCODING = (field: string, bucket = '&quot;Furniture&quot;'): string =>
  `<encoding attr='color' field='${field}' type='palette'><map to='#FF0000'><bucket>${bucket}</bucket></map></encoding>`;

describe('extractWorksheetStyleColorMaps', () => {
  it("reads Andy's boolean map from the table style and strips the datasource qualifier", () => {
    const maps = extractWorksheetStyleColorMaps(fixture('apply-ws-table-fq-ws.xml'));
    expect(maps).toEqual([
      {
        datasource: 'superstore',
        field: '[none:Calculation_B002:nk]',
        members: new Map([
          ['true', '#ff0000'],
          ['false', '#d4c37a'],
        ]),
      },
    ]);
    // The old extractor still sees nothing there.
    expect(extractColorMaps(fixture('apply-ws-table-fq-ws.xml'))).toEqual([]);
  });

  it('collapses identical sheet-level copies but keeps differing ones across sheets and panes', () => {
    const sheet = (name: string, hex: string, pane = ''): string =>
      `<worksheet name='${name}'><table><view><datasource-dependencies datasource='superstore' /></view>${styleBlock(
        CATEGORY_ENCODING.replace('#59a14f', hex),
      )}<panes><pane>${pane}</pane></panes></table></worksheet>`;
    const maps = extractWorksheetStyleColorMaps(
      `<workbook><worksheets>${sheet('A', '#ff0000')}${sheet('B', '#ff0000')}${sheet('C', '#00ff00')}</worksheets></workbook>`,
    );
    expect(maps.map((map) => map.members.get('Furniture'))).toEqual(['#ff0000', '#00ff00']);
  });

  it('leaves <datasource-dependencies> styles to extractColorMaps', () => {
    expect(extractWorksheetStyleColorMaps(fixture('apply-L2-ws.xml'))).toEqual([]);
  });

  it('reads a pane-level style', () => {
    const xml = worksheetWithStyles({
      paneStyle: `<style><style-rule element='mark'>${FURNITURE_ENCODING('[superstore].[none:Category:nk]')}</style-rule></style>`,
    });
    expect(extractWorksheetStyleColorMaps(xml)).toEqual([
      {
        datasource: 'superstore',
        field: '[none:Category:nk]',
        members: new Map([['Furniture', '#ff0000']]),
      },
    ]);
  });

  it('reads workbook documents', () => {
    const xml = `<workbook><worksheets>${worksheetWithStyles({
      tableStyle: `<style><style-rule element='mark'>${FURNITURE_ENCODING('[superstore].[none:Category:nk]')}</style-rule></style>`,
    })}</worksheets></workbook>`;
    expect(extractWorksheetStyleColorMaps(xml)).toHaveLength(1);
  });

  it('resolves an unqualified field to the one non-Parameters datasource', () => {
    const tableStyle = `<style><style-rule element='mark'>${FURNITURE_ENCODING('[none:Category:nk]')}</style-rule></style>`;
    const one = worksheetWithStyles({
      dependencies:
        "<datasource-dependencies datasource='Parameters' /><datasource-dependencies datasource='superstore' />",
      tableStyle,
    });
    expect(extractWorksheetStyleColorMaps(one)).toMatchObject([{ datasource: 'superstore' }]);

    const two = worksheetWithStyles({
      dependencies:
        "<datasource-dependencies datasource='a' /><datasource-dependencies datasource='b' />",
      tableStyle,
    });
    expect(extractWorksheetStyleColorMaps(two)).toEqual([]);
  });

  it('yields no maps for the numeric buckets of a template F6 map', () => {
    const xml = worksheetWithStyles({
      tableStyle: `<style><style-rule element='mark'>${FURNITURE_ENCODING('[superstore].[none:Quantity:ok]', '1')}${FURNITURE_ENCODING('[superstore].[none:Quantity:ok]', '2.5')}</style-rule></style>`,
    });
    expect(extractWorksheetStyleColorMaps(xml)).toEqual([]);
  });

  it('returns [] for unparseable XML', () => {
    expect(extractWorksheetStyleColorMaps('<!DOCTYPE x><worksheet />')).toEqual([]);
  });
});

describe('splitWorksheetStyleColorMaps', () => {
  const live = extractWorksheetStyleColorMaps(fixture('ok-L1-ws.xml'));

  it('treats members already in the baseline as stale and edited members as authored', () => {
    const edited = extractWorksheetStyleColorMaps(
      fixture('ok-L1-ws.xml').replace('#ff0000', '#00ff00'),
    );
    const { authored, stale } = splitWorksheetStyleColorMaps(edited, live);
    expect(authored).toEqual([
      {
        datasource: 'superstore',
        field: '[none:Category:nk]',
        members: new Map([['Furniture', '#00ff00']]),
      },
    ]);
    expect([...stale[0].members.keys()]).toEqual(['Office Supplies', 'Technology']);
  });

  it('treats every member as stale without a baseline', () => {
    const { authored, stale } = splitWorksheetStyleColorMaps(live, undefined);
    expect(authored).toEqual([]);
    expect(stale).toEqual(live);
  });
});

describe('staleWorksheetStyleFindings', () => {
  const stale = extractWorksheetStyleColorMaps(fixture('ok-L1-ws.xml'));

  it('warns for stale members the datasource does not carry', () => {
    const findings = staleWorksheetStyleFindings(stale, []);
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        reason: 'color-worksheet-style-stale',
        message:
          "the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Office Supplies #00aa00 (not in the datasource), Technology #d4c37a (not in the datasource), Furniture #ff0000 (not in the datasource)",
      }),
    ]);
  });

  it('stays quiet when the datasource carries the same colors', () => {
    expect(staleWorksheetStyleFindings(stale, stale)).toEqual([]);
  });
});

describe('worksheet-style failure hint', () => {
  it('points at the datasource <style> only when the caller flags worksheet-style placement', () => {
    const finding = {
      severity: 'error' as const,
      source: 'color-map' as const,
      message: '[none:Calculation_B002:nk]: true expected #ff0000, found missing',
      datasource: 'superstore',
      fieldName: '[none:Calculation_B002:nk]',
      reason: 'color-map-dropped',
    };
    const result = colorMapVerificationResult([finding], fixture('apply-ws-table-fq-ws.xml'), {
      worksheetStylePlacement: true,
    });
    expect(result.message).toContain(
      "Desktop keeps member colors written in a worksheet's own <style>, and the chart ignores them; put them in the datasource <style> with a datasource-level <column-instance>.",
    );
    const other = colorMapVerificationResult([finding], fixture('apply-L2-ws.xml'));
    expect(other.message).not.toContain("worksheet's own <style>");
  });
});

describe('stale worksheet-style notes', () => {
  const stale = {
    severity: 'warning' as const,
    source: 'color-map' as const,
    message:
      "the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Furniture #ff0000",
    reason: 'color-worksheet-style-stale',
  };

  it('never turns a passing check into a warning, and leads the message instead of trailing it', () => {
    const result = colorMapVerificationResult([stale], '<datasource name="x" />');
    expect(result).toEqual({ ok: true, status: 'passed', findings: [stale] });
    expect(formatColorMapCheck(result)).toBe(
      ' Read back the datasource document: every requested member color matched.',
    );
    expect(formatStaleWorksheetStyleLead(result)).toBe(
      "Applied, but the member colors in the worksheet's own <style> are not shown on the chart and are not set. Details: the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Furniture #ff0000. Do not tell the user they are set. To color the chart, put them in the datasource <style> with a datasource-level <column-instance> (apply-datasource). ",
    );
  });

  it('makes no pass or fail claim when there is no requested map', () => {
    const result = colorMapVerificationResult([stale], '<datasource name="x" />', {
      hasIntended: false,
    });
    expect(result).toMatchObject({ ok: true, status: 'skipped' });
    expect(formatStaleWorksheetStyleLead(result)).toContain('Do not tell the user they are set.');
    const text = formatColorMapCheck(result);
    expect(text).not.toContain('matched');
    expect(text).not.toContain('not verified');
  });

  it('adds the unread-sheet line only when the baseline read failed', () => {
    const unread = {
      severity: 'warning' as const,
      source: 'color-map' as const,
      message: 'The sheet could not be read before the apply, so some of these may be new',
      reason: 'color-baseline-unavailable',
    };
    const lead = formatStaleWorksheetStyleLead(
      colorMapVerificationResult([stale, unread], '<datasource name="x" />', {
        hasIntended: false,
      }),
    );
    expect(lead).toContain(
      '(apply-datasource). The sheet could not be read before the apply, so some of these may be new. ',
    );
    expect(
      formatStaleWorksheetStyleLead(colorMapVerificationResult([stale], '<datasource name="x" />')),
    ).not.toContain('could not be read');
  });

  it('keeps notes in the merged findings without changing the base status', () => {
    const base: ReadbackVerificationResult = { ok: true, status: 'passed' };
    const merged = mergeColorMapVerification(
      base,
      colorMapVerificationResult([stale], '<datasource name="x" />'),
    );
    expect(merged).toEqual({ ok: true, status: 'passed', findings: [stale] });
    expect(
      mergeColorMapVerification(undefined, colorMapVerificationResult([stale], '<x />')),
    ).toBeUndefined();
  });
});
