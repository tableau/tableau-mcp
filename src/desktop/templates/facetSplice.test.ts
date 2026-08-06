import type { SlotSpec } from '../binder/manifest-types.js';
import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { spliceBoundFacet } from './facetSplice.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { getRuntimeTemplateSnapshot } from './runtimeTemplateCatalog.js';

// W28-C — apply-path facet splice ported from a2td (server/tools/facet-splice.test.ts):
// a BOUND optional facet slot must RENDER (land a pill on the trellis shelf), while
// every un-faceted apply stays byte-identical.
//
// tmcp adaptation notes (behavior parity with a2td is the goal):
//   - a2td's single `replaceFieldReferences` chokepoint was deleted in tmcp; each apply
//     path (inject-template, build-and-apply-worksheet) now composes the splice with the
//     frozen core inline. `apply()` below reproduces that exact two-stage pipeline
//     (splice BEFORE rewrite) so the integration pins run the shipped composition.
//   - The product-path check uses the runtime XML and descriptor derived from the shipped
//     TBM. Focused splice cases use minimal XML fixtures so they can exercise an optional
//     facet contract independently of any one shipped chart.
//   - a2td's validateXmlWellFormed(x).valid === true maps to
//     wellFormedXmlRule.validate(x).length === 0.

const trendXml = `<workbook><worksheets><worksheet name="{{TITLE}}"><table><view>
  <datasources><datasource name="{{DATASOURCE}}" /></datasources>
  <datasource-dependencies datasource="{{DATASOURCE}}">
    <column datatype="date" name="[{{field_base_1}}]" role="dimension" type="ordinal" />
    <column datatype="real" name="[{{field_base_2}}]" role="measure" type="quantitative" />
    <column datatype="string" name="[{{field_base_3}}]" role="dimension" type="nominal" />
    <column-instance column="[{{field_base_1}}]" derivation="Month-Trunc" name="[tmn:{{field_base_1}}:qk]" pivot="key" type="quantitative" />
    <column-instance column="[{{field_base_2}}]" derivation="Sum" name="[sum:{{field_base_2}}:qk]" pivot="key" type="quantitative" />
  </datasource-dependencies></view>
  <rows>[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]</rows>
  <cols>[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]</cols>
</table></worksheet></worksheets></workbook>`;

const rankingXml = `<workbook><worksheets><worksheet name="{{TITLE}}"><table><view>
  <datasources><datasource name="{{DATASOURCE}}" /></datasources>
  <datasource-dependencies datasource="{{DATASOURCE}}">
    <column datatype="string" name="[{{field_base_1}}]" role="dimension" type="nominal" />
    <column datatype="real" name="[{{field_base_2}}]" role="measure" type="quantitative" />
    <column datatype="string" name="[{{field_base_3}}]" role="dimension" type="nominal" />
    <column-instance column="[{{field_base_1}}]" derivation="None" name="[none:{{field_base_1}}:nk]" pivot="key" type="nominal" />
    <column-instance column="[{{field_base_2}}]" derivation="Sum" name="[sum:{{field_base_2}}:qk]" pivot="key" type="quantitative" />
  </datasource-dependencies></view>
  <rows>[{{DATASOURCE}}].[none:{{field_base_1}}:nk]</rows>
  <cols>[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]</cols>
</table></worksheet></worksheets></workbook>`;

const boxPlotXml = `<workbook><worksheets><worksheet name="{{TITLE}}"><table><view>
  <datasources><datasource name="{{DATASOURCE}}" /></datasources>
  <datasource-dependencies datasource="{{DATASOURCE}}">
    <column datatype="real" name="[Measure]" role="measure" type="quantitative" />
    <column datatype="string" name="[Level]" role="dimension" type="nominal" />
    <column datatype="string" name="[Facet]" role="dimension" type="nominal" />
    <column-instance column="[Measure]" derivation="Sum" name="[sum:Measure:qk]" pivot="key" type="quantitative" />
    <column-instance column="[Level]" derivation="None" name="[none:Level:nk]" pivot="key" type="nominal" />
    <column-instance column="[Facet]" derivation="None" name="[none:Facet:nk]" pivot="key" type="nominal" />
  </datasource-dependencies></view>
  <rows>[{{DATASOURCE}}].[sum:Measure:qk]</rows>
  <cols>[{{DATASOURCE}}].[none:Facet:nk]</cols>
</table></worksheet></worksheets></workbook>`;

const runtimeTrend = getRuntimeTemplateSnapshot('trend-line-chart')!;

const DS = 'Superstore';
const trendSlots: SlotSpec[] = [
  {
    slot_id: 'order_date',
    template_field: '{{field_base_1}}',
    derivation: 'tmn',
    role: ['cols'],
    kind: 'temporal',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'sales',
    template_field: '{{field_base_2}}',
    derivation: 'sum',
    role: ['rows'],
    kind: 'quantitative',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'facet_col',
    template_field: '{{field_base_3}}',
    derivation: 'none',
    role: ['cols'],
    kind: 'categorical',
    bindable: true,
    required: false,
  },
  {
    slot_id: 'color_series',
    template_field: '{{field_base_4}}',
    derivation: 'none',
    role: ['color'],
    kind: 'categorical',
    bindable: true,
    required: false,
  },
];
const rankingSlots: SlotSpec[] = [
  {
    slot_id: 'category',
    template_field: '{{field_base_1}}',
    derivation: 'none',
    role: ['rows', 'sort-dimension'],
    kind: 'categorical',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'measure',
    template_field: '{{field_base_2}}',
    derivation: 'sum',
    role: ['cols'],
    kind: 'quantitative',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'facet_row',
    template_field: '{{field_base_3}}',
    derivation: 'none',
    role: ['rows'],
    kind: 'categorical',
    bindable: true,
    required: false,
  },
];

const placeholderizePilotMapping = (
  xml: string,
  mapping: Record<string, string>,
): Record<string, string> => {
  const aliases = xml.includes('Month-Trunc')
    ? { 'Order Date': '{{field_base_1}}', Sales: '{{field_base_2}}', Facet: '{{field_base_3}}' }
    : xml.includes('{{field_base_1}}')
      ? { Category: '{{field_base_1}}', Measure: '{{field_base_2}}', Facet: '{{field_base_3}}' }
      : {};
  return Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => [
      aliases[key as keyof typeof aliases] ?? key,
      value,
    ]),
  );
};

const slotsForPilot = (xml: string): SlotSpec[] | undefined => {
  if (xml.includes('Month-Trunc')) return trendSlots;
  if (xml.includes('{{field_base_1}}')) return rankingSlots;
  return undefined;
};

/**
 * Reproduce the shipped apply pipeline: splice a bound facet onto the shelf, then run
 * the frozen field-reference rewrite — identical to what each chokepoint executes.
 */
const apply = (xml: string, mapping: Record<string, string>, ds: string): string => {
  const normalized = placeholderizePilotMapping(xml, mapping);
  const slots = slotsForPilot(xml);
  return rewriteFieldReferences(
    spliceBoundFacet(xml, normalized, slots),
    normalized,
    ds,
    undefined,
    {
      templateSlots: slots,
    },
  );
};

describe('desktop/templates/facetSplice', () => {
  // ── spliceBoundFacet (pure glue) ──────────────────────────────────────────
  describe('spliceBoundFacet — no-op / identity contracts', () => {
    it('is a strict identity when no facet is bound (byte-identity pin)', () => {
      const unfaceted = {
        'Order Date': `[${DS}].[tmn:Order Date:qk]`,
        Sales: `[${DS}].[sum:Sales:qk]`,
      };
      // Same reference back — the downstream core sees the EXACT bytes it saw
      // before this feature existed. This is the load-bearing byte-identity proof.
      expect(spliceBoundFacet(trendXml, unfaceted)).toBe(trendXml);
      expect(
        spliceBoundFacet(rankingXml, {
          Category: `[${DS}].[none:Region:nk]`,
          Measure: `[${DS}].[sum:Sales:qk]`,
        }),
      ).toBe(rankingXml);
    });

    it('is identity when the template declares no [Facet] slot even if a Facet key is present', () => {
      const noFacetTemplate =
        '<t><rows>[{{DATASOURCE}}].[none:X:nk]</rows><cols>[{{DATASOURCE}}].[sum:Y:qk]</cols></t>';
      expect(spliceBoundFacet(noFacetTemplate, { Facet: `[${DS}].[none:Z:nk]` })).toBe(
        noFacetTemplate,
      );
    });

    it('is identity when the facet is ALREADY on a shelf (box-plot-chart wires its own facet)', () => {
      // box-plot-chart already carries [none:Facet:nk] on <cols>; re-splicing would
      // duplicate the pill. The splice must leave it for the core rewrite untouched.
      expect(spliceBoundFacet(boxPlotXml, { Facet: `[${DS}].[none:Region:nk]` })).toBe(boxPlotXml);
    });
  });

  describe('spliceBoundFacet — fail-closed', () => {
    // A facet is bound, the template has a [Facet] slot, but NEITHER shelf carries a
    // resolvable dimension pill (both are measures) → the trellis shelf is ambiguous.
    const bothMeasures = `<workbook><worksheets><worksheet name='{{TITLE}}'>
  <table><view>
    <datasources><datasource name='{{DATASOURCE}}' /></datasources>
    <datasource-dependencies datasource='{{DATASOURCE}}'>
      <column datatype='real' name='[A]' role='measure' type='quantitative' />
      <column datatype='real' name='[B]' role='measure' type='quantitative' />
      <column datatype='string' name='[Facet]' role='dimension' type='nominal' />
      <column-instance column='[A]' derivation='Sum' name='[sum:A:qk]' pivot='key' type='quantitative' />
      <column-instance column='[B]' derivation='Sum' name='[sum:B:qk]' pivot='key' type='quantitative' />
    </datasource-dependencies>
  </view></table>
  <rows>[{{DATASOURCE}}].[sum:A:qk]</rows>
  <cols>[{{DATASOURCE}}].[sum:B:qk]</cols>
</worksheet></worksheets></workbook>`;

    it('throws rather than emit a corrupt/ambiguous sheet', () => {
      expect(() => spliceBoundFacet(bothMeasures, { Facet: `[${DS}].[none:Cat:nk]` })).toThrow(
        /trellis shelf/i,
      );
    });

    it('propagates fail-closed through the apply pipeline (apply errors, never corrupts)', () => {
      expect(() =>
        apply(
          bothMeasures,
          {
            A: `[${DS}].[sum:A:qk]`,
            B: `[${DS}].[sum:B:qk]`,
            Facet: `[${DS}].[none:Cat:nk]`,
          },
          DS,
        ),
      ).toThrow(/trellis shelf/i);
    });
  });

  // ── faceted apply produces the trellis shelf (both roles) ─────────────────
  describe('faceted apply — trend-line-chart facet_col (role: cols)', () => {
    const faceted = {
      'Order Date': `[${DS}].[tmn:Order Date:qk]`,
      Sales: `[${DS}].[sum:Sales:qk]`,
      Facet: `[${DS}].[none:Region:nk]`,
    };
    const out = apply(trendXml, faceted, DS);

    it('lands the facet pill on <cols> AHEAD of the date pill (exact render shape)', () => {
      expect(out).toContain(`<cols>[${DS}].[none:Region:nk] / [${DS}].[tmn:Order Date:qk]</cols>`);
    });

    it('leaves <rows> (the measure shelf) untouched', () => {
      expect(out).toContain(`<rows>[${DS}].[sum:Sales:qk]</rows>`);
    });

    it('adds the matching facet column-instance declaration (mapped to the bound field)', () => {
      expect(out).toMatch(/<column-instance[^>]*column="\[Region\]"[^>]*name="\[none:Region:nk\]"/);
    });

    it('leaves ZERO Facet residue and stays well-formed (whole-template zero-residue)', () => {
      expect(out).not.toMatch(/\[Facet\]|:Facet:/);
      expect(out).not.toContain('{{DATASOURCE}}');
      const titled = out.replace(/\{\{TITLE\}\}/g, 'Test');
      expect(wellFormedXmlRule.validate(titled)).toEqual([]);
    });
  });

  describe('faceted apply — ranking-ordered-bar facet_row (role: rows)', () => {
    const faceted = {
      Category: `[${DS}].[none:Region:nk]`,
      Measure: `[${DS}].[sum:Sales:qk]`,
      Facet: `[${DS}].[none:Category:nk]`,
    };
    const out = apply(rankingXml, faceted, DS);

    it('lands the facet pill on <rows> AHEAD of the ranked category pill (exact render shape)', () => {
      expect(out).toContain(`<rows>[${DS}].[none:Category:nk] / [${DS}].[none:Region:nk]</rows>`);
    });

    it('leaves <cols> (the measure shelf) untouched', () => {
      expect(out).toContain(`<cols>[${DS}].[sum:Sales:qk]</cols>`);
    });

    it('adds the matching facet column-instance declaration (mapped to the bound field)', () => {
      expect(out).toMatch(
        /<column-instance[^>]*column="\[Category\]"[^>]*name="\[none:Category:nk\]"/,
      );
    });

    it('leaves ZERO Facet residue and stays well-formed (whole-template zero-residue)', () => {
      expect(out).not.toMatch(/\[Facet\]|:Facet:/);
      expect(out).not.toContain('{{DATASOURCE}}');
      const titled = out.replace(/\{\{TITLE\}\}/g, 'Test');
      expect(wellFormedXmlRule.validate(titled)).toEqual([]);
    });
  });

  // ── un-faceted apply is byte-identical to today (pin) ─────────────────────
  describe('un-faceted apply — byte-identity pin', () => {
    it('trend-line-chart: shelves carry exactly the two required pills, no facet', () => {
      const out = apply(
        trendXml,
        { 'Order Date': `[${DS}].[tmn:Order Date:qk]`, Sales: `[${DS}].[sum:Sales:qk]` },
        DS,
      );
      expect(out).toContain(`<cols>[${DS}].[tmn:Order Date:qk]</cols>`);
      expect(out).toContain(`<rows>[${DS}].[sum:Sales:qk]</rows>`);
      expect(out).not.toMatch(/:Facet:/);
      // No trellis separator was introduced on either shelf.
      expect(out).not.toContain(' / ');
    });

    it('ranking-ordered-bar: shelves carry exactly the two required pills, no facet', () => {
      const out = apply(
        rankingXml,
        { Category: `[${DS}].[none:Region:nk]`, Measure: `[${DS}].[sum:Sales:qk]` },
        DS,
      );
      expect(out).toContain(`<rows>[${DS}].[none:Region:nk]</rows>`);
      expect(out).toContain(`<cols>[${DS}].[sum:Sales:qk]</cols>`);
      expect(out).not.toMatch(/:Facet:/);
      expect(out).not.toContain(' / ');
    });
  });

  // ── box-plot idempotency: an already-wired facet is not double-spliced ─────
  describe('box-plot-chart — already-on-shelf facet is not duplicated', () => {
    it('produces exactly ONE facet pill on <cols> (no ` / ` doubling)', () => {
      const out = apply(
        boxPlotXml,
        {
          Measure: `[${DS}].[sum:Sales:qk]`,
          Level: `[${DS}].[none:Order ID:nk]`,
          Facet: `[${DS}].[none:Region:nk]`,
        },
        DS,
      );
      expect(out).toContain(`<cols>[${DS}].[none:Region:nk]</cols>`);
      const cols = out.match(/<cols>([\s\S]*?)<\/cols>/)![1];
      expect(cols).not.toContain(' / ');
    });
  });

  // ── product path: the runtime trend-line-chart snapshot ────────────────────
  describe('product path — runtime trend-line-chart snapshot', () => {
    const mapping = Object.fromEntries(
      runtimeTrend.descriptor.slots.map((slot, index) => {
        const field =
          slot.kind === 'temporal'
            ? 'Order Date'
            : slot.kind === 'quantitative'
              ? 'Sales'
              : `Series ${index}`;
        const role = slot.kind === 'categorical' || slot.kind === 'geo' ? 'nk' : 'qk';
        return [slot.template_field, `[${DS}].[${slot.derivation}:${field}:${role}]`];
      }),
    );

    it('treats the TBM-derived slot set as authoritative and does not invent a facet', () => {
      expect(spliceBoundFacet(runtimeTrend.xml, mapping, runtimeTrend.descriptor.slots)).toBe(
        runtimeTrend.xml,
      );
    });

    it('rewrites the TBM-derived XML with its paired descriptor without placeholder residue', () => {
      const out = rewriteFieldReferences(runtimeTrend.xml, mapping, DS, undefined, {
        templateSlots: runtimeTrend.descriptor.slots,
      });
      expect(out).not.toMatch(/\{\{field_base_\d+\}\}/);
      expect(wellFormedXmlRule.validate(out.replace(/\{\{TITLE\}\}/g, 'Trend'))).toEqual([]);
    });
  });
});
