import { validateUnderlyingMetadataLoad } from './underlyingMetadataGuard.js';

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
// prolog, then a COMMENT, then the root. The guard must accept this — the
// 2026-07-19 live false-positive rejected every legitimate whole document.
const REAL_HEAD_WORKBOOK_XML =
  "<?xml version='1.0' encoding='utf-8' ?>\n\n<!-- build main.26.0715.2311                                -->\n" +
  LIVE_WORKBOOK_XML;

describe('validateUnderlyingMetadataLoad', () => {
  it('accepts a real document head (prolog + build comment before the root)', () => {
    expect(validateUnderlyingMetadataLoad(REAL_HEAD_WORKBOOK_XML, null).ok).toBe(true);
  });

  it('rejects the reviewed fragment receipt', () => {
    const result = validateUnderlyingMetadataLoad('<workbook><applied /></workbook>', null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('whole-document or nothing');
    expect(result.message).toContain('FIX:');
    expect(result.message).toContain('tabui:save-underlying-metadata');
  });

  it('rejects a workbook document with zero worksheets', () => {
    const result = validateUnderlyingMetadataLoad(
      "<workbook><datasources><datasource name='ds' /></datasources></workbook>",
      null,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('at least one <datasource');
    expect(result.message).toContain('at least one <worksheet');
    expect(result.message).toContain('FIX:');
  });

  it('rejects a load missing a worksheet from the live document', () => {
    const submitted = LIVE_WORKBOOK_XML.replace(
      "    <worksheet name='B'>\n      <table><view /></table>\n    </worksheet>\n",
      '',
    );

    const result = validateUnderlyingMetadataLoad(submitted, LIVE_WORKBOOK_XML);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('DROP worksheet(s) B');
    expect(result.message).toContain('delete-worksheet tool');
  });

  it('accepts a spliced whole workbook document that preserves live worksheets', () => {
    expect(validateUnderlyingMetadataLoad(SPLICED_WORKBOOK_XML, LIVE_WORKBOOK_XML)).toEqual({
      ok: true,
    });
  });

  it('accepts a static-valid document when the live document is unavailable', () => {
    expect(validateUnderlyingMetadataLoad(SPLICED_WORKBOOK_XML, null)).toEqual({ ok: true });
  });

  it('rejects a gross shrink against the live document', () => {
    const live = LIVE_WORKBOOK_XML + '<!-- '.padEnd(800, 'x') + ' -->';
    const submitted = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A' /><worksheet name='B' /></worksheets>
</workbook>`;

    const result = validateUnderlyingMetadataLoad(submitted, live);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('less than half the size of the live');
    expect(result.message).toContain('likely a fragment or stale copy');
  });

  it('accepts an XML prolog before the workbook root', () => {
    expect(
      validateUnderlyingMetadataLoad(`<?xml version="1.0"?>\n${SPLICED_WORKBOOK_XML}`, null),
    ).toEqual({ ok: true });
  });

  it('accepts escaped worksheet names when both documents preserve the raw attribute string', () => {
    const workbookXml = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A &amp; &apos;Q&apos; &quot;Sales&quot;' /></worksheets>
</workbook>`;

    expect(validateUnderlyingMetadataLoad(workbookXml, workbookXml)).toEqual({ ok: true });
  });
});
