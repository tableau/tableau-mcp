// Colocated tests for the pure inject core (removeSameNamedWorksheet +
// buildInjectedWorkbookXml). These exercise the REAL functions (no mocks) — the
// sibling injectTemplate.test.ts mocks injectTemplate, so a real round-trip can
// only live here. Cases ported from the W60 adversary probe (P0-3 double-quote,
// P2-7 attribute-order) plus a reserialization round-trip. The strip is now
// STRUCTURAL (parse → filter → serialize), so these pin behavior — quote style,
// attribute order, multi-duplicate convergence (P2-8) — not string mechanics.
import { readFileSync } from 'fs';
import { join } from 'path';

import { injectTemplate } from './injectTemplate.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
  removeSameNamedWorksheet,
} from './injectTemplateCore.js';

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
  // The REAL shipped template — the one the binder injects for a time-series ask.
  const TREND_TEMPLATE = readFileSync(
    join(__dirname, '../data/templates/trend-line-chart.xml'),
    'utf-8',
  );
  // An empty workbook to inject into (bind-template's auto_apply passes the live one).
  const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
  const TREND_SLOTS = [
    {
      slot_id: 'order_date',
      template_field: '{{field_base_1}}',
      required: true,
      bindable: true,
      kind: 'temporal',
      role: ['cols'],
    },
    {
      slot_id: 'sales',
      template_field: '{{field_base_2}}',
      required: true,
      bindable: true,
      kind: 'quantitative',
      role: ['rows'],
    },
    {
      slot_id: 'facet_col',
      template_field: '{{field_base_3}}',
      required: false,
      bindable: true,
      kind: 'categorical',
      role: ['cols'],
    },
    {
      slot_id: 'color_series',
      template_field: '{{field_base_4}}',
      required: false,
      bindable: true,
      kind: 'categorical',
      role: ['color'],
    },
  ];

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
      fieldMapping: { sales: '[federated.mau].[sum:mau:qk]' },
      templateSlots: TREND_SLOTS,
      applyNonce: 'e4-nonce',
      dateparseAxis: {
        templateField: '{{field_base_1}}',
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
      /name="(\[Calculation_field_base_1[^"]*\])"[^>]*>\s*<calculation/,
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
        order_date: '[federated.sales].[tmn:order_date:qk]',
        sales: '[federated.sales].[sum:sales:qk]',
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
  const CHOROPLETH_TEMPLATE = readFileSync(
    join(__dirname, '../data/templates/spatial-choropleth-map.xml'),
    'utf-8',
  );
  const SYMBOL_TEMPLATE = readFileSync(
    join(__dirname, '../data/templates/spatial-symbol-map.xml'),
    'utf-8',
  );

  it('removes an unbound optional state LOD from a country-only choropleth', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: CHOROPLETH_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'Football' },
      fieldMapping: {
        Country: '[Football].[none:Country:nk]',
        Profit: '[Football].[sum:Goals For:qk]',
      },
      optionalFieldPrunes: [{ templateField: 'State', derivation: 'none', role: 'nk' }],
      applyNonce: 'country-choropleth',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[Football].[none:Country:nk]');
    expect(result.xml).toContain('[Football].[sum:Goals For:qk]');
    expect(result.xml).not.toContain('[none:State:nk]');
    expect(result.xml).not.toContain('name="[State]"');
    expect(result.xml).not.toContain('column="[State]"');
  });

  it('removes unbound optional state/city LODs from a country-only symbol map', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: SYMBOL_TEMPLATE,
      title: 'Goals by Country',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'Football' },
      fieldMapping: {
        'Country/Region': '[Football].[none:Country:nk]',
        Sales: '[Football].[sum:Goals For:qk]',
      },
      optionalFieldPrunes: [
        { templateField: 'State/Province', derivation: 'none', role: 'nk' },
        { templateField: 'City', derivation: 'none', role: 'nk' },
      ],
      applyNonce: 'country-symbol',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[Football].[none:Country:nk]');
    expect(result.xml).toContain('[Football].[sum:Goals For:qk]');
    expect(result.xml).not.toContain('[none:State/Province:nk]');
    expect(result.xml).not.toContain('[none:City:nk]');
    expect(result.xml).not.toContain('name="[State/Province]"');
    expect(result.xml).not.toContain('name="[City]"');
  });

  it('keeps the full symbol-map hierarchy when every geo slot is bound', () => {
    const result = buildInjectedWorkbookXml({
      workbookXml: EMPTY_WORKBOOK,
      templateXml: SYMBOL_TEMPLATE,
      title: 'Goals by City',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'Football' },
      fieldMapping: {
        'Country/Region': '[Football].[none:Country:nk]',
        'State/Province': '[Football].[none:State:nk]',
        City: '[Football].[none:City:nk]',
        Sales: '[Football].[sum:Goals For:qk]',
      },
      applyNonce: 'full-symbol',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[Football].[none:Country:nk]');
    expect(result.xml).toContain('[Football].[none:State:nk]');
    expect(result.xml).toContain('[Football].[none:City:nk]');
  });
});

describe('buildInjectedWorkbookXml — manifest slot finalization', () => {
  const EMPTY_WORKBOOK = "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>";
  const RANKING_TEMPLATE = readFileSync(
    join(__dirname, '../data/templates/ranking-ordered-bar.xml'),
    'utf-8',
  );
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

  it('reports a missing name as not-found', () => {
    expect(classifyWorksheetReplaceTarget(WB, 'Nope')).toBe('not-found');
  });

  it('reports not-found on unparseable XML (downstream parse surfaces the real error)', () => {
    expect(classifyWorksheetReplaceTarget('<workbook', 'Loose Sheet')).toBe('not-found');
  });
});
