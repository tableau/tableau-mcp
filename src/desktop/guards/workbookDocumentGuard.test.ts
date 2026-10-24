import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  liveSheetNamesMissingFrom,
  validateWorkbookDocumentApply,
} from './workbookDocumentGuard.js';

const LIVE_WORKBOOK_XML = `<workbook>
  <datasources>
    <datasource name='ds'>
      <column name='[Sales]' />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='A'>
      <table><view /></table>
    </worksheet>
    <worksheet name='B'>
      <table><view /></table>
    </worksheet>
  </worksheets>
</workbook>`;

const SPLICED_WORKBOOK_XML = LIVE_WORKBOOK_XML.replace(
  "<column name='[Sales]' />",
  "<column name='[Sales]' />\n      <column name='[Profit]' />",
);

// Verbatim head shape of a real Desktop document (build main.26.0715.2311):
// prolog, then a COMMENT, then the root. The guard must accept this.
const REAL_HEAD_WORKBOOK_XML =
  "<?xml version='1.0' encoding='utf-8' ?>\n\n<!-- build main.26.0715.2311                                -->\n" +
  LIVE_WORKBOOK_XML;

const REAL_FIXTURE = join(
  process.cwd(),
  'src/tools/desktop/authoring/datasource/__fixtures__/real-superstore-document.twb.xml',
);

describe('validateWorkbookDocumentApply', () => {
  it('accepts a real document head (prolog + build comment before the root)', () => {
    expect(validateWorkbookDocumentApply(REAL_HEAD_WORKBOOK_XML, null).ok).toBe(true);
  });

  it('rejects a workbook document that is only an apply receipt', () => {
    const result = validateWorkbookDocumentApply('<workbook><applied /></workbook>', null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('at least one <datasource');
    expect(result.message).toContain('FIX:');
    expect(result.message).toContain('re-reads the live workbook');
  });

  it('rejects a workbook document with zero worksheets', () => {
    const result = validateWorkbookDocumentApply(
      "<workbook><datasources><datasource name='ds' /></datasources></workbook>",
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('at least one <datasource');
    expect(result.message).toContain('at least one <worksheet');
    expect(result.message).toContain('FIX:');
  });

  it('rejects an apply missing a worksheet from the live document', () => {
    const submitted = LIVE_WORKBOOK_XML.replace(
      "    <worksheet name='B'>\n      <table><view /></table>\n    </worksheet>\n",
      '',
    );

    const result = validateWorkbookDocumentApply(submitted, LIVE_WORKBOOK_XML);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('DROP sheet(s) B');
    expect(result.message).toContain('a separate request');
  });

  it('rejects a dropped worksheet whose live name is DOUBLE-quoted (guard must not fail open)', () => {
    const live = `<workbook>
  <datasources><datasource name='ds'><column name='[Sales]' /></datasource></datasources>
  <worksheets>
    <worksheet name="A"><table><view /></table></worksheet>
    <worksheet name="B"><table><view /></table></worksheet>
  </worksheets>
</workbook>`;
    const submitted = live.replace(
      '    <worksheet name="B"><table><view /></table></worksheet>\n',
      '',
    );

    const result = validateWorkbookDocumentApply(submitted, live);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('DROP sheet(s) B');
  });

  it('accepts a spliced whole workbook document that preserves live worksheets', () => {
    expect(validateWorkbookDocumentApply(SPLICED_WORKBOOK_XML, LIVE_WORKBOOK_XML)).toEqual({
      ok: true,
    });
  });

  it('accepts a static-valid document when the live document is unavailable', () => {
    expect(validateWorkbookDocumentApply(SPLICED_WORKBOOK_XML, null)).toEqual({ ok: true });
  });

  it('rejects a gross shrink against the live document', () => {
    const live = LIVE_WORKBOOK_XML + '<!-- '.padEnd(800, 'x') + ' -->';
    const submitted = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A' /><worksheet name='B' /></worksheets>
</workbook>`;

    const result = validateWorkbookDocumentApply(submitted, live);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('less than half the size of the live');
    expect(result.message).toContain('likely a fragment or a stale copy');
  });

  it('accepts an XML prolog before the workbook root', () => {
    expect(
      validateWorkbookDocumentApply(`<?xml version="1.0"?>\n${SPLICED_WORKBOOK_XML}`, null),
    ).toEqual({ ok: true });
  });

  it('accepts escaped worksheet names when both documents preserve the raw attribute string', () => {
    const workbookXml = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A &amp; &apos;Q&apos; &quot;Sales&quot;' /></worksheets>
</workbook>`;

    expect(validateWorkbookDocumentApply(workbookXml, workbookXml)).toEqual({ ok: true });
  });

  it('rejects an apply missing a dashboard from the live document', () => {
    const live = LIVE_WORKBOOK_XML.replace(
      '</workbook>',
      "<dashboards><dashboard name='D'><zones /></dashboard></dashboards></workbook>",
    );

    const result = validateWorkbookDocumentApply(LIVE_WORKBOOK_XML + '<!-- pad -->', live);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('DROP sheet(s) D');
  });

  it('accepts an edit that keeps a live dashboard', () => {
    const live = LIVE_WORKBOOK_XML.replace(
      '</workbook>',
      "<dashboards><dashboard name='D'><zones /></dashboard></dashboards></workbook>",
    );

    expect(validateWorkbookDocumentApply(live, live)).toEqual({ ok: true });
  });

  it('fails closed when the live document cannot be parsed', () => {
    const result = validateWorkbookDocumentApply(LIVE_WORKBOOK_XML, '<!DOCTYPE x><workbook/>');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('could not read');
  });
});

describe('liveSheetNamesMissingFrom', () => {
  const wb = (inner: string): string => `<workbook>${inner}</workbook>`;
  const ws = (...names: string[]): string =>
    `<worksheets>${names.map((n) => `<worksheet name='${n}'/>`).join('')}</worksheets>`;
  const db = (...names: string[]): string =>
    `<dashboards>${names.map((n) => `<dashboard name='${n}'/>`).join('')}</dashboards>`;

  it('names a dropped worksheet', () => {
    expect(liveSheetNamesMissingFrom(wb(ws('A')), wb(ws('A', 'B')))).toEqual(['B']);
  });

  it('names a dropped dashboard', () => {
    expect(liveSheetNamesMissingFrom(wb(ws('A')), wb(ws('A') + db('D')))).toEqual(['D']);
  });

  it('names a dropped story (dashboard type=storyboard)', () => {
    const live = wb(ws('A') + "<dashboards><dashboard name='S' type='storyboard'/></dashboards>");
    expect(liveSheetNamesMissingFrom(wb(ws('A')), live)).toEqual(['S']);
  });

  it('allows an added sheet', () => {
    expect(liveSheetNamesMissingFrom(wb(ws('A', 'B', 'C')), wb(ws('A', 'B')))).toEqual([]);
  });

  it('returns missing names in live order, deduped', () => {
    const live = wb(ws('Z', 'A', 'Z', 'M'));
    expect(liveSheetNamesMissingFrom(wb(ws('M')), live)).toEqual(['Z', 'A']);
  });

  it('handles a single worksheet (parser yields an object, not an array)', () => {
    expect(liveSheetNamesMissingFrom(wb(db('D')), wb(ws('A')))).toEqual(['A']);
  });

  it('accepts either quote style for the same name', () => {
    const submitted = wb('<worksheets><worksheet name="A"/></worksheets>');
    expect(liveSheetNamesMissingFrom(submitted, wb(ws('A')))).toEqual([]);
  });

  it('ignores windows, zones and attributes that only end in name', () => {
    const live = wb(
      ws('A') +
        "<windows><window class='worksheet' name='W'/></windows>" +
        "<dashboards><dashboard name='D'><zones><zone name='Z' x-name='Q'/></zones></dashboard></dashboards>",
    );
    expect(liveSheetNamesMissingFrom(live, live)).toEqual([]);
    expect(liveSheetNamesMissingFrom(wb(ws('A') + db('D')), live)).toEqual([]);
  });

  it('matches <worksheet name=...> with name as the first attribute', () => {
    expect(liveSheetNamesMissingFrom(wb(ws('B')), wb(ws('A', 'B')))).toEqual(['A']);
  });

  it('treats an entity-encoded name and its literal spelling as the same name', () => {
    const live = wb('<worksheets><worksheet name="It\'s &amp; &gt; &#65;"/></worksheets>');
    const submitted = wb("<worksheets><worksheet name='It&apos;s &amp; &gt; A'/></worksheets>");
    expect(liveSheetNamesMissingFrom(submitted, live)).toEqual([]);
  });

  it('decodes &amp;lt; once: "A &lt; B" literal text differs from "A < B"', () => {
    const live = wb("<worksheets><worksheet name='A &amp;lt; B'/></worksheets>");
    const submitted = wb("<worksheets><worksheet name='A &lt; B'/></worksheets>");
    expect(liveSheetNamesMissingFrom(submitted, live)).toEqual(['A &lt; B']);
  });

  it('throws on a document it cannot parse', () => {
    expect(() => liveSheetNamesMissingFrom(wb(ws('A')), '<!DOCTYPE x><workbook/>')).toThrow();
  });

  it('reads the real Desktop fixture sheet inventory (4 worksheets + 1 dashboard)', () => {
    const real = readFileSync(REAL_FIXTURE, 'utf8');
    expect(liveSheetNamesMissingFrom(wb(ws('nothing')), real)).toEqual([
      'Monthly Sales Funnel',
      'Profit by Sub-Category: Standouts vs Everyone Else',
      'Profit by category as a bar chart, sorted descending by profit (most profitable',
      'stage-encore-canon',
      'Sales by Region',
    ]);
    expect(liveSheetNamesMissingFrom(real, real)).toEqual([]);
  });
});
