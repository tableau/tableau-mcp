// Colocated tests for the pure inject core (removeSameNamedWorksheet +
// buildInjectedWorkbookXml). These exercise the REAL functions (no mocks) — the
// sibling injectTemplate.test.ts mocks injectTemplate, so a real round-trip can
// only live here. Cases ported from the W60 adversary probe (P0-3 double-quote,
// P2-7 attribute-order) plus a reserialization round-trip.
import { buildInjectedWorkbookXml, removeSameNamedWorksheet } from './injectTemplateCore.js';

describe('removeSameNamedWorksheet — quote-agnostic strip (adversary P0-3)', () => {
  it('strips a double-quoted worksheet + window (the serializer emits double quotes)', () => {
    const workbookXml = [
      '<workbook><worksheets><worksheet name="Sales">OLD BODY</worksheet></worksheets>',
      '<windows><window class="worksheet" name="Sales"/></windows></workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'Sales');

    expect(out).not.toContain('OLD BODY');
    expect(out).not.toContain('<window class="worksheet" name="Sales"/>');
  });

  it('still strips a single-quoted worksheet + window (Desktop-native shape)', () => {
    const workbookXml = [
      "<workbook><worksheets><worksheet name='Sales'>OLD BODY</worksheet></worksheets>",
      "<windows><window class='worksheet' name='Sales'/></windows></workbook>",
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'Sales');

    expect(out).not.toContain('OLD BODY');
    expect(out).not.toContain("<window class='worksheet' name='Sales'/>");
  });
});

describe('removeSameNamedWorksheet — attribute-order tolerant window strip (adversary P2-7)', () => {
  it('strips a <window> whose "active" attribute sorts before "class"', () => {
    const workbookXml = [
      "<workbook><worksheets><worksheet name='Sales'>OLD BODY</worksheet></worksheets>",
      "<windows><window active='true' class='worksheet' maximized='true' name='Sales'/></windows>",
      '</workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'Sales');

    expect(out).not.toContain('OLD BODY');
    expect(out).not.toContain('name=');
    // The <window> ENTRY is gone; the <windows> container legitimately survives, so
    // match the entry element boundary (`<window\b`) rather than the `<window` substring.
    expect(out).not.toMatch(/<window\b/);
  });

  it('strips a double-quoted, attribute-reordered window (both defeats combined)', () => {
    const workbookXml = [
      '<workbook><worksheets><worksheet name="Sales">OLD BODY</worksheet></worksheets>',
      '<windows><window active="true" class="worksheet" name="Sales"/></windows></workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'Sales');

    expect(out).not.toContain('OLD BODY');
    expect(out).not.toMatch(/<window\b/);
  });
});

describe('removeSameNamedWorksheet — dashboard-zone fail-safe holds for double quotes too', () => {
  it('leaves a double-quoted workbook untouched when a dashboard zone references the sheet', () => {
    const workbookXml = [
      '<workbook><worksheets><worksheet name="Sales">BODY</worksheet></worksheets>',
      '<dashboards><dashboard name="D1"><zones><zone name="Sales" x="0"/></zones></dashboard></dashboards>',
      '</workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'Sales');

    expect(out).toBe(workbookXml);
  });
});

describe('buildInjectedWorkbookXml — reserialization round-trip (adversary P0-3)', () => {
  const templateXml = [
    "<?xml version='1.0'?><workbook>",
    "<worksheets><worksheet name='{{TITLE}}'><table/></worksheet></worksheets>",
    "<windows><window class='worksheet' name='{{TITLE}}'/></windows>",
    '</workbook>',
  ].join('');

  const initialWorkbookXml = [
    "<?xml version='1.0'?><workbook>",
    "<worksheets><worksheet name='Keep'><table/></worksheet></worksheets>",
    "<windows><window class='worksheet' name='Keep'/></windows>",
    '</workbook>',
  ].join('');

  it('applying the same title twice leaves exactly one worksheet + window for it', () => {
    const cycle1 = buildInjectedWorkbookXml({
      workbookXml: initialWorkbookXml,
      templateXml,
      title: 'Sales',
      sheetType: 'worksheet',
      applyNonce: 'cycle-1',
    });
    expect(cycle1.ok).toBe(true);
    if (!cycle1.ok) return;

    // Cycle 1's output is what this pipeline re-reads on the 2nd apply — and it is
    // double-quoted (fast-xml-parser XMLBuilder default), the exact case the old
    // single-quote regex silently no-oped on.
    expect(cycle1.xml).toContain('<worksheet name="Sales">');

    const cycle2 = buildInjectedWorkbookXml({
      workbookXml: cycle1.xml,
      templateXml,
      title: 'Sales',
      sheetType: 'worksheet',
      applyNonce: 'cycle-2',
    });
    expect(cycle2.ok).toBe(true);
    if (!cycle2.ok) return;

    const worksheetCount = (cycle2.xml.match(/<worksheet name="Sales">/g) ?? []).length;
    expect(worksheetCount).toBe(1);
    const windowCount = (cycle2.xml.match(/<window[^>]*name="Sales"/g) ?? []).length;
    expect(windowCount).toBe(1);
    // The unrelated sheet is preserved across both cycles.
    expect(cycle2.xml).toContain('name="Keep"');
  });
});
