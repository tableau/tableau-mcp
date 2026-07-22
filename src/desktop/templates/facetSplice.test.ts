import { readFileSync } from 'fs';
import { join } from 'path';

import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { spliceBoundFacet } from './facetSplice.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { getTemplatePath } from './templatePath.js';

// W28-C — apply-path facet splice ported from a2td (server/tools/facet-splice.test.ts):
// a BOUND optional facet slot must RENDER (land a pill on the trellis shelf), while
// every un-faceted apply stays byte-identical.
//
// tmcp adaptation notes (behavior parity with a2td is the goal):
//   - a2td's single `replaceFieldReferences` chokepoint was deleted in tmcp; each apply
//     path (inject-template, build-and-apply-worksheet) now composes the splice with the
//     frozen core inline. `apply()` below reproduces that exact two-stage pipeline
//     (splice BEFORE rewrite) so the integration pins run the shipped composition.
//   - The facet-armed shipped XML lives in the binder's reference library
//     (src/desktop/data/data-visualization-templates-xml, = TEMPLATE_XML_DIR), armed by
//     W27-B; read from there (a2td read the same-named dir).
//   - a2td's validateXmlWellFormed(x).valid === true maps to
//     wellFormedXmlRule.validate(x).length === 0.

const XML_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'data-visualization-templates-xml');
const read = (name: string): string => readFileSync(join(XML_DIR, `${name}.xml`), 'utf-8');

// The apply tools resolve template XML via getTemplatePath → getTemplatesDir, which honors
// the TEMPLATES_DIR override. Under vitest getDirname()/DATA_ROOT does NOT resolve to the
// source tree (see src/testSetup.ts), so point TEMPLATES_DIR at the committed apply-copy dir
// and load through the SAME getTemplatePath the tools call — exercising the real loader on the
// real shipped file, not a fixture and not the reference library above.
process.env['TEMPLATES_DIR'] = join(process.cwd(), 'src', 'desktop', 'data', 'templates');

const trendXml = read('trend-line-chart');
const rankingXml = read('ranking-ordered-bar');
const boxPlotXml = read('box-plot-chart');

const DS = 'Superstore';

/**
 * Reproduce the shipped apply pipeline: splice a bound facet onto the shelf, then run
 * the frozen field-reference rewrite — identical to what each chokepoint executes.
 */
const apply = (xml: string, mapping: Record<string, string>, ds: string): string =>
  rewriteFieldReferences(spliceBoundFacet(xml, mapping), mapping, ds);

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

  // ── product path: the SHIPPED trend-line-chart XML (W28-C step 4) ──────────
  describe('product path — SHIPPED trend-line-chart XML', () => {
    it('a bound facet lands on <cols> ahead of the date pill (shipped XML renders the facet)', () => {
      const out = apply(
        trendXml,
        {
          'Order Date': `[${DS}].[tmn:Order Date:qk]`,
          Sales: `[${DS}].[sum:Sales:qk]`,
          Facet: `[${DS}].[none:Region:nk]`,
        },
        DS,
      );
      expect(out).toContain(`<cols>[${DS}].[none:Region:nk] / [${DS}].[tmn:Order Date:qk]</cols>`);
    });

    it('an un-faceted apply of the same shipped template is byte-identical to pre-change (core alone)', () => {
      const mapping = {
        'Order Date': `[${DS}].[tmn:Order Date:qk]`,
        Sales: `[${DS}].[sum:Sales:qk]`,
      };
      // Splicing then rewriting an un-faceted apply must equal rewriting WITHOUT the
      // splice — the glue adds zero bytes when nothing is faceted.
      expect(apply(trendXml, mapping, DS)).toBe(rewriteFieldReferences(trendXml, mapping, DS));
    });
  });

  // ── END-TO-END product apply-path: the REAL apply copies the TOOLS load ────
  // The blocks above read the binder's reference library (TEMPLATE_XML_DIR =
  // data-visualization-templates-xml). But inject-template and build-and-apply-worksheet
  // load a SEPARATE copy set — src/desktop/data/templates/*.xml — via getTemplatePath →
  // getTemplatesDir → DATA_ROOT/templates. That is the only XML the apply chokepoints ever
  // splice+rewrite, so it is the only place a bound facet actually renders in the product.
  // W29-C arms those apply copies with the [Facet] base column; this suite pins the
  // end-to-end render through the SAME loader path the tools use (not a fixture, not the
  // reference dir), for BOTH facet templates, plus the un-faceted identity-by-reference pin.
  describe('product apply-path — REAL apply copies loaded via getTemplatePath', () => {
    // Same loader the tools call: readFileSync(getTemplatePath(name)).
    const readApplyCopy = (name: string): string => readFileSync(getTemplatePath(name), 'utf-8');
    const trendApplyXml = readApplyCopy('trend-line-chart');
    const rankingApplyXml = readApplyCopy('ranking-ordered-bar');

    describe('trend-line-chart apply copy — facet_col (cols shelf)', () => {
      const faceted = {
        'Order Date': `[${DS}].[tmn:Order Date:qk]`,
        Sales: `[${DS}].[sum:Sales:qk]`,
        Facet: `[${DS}].[none:Region:nk]`,
      };

      it('lands the facet pill on <cols> ahead of the date pill (renders in the shipped apply XML)', () => {
        const out = apply(trendApplyXml, faceted, DS);
        expect(out).toContain(
          `<cols>[${DS}].[none:Region:nk] / [${DS}].[tmn:Order Date:qk]</cols>`,
        );
      });

      it('adds the facet column-instance declaration mapped to the bound field and leaves <rows> untouched', () => {
        const out = apply(trendApplyXml, faceted, DS);
        expect(out).toMatch(
          /<column-instance[^>]*column="\[Region\]"[^>]*name="\[none:Region:nk\]"/,
        );
        expect(out).toContain(`<rows>[${DS}].[sum:Sales:qk]</rows>`);
      });
    });

    describe('ranking-ordered-bar apply copy — facet_row (rows shelf)', () => {
      const faceted = {
        Category: `[${DS}].[none:Region:nk]`,
        Measure: `[${DS}].[sum:Sales:qk]`,
        Facet: `[${DS}].[none:Category:nk]`,
      };

      it('lands the facet pill on <rows> ahead of the ranked category pill (renders in the shipped apply XML)', () => {
        const out = apply(rankingApplyXml, faceted, DS);
        expect(out).toContain(`<rows>[${DS}].[none:Category:nk] / [${DS}].[none:Region:nk]</rows>`);
      });

      it('adds the facet column-instance declaration mapped to the bound field and leaves <cols> untouched', () => {
        const out = apply(rankingApplyXml, faceted, DS);
        expect(out).toMatch(
          /<column-instance[^>]*column="\[Category\]"[^>]*name="\[none:Category:nk\]"/,
        );
        expect(out).toContain(`<cols>[${DS}].[sum:Sales:qk]</cols>`);
      });
    });

    describe('un-faceted apply of the REAL apply copies stays identity-by-reference (unarmed behavior)', () => {
      it('trend-line-chart: no facet → splice returns the SAME reference; apply == core alone', () => {
        const mapping = {
          'Order Date': `[${DS}].[tmn:Order Date:qk]`,
          Sales: `[${DS}].[sum:Sales:qk]`,
        };
        expect(spliceBoundFacet(trendApplyXml, mapping)).toBe(trendApplyXml);
        expect(apply(trendApplyXml, mapping, DS)).toBe(
          rewriteFieldReferences(trendApplyXml, mapping, DS),
        );
      });

      it('ranking-ordered-bar: no facet → splice returns the SAME reference; apply == core alone', () => {
        const mapping = {
          Category: `[${DS}].[none:Region:nk]`,
          Measure: `[${DS}].[sum:Sales:qk]`,
        };
        expect(spliceBoundFacet(rankingApplyXml, mapping)).toBe(rankingApplyXml);
        expect(apply(rankingApplyXml, mapping, DS)).toBe(
          rewriteFieldReferences(rankingApplyXml, mapping, DS),
        );
      });
    });
  });
});
