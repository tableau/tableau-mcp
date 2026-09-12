// Colocated tests for the pure inject core (removeSameNamedWorksheet +
// buildInjectedWorkbookXml). These exercise the REAL functions (no mocks) — the
// sibling injectTemplate.test.ts mocks injectTemplate, so a real round-trip can
// only live here. Cases ported from the W60 adversary probe (P0-3 double-quote,
// P2-7 attribute-order) plus a reserialization round-trip. The strip is now
// STRUCTURAL (parse → filter → serialize), so these pin behavior — quote style,
// attribute order, multi-duplicate convergence (P2-8) — not string mechanics.
import type { SlotSpec } from '../binder/manifest-types.js';
import { injectTemplate } from './injectTemplate.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
  removeSameNamedWorksheet,
  stripDonorCurrencyOrLocaleFormats,
  workbookHasSheetNamed,
} from './injectTemplateCore.js';
import { getRuntimeTemplateSnapshot } from './runtimeTemplateCatalog.js';
import { readTemplate } from './templatePath.js';

// Pre-existing pile-up fixture (P2-8): two stale "Sales" copies in MIXED quote
// styles + attribute orders (what Desktop dedup left behind before the strip was
// quote-agnostic), one unrelated sheet, and a DASHBOARD-class window that shares
// the name and must survive any strip.
const DUPLICATED_WORKBOOK_XML = [
  "<?xml version='1.0'?><workbook>",
  "<worksheets><worksheet name='Keep'><table/></worksheet>",
  '<worksheet name="Sales">STALE COPY 1</worksheet>',
  "<worksheet name='Sales'>STALE COPY 2</worksheet></worksheets>",
  '<windows><window class="worksheet" name="Keep"/>',
  '<window class="worksheet" name="Sales"/>',
  "<window active='true' class='worksheet' name='Sales'/>",
  '<window class="dashboard" name="Sales"/></windows>',
  '</workbook>',
].join('');

describe('stripDonorCurrencyOrLocaleFormats', () => {
  const templateXml =
    '<workbook><style><style-rule element="label">' +
    '<format attr="text-format" field="[Donor].[sum:Profit:qk]" value="c&amp;quot;£&amp;quot;#,##0"/>' +
    '<format attr="text-format" field="[Donor].[sum:Quantity:qk]" value="n#,##0.00"/>' +
    '</style-rule></style></workbook>';

  it('removes donor currency while preserving neutral precision during a bind', () => {
    const out = stripDonorCurrencyOrLocaleFormats(templateXml, {
      Profit: '[Superstore].[sum:Sales:qk]',
    });

    expect(out).not.toContain('£');
    expect(out).toContain('value="n#,##0.00"');
  });

  it('leaves the template byte-identical without a field bind', () => {
    expect(stripDonorCurrencyOrLocaleFormats(templateXml, {})).toBe(templateXml);
  });

  it('leaves the template byte-identical when the mapping names no authored field', () => {
    expect(
      stripDonorCurrencyOrLocaleFormats(templateXml, {
        Nonexistent: '[Superstore].[sum:Sales:qk]',
      }),
    ).toBe(templateXml);
  });
});

describe('buildInjectedWorkbookXml — caller-authored KPI formatting', () => {
  it('preserves currency VALUE_FORMAT and escapes literal labels exactly once', () => {
    const templateXml = readTemplate('insights__kpi')!;
    const result = buildInjectedWorkbookXml({
      workbookXml: "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>",
      templateXml,
      title: 'R&D KPI',
      sheetType: 'worksheet',
      templateParameters: {
        DATASOURCE: 'Analytics',
        METRIC_NAME: 'R&D Sales',
        TARGET_PERIOD_CONTEXT: 'Q1 "actual"',
        COMPARISON_PERIOD_CONTEXT: "Prior year's Q1",
        DIRECTION_SYMBOL: '▲',
        CHANGE_COLOR: '#208591',
        VALUE_FORMAT: 'c"$"#,##0,.0K;-"$"#,##0,.0K',
      },
      fieldMapping: {
        '{{field_base_1}}': '[Analytics].[none:KPI Tile:nk]',
        '{{field_base_2}}': '[Analytics].[usr:Target:qk]',
        '{{field_base_3}}': '[Analytics].[usr:Comparison:qk]',
        '{{field_base_4}}': '[Analytics].[usr:Absolute Change:qk]',
        '{{field_base_5}}': '[Analytics].[usr:Relative Change:qk]',
      },
      applyNonce: 'kpi-format',
    });

    if (!result.ok) throw new Error(result.issues.join('; '));
    expect(result.xml).toContain('value="c&quot;$&quot;#,##0,.0K;-&quot;$&quot;#,##0,.0K"');
    expect(result.xml).toContain('R&amp;D Sales');
    expect(result.xml).not.toContain('R&amp;amp;D Sales');
    expect(result.xml).toContain('Q1 &quot;actual&quot;');
    expect(result.xml).toContain("Prior year's Q1 | ");
    expect(result.xml).not.toContain("PREVIOUS PERIOD | Prior year's Q1 | ");
    expect(result.xml).toContain('&lt;[Analytics].[usr:Comparison:qk]&gt;');
    expect(result.xml).toContain('<text column="[Analytics].[usr:Target:qk]">');
    expect(result.xml).toContain('<text column="[Analytics].[usr:Relative Change:qk]">');
    expect(result.xml).toContain('<tooltip column="[Analytics].[usr:Comparison:qk]">');
    expect(result.xml).toContain('<tooltip column="[Analytics].[usr:Absolute Change:qk]">');
    expect(result.xml).not.toContain('<text column="[Analytics].[usr:Comparison:qk]">');
    expect(result.xml).not.toContain('<text column="[Analytics].[usr:Absolute Change:qk]">');
    expect(result.xml).toContain(
      '<run bold="true" fontcolor="#208591">&lt;[Analytics].[usr:Relative Change:qk]&gt;</run>',
    );
  });
});

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

  it('does not double-decode already parsed worksheet names', () => {
    const workbookXml = [
      '<workbook><worksheets>',
      '<worksheet name="A &amp; B">PLAIN AMPERSAND</worksheet>',
      '<worksheet name="A &amp;amp; B">LITERAL ENTITY TEXT</worksheet>',
      '</worksheets><windows>',
      '<window class="worksheet" name="A &amp; B"/>',
      '<window class="worksheet" name="A &amp;amp; B"/>',
      '</windows></workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, 'A & B');

    expect(out).not.toContain('PLAIN AMPERSAND');
    expect(out).toContain('LITERAL ENTITY TEXT');
    expect(out).toContain('name="A &amp;amp; B"');
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

describe('removeSameNamedWorksheet — structural multi-strip of pre-existing duplicates (P2-8)', () => {
  it('removes ALL same-named worksheet nodes and worksheet-window entries, not just the first', () => {
    const out = removeSameNamedWorksheet(DUPLICATED_WORKBOOK_XML, 'Sales');

    expect(out).not.toContain('STALE COPY 1');
    expect(out).not.toContain('STALE COPY 2');
    expect(out).not.toMatch(/<worksheet name=['"]Sales['"]/);
    // The unrelated sheet and its window survive; so does the DASHBOARD-class
    // window that merely shares the name (class filter, same as before).
    expect(out).toMatch(/<worksheet name="Keep">/);
    expect(out).toMatch(/<window class="worksheet" name="Keep">/);
    expect(out).toMatch(/<window class="dashboard" name="Sales">/);
    expect((out.match(/<window\b/g) ?? []).length).toBe(2);
  });

  it('zone fail-safe still wins over multi-strip: ALL duplicates stay when a dashboard references the name', () => {
    const withZone = DUPLICATED_WORKBOOK_XML.replace(
      '<windows>',
      '<dashboards><dashboard name="D1"><zones><zone name="Sales" x="0"/></zones></dashboard></dashboards><windows>',
    );

    expect(removeSameNamedWorksheet(withZone, 'Sales')).toBe(withZone);
  });

  it('strips a legal-XML literal apostrophe inside double quotes (structurally decoded; regex-unreachable)', () => {
    const workbookXml = [
      '<workbook><worksheets><worksheet name="Bob\'s Sales">OLD BODY</worksheet></worksheets>',
      '<windows><window class="worksheet" name="Bob\'s Sales"/></windows></workbook>',
    ].join('');

    const out = removeSameNamedWorksheet(workbookXml, "Bob's Sales");

    expect(out).not.toContain('OLD BODY');
    expect(out).not.toMatch(/<window\b/);
  });
});

describe('buildInjectedWorkbookXml — pre-existing duplicates converge in ONE apply (P2-8)', () => {
  it('a workbook that already piled up two "Sales" copies ends with exactly one', () => {
    const templateXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='{{TITLE}}'><table/></worksheet></worksheets>",
      "<windows><window class='worksheet' name='{{TITLE}}'/></windows>",
      '</workbook>',
    ].join('');

    const result = buildInjectedWorkbookXml({
      workbookXml: DUPLICATED_WORKBOOK_XML,
      templateXml,
      title: 'Sales',
      sheetType: 'worksheet',
      applyNonce: 'converge-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).not.toContain('STALE COPY 1');
    expect(result.xml).not.toContain('STALE COPY 2');
    expect((result.xml.match(/<worksheet name="Sales">/g) ?? []).length).toBe(1);
    expect((result.xml.match(/<window class="worksheet" name="Sales">/g) ?? []).length).toBe(1);
    expect(result.xml).toMatch(/<worksheet name="Keep">/);
    expect(result.xml).toMatch(/<window class="dashboard" name="Sales">/);
  });

  it('replaces the only worksheet without serializing an empty worksheet array', () => {
    const workbookXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='Sales'><table>OLD</table></worksheet></worksheets>",
      "<windows><window class='worksheet' name='Sales'/></windows>",
      '</workbook>',
    ].join('');
    const templateXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='{{TITLE}}'><table>NEW</table></worksheet></worksheets>",
      "<windows><window class='worksheet' name='{{TITLE}}'/></windows>",
      '</workbook>',
    ].join('');

    const result = buildInjectedWorkbookXml({
      workbookXml,
      templateXml,
      title: 'Sales',
      sheetType: 'worksheet',
      applyNonce: 'replace-only-sheet',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).not.toContain('OLD');
    expect(result.xml).toContain('NEW');
    expect(result.xml.match(/<worksheet name="Sales">/g) ?? []).toHaveLength(1);
  });
});

describe('injectTemplate — appended window focus flags', () => {
  it('strips active/maximized from the appended template window while preserving existing window flags', () => {
    const workbookXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='Keep'><table/></worksheet></worksheets>",
      "<windows><window active='true' class='worksheet' maximized='true' name='Keep'/></windows>",
      '</workbook>',
    ].join('');
    const templateXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='Injected'><table/></worksheet></worksheets>",
      "<windows><window active='true' class='worksheet' maximized='true' name='Injected'/></windows>",
      '</workbook>',
    ].join('');

    const result = injectTemplate(workbookXml, templateXml, 'worksheet');

    expect(result).toMatch(/<window active="true" class="worksheet" maximized="true" name="Keep">/);
    expect(result).toMatch(/<window class="worksheet" name="Injected">/);
    expect(result).not.toMatch(/<window[^>]*name="Injected"[^>]*(active|maximized)=/);
  });

  it('normalizes a whitespace-only worksheets container before appending', () => {
    const workbookXml =
      "<?xml version='1.0'?><workbook><worksheets> \n </worksheets><windows/></workbook>";
    const templateXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='Injected'><table/></worksheet></worksheets>",
      "<windows><window class='worksheet' name='Injected'/></windows>",
      '</workbook>',
    ].join('');

    const result = injectTemplate(workbookXml, templateXml, 'worksheet');

    expect(result).toContain('<worksheet name="Injected">');
  });
});

describe('injectTemplate — real TBM numeric-entity fidelity', () => {
  it('preserves tooltip control-character references from the shipped bubble template', () => {
    const snapshot = getRuntimeTemplateSnapshot(
      'correlation__bubble-scatter__relate-two-measures-and-encode-a-third-by-size',
    );
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    const numericEntities = snapshot.xml.match(/&#(?:9|10|13);/g) ?? [];
    expect(numericEntities.length).toBeGreaterThan(0);

    const result = injectTemplate(
      '<?xml version="1.0"?><workbook><worksheets/><windows/></workbook>',
      snapshot.xml,
      'worksheet',
    );

    expect((result.match(/&#(?:9|10|13);/g) ?? []).length).toBeGreaterThanOrEqual(
      numericEntities.length,
    );
    expect(result).not.toMatch(/&amp;#(?:9|10|13);/);
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

describe('buildInjectedWorkbookXml — temporal_axis_from_string end-to-end (real trend-line template)', () => {
  const TREND_SNAPSHOT = getRuntimeTemplateSnapshot('trend-line-chart')!;
  const TREND_TEMPLATE = TREND_SNAPSHOT.xml;
  // An empty workbook to inject into (bind-template's auto_apply passes the live one).
  const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
  const TREND_SLOTS = TREND_SNAPSHOT.descriptor.slots;
  const TREND_DATE_SLOT = TREND_SLOTS.find((slot) => slot.kind === 'temporal')!;
  const TREND_MEASURE_SLOT = TREND_SLOTS.find(
    (slot) => slot.kind === 'quantitative' && slot.role.includes('rows'),
  )!;
  const TREND_COLOR_SLOT = TREND_SLOTS.find((slot) => slot.role.includes('color'))!;
  const TREND_DATEPARSE_SLOTS = TREND_SLOTS.map((slot) =>
    slot === TREND_COLOR_SLOT ? { ...slot, required: false } : slot,
  );

  it('injects a DATEPARSE month axis when the temporal slot bound a string month (e4 shape)', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: TREND_TEMPLATE,
      title: 'MAU over time',
      sheetType: 'worksheet',
      // The binder rewrote [Order Date] → [tmn:Order Date:qk] is left ALONE (no mapping key);
      // only the measure slot maps to the real field. This mirrors what validate.ts emits
      // when order_date accepts a string via temporal_from_string.
      templateParameters: { DATASOURCE: 'federated.mau' },
      fieldMapping: { [TREND_MEASURE_SLOT.template_field]: '[federated.mau].[sum:mau:qk]' },
      templateSlots: TREND_DATEPARSE_SLOTS,
      applyNonce: 'e4-nonce',
      dateparseAxis: {
        templateField: TREND_DATE_SLOT.template_field,
        sourceField: 'month',
        format: 'yyyy-MM',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = result.xml;

    // The core rewrite namespaces calc columns with the apply nonce, so [Order Date]
    // becomes [Order Date_tpl_<nonce-suffix>] consistently across the calc, its CI, and
    // the axis pill. Capture the namespaced calc name and assert the whole axis is coherent.
    const calcName = xml.match(
      /name="(\[Calculation_field_base_\d+[^"]*\])"[^>]*>\s*<calculation/,
    )?.[1];
    expect(calcName).toBeTruthy();

    // 1) The temporal base column is now a DATEPARSE calc over the string month (the
    //    serializer keeps the formula's quotes XML-encoded as &apos;).
    expect(xml).toMatch(
      /<column[^>]*datatype="date"[^>]*>\s*<calculation[^>]*formula="DATEPARSE\(&apos;yyyy-MM&apos;, \[month\]\)"/,
    );
    // 2) The string SOURCE column is declared so the formula resolves.
    expect(xml).toMatch(/<column[^>]*datatype="string"[^>]*\bname="\[month\]"/);
    // 3) The continuous Month-Trunc CI points at the SAME calc column (coherent axis).
    expect(xml).toContain(
      `<column-instance column="${calcName}" derivation="Month-Trunc" name="[tmn:${calcName!.slice(1, -1)}:qk]"`,
    );
    // 4) The measure slot still bound normally through the core rewrite.
    expect(xml).toContain('sum:mau:qk');
    // 5) NO raw [month] string leaked onto a truncated axis (the bug this fixes): the
    //    axis truncates the parsed-date calc, never the string month directly.
    expect(xml).not.toContain('[tmn:month:qk]');
    // (Well-formed: buildInjectedWorkbookXml only returns ok when the XML parses.)
  });

  it('is byte-identical to a normal inject when no dateparseAxis is passed (real-date path unchanged)', () => {
    const common = {
      workbookXml: EMPTY_WORKBOOK,
      templateXml: TREND_TEMPLATE,
      title: 'Sales over time',
      sheetType: 'worksheet' as const,
      templateParameters: { DATASOURCE: 'federated.sales' },
      fieldMapping: {
        [TREND_DATE_SLOT.template_field]: '[federated.sales].[tmn:order_date:qk]',
        [TREND_MEASURE_SLOT.template_field]: '[federated.sales].[sum:sales:qk]',
        [TREND_COLOR_SLOT.template_field]: '[federated.sales].[none:product:nk]',
      },
      templateSlots: TREND_SLOTS,
      applyNonce: 'normal-nonce',
    };
    const withUndef = buildInjectedWorkbookXml({ ...common, dateparseAxis: undefined });
    const without = buildInjectedWorkbookXml(common);
    expect(withUndef.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withUndef.ok || !without.ok) return;
    // No DATEPARSE calc leaked into the normal real-date path.
    expect(withUndef.xml).not.toContain('DATEPARSE');
    // injectTemplate mints a random <simple-id uuid> per call, so the only difference
    // between the two runs is that nonce — normalize it out to prove the real-date path
    // is otherwise byte-identical whether dateparseAxis is undefined or absent.
    const normUuid = (s: string): string => s.replace(/uuid="\{[^}]*\}"/g, 'uuid="{X}"');
    expect(normUuid(withUndef.xml)).toBe(normUuid(without.xml));
  });
});

describe('buildInjectedWorkbookXml — optional geo LOD pruning', () => {
  const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
  const CHOROPLETH_SNAPSHOT = getRuntimeTemplateSnapshot('spatial-choropleth-map')!;
  const CHOROPLETH_TEMPLATE = CHOROPLETH_SNAPSHOT.xml;
  const CHOROPLETH_GEO_SLOTS = CHOROPLETH_SNAPSHOT.descriptor.slots.filter(
    (slot) => slot.kind === 'geo',
  );
  const CHOROPLETH_COLOR_SLOT = CHOROPLETH_SNAPSHOT.descriptor.slots.find((slot) =>
    slot.role.includes('color'),
  )!;
  const CHOROPLETH_SLOTS = CHOROPLETH_SNAPSHOT.descriptor.slots.map((slot) => ({
    ...slot,
    required: slot === CHOROPLETH_GEO_SLOTS[0] || slot === CHOROPLETH_COLOR_SLOT,
  }));
  const SYMBOL_SNAPSHOT = getRuntimeTemplateSnapshot('spatial-symbol-map')!;
  const SYMBOL_TEMPLATE = SYMBOL_SNAPSHOT.xml;
  const SYMBOL_GEO_SLOTS = SYMBOL_SNAPSHOT.descriptor.slots.filter((slot) => slot.kind === 'geo');
  const SYMBOL_SIZE_SLOT = SYMBOL_SNAPSHOT.descriptor.slots.find((slot) =>
    slot.role.includes('size'),
  )!;
  const SYMBOL_SLOTS: SlotSpec[] = SYMBOL_SNAPSHOT.descriptor.slots.map((slot) => ({
    ...slot,
    required: slot === SYMBOL_GEO_SLOTS[0] || slot === SYMBOL_SIZE_SLOT,
  }));

  it('removes an unbound optional state LOD from a country-only choropleth', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: CHOROPLETH_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'Football' },
      fieldMapping: {
        [CHOROPLETH_GEO_SLOTS[0].template_field]: '[Football].[none:Country:nk]',
        [CHOROPLETH_COLOR_SLOT.template_field]: '[Football].[sum:Goals For:qk]',
      },
      optionalFieldPrunes: [
        {
          templateField: CHOROPLETH_GEO_SLOTS[1].template_field,
          derivation: 'none',
          role: 'nk',
        },
      ],
      templateSlots: CHOROPLETH_SLOTS,
      applyNonce: 'country-choropleth',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[Football].[none:Country:nk]');
    expect(result.xml).toContain('[Football].[sum:Goals For:qk]');
    expect(result.xml).toContain('<color column="[Football].[sum:Goals For:qk]"');
    expect(result.xml).not.toContain('custom-interpolated');
    expect(result.xml).not.toContain('[none:State:nk]');
    expect(result.xml).not.toContain('name="[State]"');
    expect(result.xml).not.toContain('column="[State]"');
  });

  it('injects the symbol map through its single generic geo LOD', () => {
    expect(SYMBOL_GEO_SLOTS).toHaveLength(1);
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: SYMBOL_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'Football' },
      fieldMapping: {
        [SYMBOL_GEO_SLOTS[0].template_field]: '[Football].[none:Country:nk]',
        [SYMBOL_SIZE_SLOT.template_field]: '[Football].[sum:Goals For:qk]',
      },
      templateSlots: SYMBOL_SLOTS,
      applyNonce: 'country-symbol',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[Football].[none:Country:nk]');
    expect(result.xml).toContain('[Football].[sum:Goals For:qk]');
    expect(result.xml).not.toContain('[none:Location:nk]');
  });
});

describe('buildInjectedWorkbookXml — manifest slot finalization', () => {
  const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
  const RANKING_TEMPLATE = readTemplate('ranking-ordered-bar')!;
  const RANKING_SLOTS = [
    {
      slot_id: 'region',
      template_field: '{{field_base_1}}',
      required: true,
      bindable: true,
      kind: 'categorical',
      role: ['rows', 'sort-dimension'],
    },
    {
      slot_id: 'sales',
      template_field: '{{field_base_2}}',
      required: true,
      bindable: true,
      kind: 'quantitative',
      role: ['cols', 'sort-measure'],
    },
    {
      slot_id: 'facet_row',
      template_field: '{{field_base_3}}',
      required: false,
      bindable: true,
      kind: 'categorical',
      role: ['rows'],
    },
  ];

  it('blocks a partial mapping before a literal required placeholder can be injected', () => {
    expect(() =>
      buildInjectedWorkbookXml({
        workbookXml: EMPTY_WORKBOOK,
        templateXml: RANKING_TEMPLATE,
        title: 'Goals by Country',
        sheetType: 'worksheet',
        templateParameters: { DATASOURCE: 'World Cup' },
        fieldMapping: {
          region: '[World Cup].[none:Country:nk]',
        },
        templateSlots: RANKING_SLOTS,
        applyNonce: 'partial-ranking',
      }),
    ).toThrow(
      'Template binding is incomplete after binding "Country": choose a quantitative value field for the chart and retry with a complete field mapping. No worksheet was produced.',
    );

    try {
      buildInjectedWorkbookXml({
        workbookXml: EMPTY_WORKBOOK,
        templateXml: RANKING_TEMPLATE,
        title: 'Goals by Country',
        sheetType: 'worksheet',
        templateParameters: { DATASOURCE: 'World Cup' },
        fieldMapping: {
          region: '[World Cup].[none:Country:nk]',
        },
        templateSlots: RANKING_SLOTS,
        applyNonce: 'partial-ranking-message',
      });
    } catch (error) {
      expect((error as Error).message).toContain('Country');
      expect((error as Error).message).not.toContain('Measure');
    }
  });

  it('removes an unused optional facet from the injected fragment', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: RANKING_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'World Cup' },
      fieldMapping: {
        region: '[World Cup].[none:Country:nk]',
        sales: '[World Cup].[sum:Goals For:qk]',
      },
      templateSlots: RANKING_SLOTS,
      applyNonce: 'optional-ranking',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).not.toContain('{{field_base_3}}');
  });

  it('returns a warning when an unresolved optional sort field drops computed-sort', () => {
    const optionalSortSlots = RANKING_SLOTS.map((slot) =>
      slot.slot_id === 'sales' ? { ...slot, required: false } : slot,
    );
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: RANKING_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'World Cup' },
      fieldMapping: {
        region: '[World Cup].[none:Country:nk]',
      },
      templateSlots: optionalSortSlots,
      applyNonce: 'optional-sort',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).not.toContain('<computed-sort');
    expect(result.warnings).toEqual([
      'computed-sort dropped: [World Cup].[sum:{{field_base_2}}:qk] did not resolve',
    ]);
  });

  it('keeps fully mapped output byte-stable', () => {
    const common = {
      workbookXml: EMPTY_WORKBOOK,
      templateXml: RANKING_TEMPLATE,
      title: 'Goals by Country and Group',
      sheetType: 'worksheet' as const,
      templateParameters: { DATASOURCE: 'World Cup' },
      fieldMapping: {
        '{{field_base_1}}': '[World Cup].[none:Country:nk]',
        '{{field_base_2}}': '[World Cup].[sum:Goals For:qk]',
        '{{field_base_3}}': '[World Cup].[none:Group:nk]',
      },
      applyNonce: 'full-ranking',
    };
    const previousBehavior = buildInjectedWorkbookXml(common);
    const guarded = buildInjectedWorkbookXml({ ...common, templateSlots: RANKING_SLOTS });

    expect(previousBehavior.ok).toBe(true);
    expect(guarded.ok).toBe(true);
    if (!previousBehavior.ok || !guarded.ok) return;
    const normalizeUuid = (xml: string): string =>
      xml.replace(/uuid="\{[^}]*\}"/g, 'uuid="{UUID}"');
    expect(normalizeUuid(guarded.xml)).toBe(normalizeUuid(previousBehavior.xml));
  });

  it('rejects a literal title token supplied through a bound field instead of rewriting it', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: RANKING_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'World Cup' },
      fieldMapping: {
        region: '[World Cup].[none:{{TITLE}}:nk]',
        sales: '[World Cup].[sum:Goals For:qk]',
      },
      templateSlots: RANKING_SLOTS,
      applyNonce: 'literal-title-field',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('{{TITLE}}');
  });

  it('rejects a literal title token supplied through a template parameter instead of rewriting it', () => {
    const templateXml = [
      "<?xml version='1.0'?><workbook>",
      "<worksheets><worksheet name='{{TITLE}}'><table><style value='{{LABEL}}'/></table></worksheet></worksheets>",
      "<windows><window class='worksheet' name='{{TITLE}}'/></windows>",
      '</workbook>',
    ].join('');
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { LABEL: '{{TITLE}}' },
      applyNonce: 'literal-title-parameter',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('{{TITLE}}');
  });
});

describe('classifyWorksheetReplaceTarget', () => {
  const WB = `<?xml version='1.0'?>
<workbook>
  <worksheets>
    <worksheet name='Loose Sheet'/>
    <worksheet name='Dash Member'/>
  </worksheets>
  <dashboards>
    <dashboard name='Board'>
      <zones><zone name='Dash Member'/></zones>
    </dashboard>
  </dashboards>
</workbook>`;

  it('reports a plain existing sheet as replaceable', () => {
    expect(classifyWorksheetReplaceTarget(WB, 'Loose Sheet')).toBe('replaceable');
  });

  it('reports a dashboard-member sheet as in-dashboard (replace would corrupt the dashboard)', () => {
    expect(classifyWorksheetReplaceTarget(WB, 'Dash Member')).toBe('in-dashboard');
  });

  it('uses canonical XML name equality for dashboard-member protection', () => {
    expect(classifyWorksheetReplaceTarget(WB, '  Dash Member  ')).toBe('in-dashboard');
  });

  it('reports a missing name as not-found', () => {
    expect(classifyWorksheetReplaceTarget(WB, 'Nope')).toBe('not-found');
  });

  it('reports not-found on unparseable XML (downstream parse surfaces the real error)', () => {
    expect(classifyWorksheetReplaceTarget('<workbook', 'Loose Sheet')).toBe('not-found');
  });
});

describe('workbookHasSheetNamed', () => {
  const WB = `<workbook>
    <worksheets><worksheet name='Sheet'/></worksheets>
    <dashboards><dashboard name='Dashboard'/></dashboards>
    <stories><story name='Story'/></stories>
  </workbook>`;

  it.each(['Sheet', 'Dashboard', 'Story'])('finds the global sheet name %s', (name) => {
    expect(workbookHasSheetNamed(WB, name)).toBe(true);
  });

  it('does not report an unused or unparseable sheet name', () => {
    expect(workbookHasSheetNamed(WB, 'Unused')).toBe(false);
    expect(workbookHasSheetNamed('<workbook', 'Sheet')).toBe(false);
  });

  it('uses Tableau XML name normalization across sheet types', () => {
    const normalized = '<workbook><dashboards><dashboard name="Café"/></dashboards></workbook>';

    expect(workbookHasSheetNamed(normalized, '  Cafe\u0301  ')).toBe(true);
  });
});
