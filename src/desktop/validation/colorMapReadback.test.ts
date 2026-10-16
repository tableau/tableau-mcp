import { readFileSync } from 'fs';
import { join } from 'path';

import {
  colorMapVerificationResult,
  colorReadbackUnavailableFinding,
  compareColorMaps,
  extractColorMaps,
  formatColorMapCheck,
  mergeColorMapVerification,
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

  it('keeps copies that differ so a comparison can accept either', () => {
    const other = CATEGORY_ENCODING.replace('#9c755f', '#111111');
    const maps = extractColorMaps(datasourceXml(`${CATEGORY_ENCODING}${other}`));
    expect(maps).toHaveLength(2);
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

  it('passes a member when any readback copy carries the requested color', () => {
    const stale = CATEGORY_ENCODING.replace('#9c755f', '#4e79a7');
    const readback = extractColorMaps(datasourceXml(`${stale}${CATEGORY_ENCODING}`)) ?? [];
    expect(readback).toHaveLength(2);
    const twoMembers = extractColorMaps(datasourceXml(CATEGORY_ENCODING)) ?? [];
    expect(compareColorMaps(twoMembers, readback)).toEqual([]);
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
  it('passes a bucket when the readback matches either of two differing intended copies', () => {
    const xml = (sheetHex: string): string => `<workbook><datasources>
      <datasource name='superstore'>${styleBlock(CATEGORY_ENCODING)}</datasource>
    </datasources><worksheets><worksheet name='L2'><table><view>
      <datasource-dependencies datasource='superstore'>${styleBlock(
        CATEGORY_ENCODING.replace('#9c755f', sheetHex),
      )}</datasource-dependencies>
    </view></table></worksheet></worksheets></workbook>`;
    const intended = extractColorMaps(xml('#4e79a7')) ?? [];
    expect(intended).toHaveLength(2);

    const sheetWon = extractColorMaps(
      datasourceXml(CATEGORY_ENCODING.replace('#9c755f', '#4e79a7')),
    );
    expect(compareColorMaps(intended, sheetWon ?? [])).toEqual([]);

    const neither = extractColorMaps(
      datasourceXml(CATEGORY_ENCODING.replace('#9c755f', '#111111')),
    );
    expect(compareColorMaps(intended, neither ?? []).map((finding) => finding.message)).toEqual([
      '[none:Category:nk]: Technology expected #9c755f or #4e79a7, found #111111',
    ]);
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

  it('adds a warning finding without changing the status', () => {
    const warning = colorMapVerificationResult(
      [colorReadbackUnavailableFinding('superstore', 'document read failed')],
      '',
    );
    const merged = mergeColorMapVerification(base, warning);
    expect(merged).toMatchObject({ ok: true, status: 'passed', message: 'Readback matched.' });
    expect(merged?.findings).toEqual(warning.findings);
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
