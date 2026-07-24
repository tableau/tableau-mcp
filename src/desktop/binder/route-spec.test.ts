// src/desktop/binder/route-spec.test.ts
//
// The route layer's typed registry. Pins the ask-shape → route table and that bind-first
// classification defers to the binder's OWN model-free matcher (selectEligible) + the
// eligibility stamp — never a re-derived classifier. Refine-asks classify into the taxonomy;
// only supported refine shapes (top-N / sort) route refine-op.

import { beforeAll, describe, expect, it } from 'vitest';

import { selectEligible } from './ask-router.js';
import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';
import {
  classifyAskRoute,
  detectCalcFirst,
  normalizeAskForMatch,
  REFINE_SHAPES,
  SHAPE_ROUTE,
} from './route-spec.js';

let manifests: TemplateManifest[];
beforeAll(() => {
  manifests = [...loadManifests().values()];
});

function mkManifest(over: Partial<TemplateManifest> & { template: string }): TemplateManifest {
  return {
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    intent_keywords: [],
    description: 'synthetic test manifest',
    placeholders: ['TITLE', 'DATASOURCE'],
    slots: [],
    calcs: [],
    ...over,
  } as unknown as TemplateManifest;
}

describe('SHAPE_ROUTE — the typed ask-shape → route table', () => {
  it('maps every shape to a valid route class', () => {
    for (const r of new Set(Object.values(SHAPE_ROUTE))) {
      expect(['bind-first', 'scratch-pipeline', 'refine-op', 'free']).toContain(r);
    }
  });

  it('routes hazards to scratch-pipeline, selected refines to refine-op, deferred refines to free', () => {
    expect(SHAPE_ROUTE['hazard-set']).toBe('scratch-pipeline');
    expect(SHAPE_ROUTE['hazard-drilldown']).toBe('scratch-pipeline');
    expect(SHAPE_ROUTE['refine-top-n']).toBe('refine-op');
    expect(SHAPE_ROUTE['refine-sort']).toBe('refine-op');
    expect(SHAPE_ROUTE['refine-filter']).toBe('free');
    expect(SHAPE_ROUTE['refine-period']).toBe('free');
    expect(SHAPE_ROUTE['refine-encoding']).toBe('free');
    expect(SHAPE_ROUTE['calc-then-bind']).toBe('free');
    expect(SHAPE_ROUTE['bind-first-template']).toBe('bind-first');
  });
});

describe('detectCalcFirst — noun-less derived metrics only', () => {
  it.each(['Show me gross margin %', 'gross margin', 'sales per employee'])(
    'detects "%s" as calc-first',
    (ask) => {
      expect(detectCalcFirst(ask)).toBe(true);
    },
  );

  it.each(['bar chart of sales', 'bar chart of margin', 'revenue by region'])(
    'does not detect "%s" as calc-first',
    (ask) => {
      expect(detectCalcFirst(ask)).toBe(false);
    },
  );
});

describe('classifyAskRoute — calc-first derived metrics', () => {
  it('routes a noun-less gross-margin ask to calc-then-bind', () => {
    const d = classifyAskRoute('Show me gross margin %', manifests);
    expect(d).toMatchObject({
      route: 'free',
      shape: 'calc-then-bind',
      template: null,
      reason: 'calc-first ask (author-calc before bind)',
    });
  });

  it('does not route a plain measure-by-dimension ask calc-first', () => {
    expect(classifyAskRoute('revenue by region', manifests).shape).not.toBe('calc-then-bind');
  });
});

describe('classifyAskRoute — bind-first (plain chart with eligible supply)', () => {
  it('routes a plain bar ask to bind-first, naming the eligible template', () => {
    const d = classifyAskRoute('bar chart of Sales by Region', manifests);
    expect(d.route).toBe('bind-first');
    expect(d.shape).toBe('bind-first-template');
    expect(d.template).toBe('ranking-ordered-bar');
  });

  it('bind-first ONLY when the matched template supply is stamped/eligible', () => {
    const ask = 'frobnicate chart of things';
    const eligible = mkManifest({ template: 'frob-chart', intent_keywords: ['frobnicate'] });
    const notEligible = mkManifest({
      template: 'frob-chart',
      intent_keywords: ['frobnicate'],
      fast_path_eligible: false,
    });
    expect(classifyAskRoute(ask, [eligible]).route).toBe('bind-first');
    expect(classifyAskRoute(ask, [notEligible]).route).toBe('free');
  });

  it('classification uses the binder matcher: a shape the matcher rejects can never be bind-first', () => {
    const gibberish = 'asdf qwerty zxcv plok';
    expect(selectEligible(gibberish, manifests)).toBeNull();
    expect(classifyAskRoute(gibberish, manifests).route).toBe('free');
  });
});

describe('classifyAskRoute — hazard shapes → scratch-pipeline', () => {
  it("routes a 'create a set' ask to scratch-pipeline", () => {
    const d = classifyAskRoute('create a set of my top customers', manifests);
    expect(d.route).toBe('scratch-pipeline');
    expect(d.shape).toBe('hazard-set');
  });

  it('routes a drilldown ask to scratch-pipeline', () => {
    const d = classifyAskRoute('drill down into Sub-Category by Sales', manifests);
    expect(d.route).toBe('scratch-pipeline');
    expect(d.shape).toBe('hazard-drilldown');
  });
});

describe('classifyAskRoute — refine-asks classify into taxonomy with selected routes', () => {
  it("'top five X' → refine-top-n taxonomy, route refine-op", () => {
    const d = classifyAskRoute('top five customers by sales', manifests);
    expect(d.shape).toBe('refine-top-n');
    expect(d.route).toBe('refine-op');
    expect(REFINE_SHAPES.has(d.shape)).toBe(true);
  });

  it("'just Q4' → refine-period taxonomy, route free", () => {
    const d = classifyAskRoute('just Q4 numbers', manifests);
    expect(d.shape).toBe('refine-period');
    expect(d.route).toBe('free');
  });

  it("'sort by' → refine-sort taxonomy, route refine-op", () => {
    const d = classifyAskRoute('sort by profit descending', manifests);
    expect(d.shape).toBe('refine-sort');
    expect(d.route).toBe('refine-op');
  });

  it("'filter/only' → refine-filter taxonomy, route free", () => {
    const d = classifyAskRoute('filter to only the West region', manifests);
    expect(d.shape).toBe('refine-filter');
    expect(d.route).toBe('free');
  });
});

describe('classifyAskRoute — refine detection is EDIT-CONTEXT gated', () => {
  it('a NEW bar chart that only MENTIONS top/bottom classifies bind-first (NOT refine)', () => {
    // A new-viz ask that merely mentions top/bottom must fall through to the matcher.
    const ask =
      'Create a horizontal bar chart of total Profit by Sub-Category, calling out the ' +
      "few highest-profit Sub-Categories (the 'top performers') and the few lowest-profit ones " +
      "(the 'bottom performers'); do not replace or delete existing worksheets.";
    const d = classifyAskRoute(ask, manifests);
    expect(d.route, 'a new bar chart that only mentions top/bottom must route bind-first').toBe(
      'bind-first',
    );
    expect(d.shape).toBe('bind-first-template');
    expect(d.template).toBe('ranking-ordered-bar');
  });

  it('a reworded, keyword-bearing near-paraphrase still classifies bind-first', () => {
    const paraphrase =
      'Please build a sorted horizontal bar chart of Profit per Sub-Category, ranked from ' +
      'highest to lowest, with the top and bottom performers standing out as their own groups.';
    const d = classifyAskRoute(paraphrase, manifests);
    expect(d.route).toBe('bind-first');
    expect(d.template).toBe('ranking-ordered-bar');
  });

  it('messy punctuation / casing / spacing still classifies bind-first', () => {
    const messy = '  RANKED   BAR-CHART!!!  (highest → lowest)  of PROFIT — by sub-category…  ';
    expect(normalizeAskForMatch(messy)).toBe(
      'ranked bar-chart highest lowest of profit by sub-category',
    );
    expect(classifyAskRoute(messy, manifests).route).toBe('bind-first');
  });

  it("'just the top five sub-categories' (bare refine, no chart noun) classifies refine-top-n", () => {
    const d = classifyAskRoute('just the top five sub-categories', manifests);
    expect(d.shape).toBe('refine-top-n');
    expect(d.route).toBe('refine-op');
  });

  it("'show that as a line' (anaphoric re-encode) classifies refine-ish, never bind-first", () => {
    const d = classifyAskRoute('show that as a line', manifests);
    expect(REFINE_SHAPES.has(d.shape), `${d.shape} should be a refine shape`).toBe(true);
    expect(d.route).toBe('free');
    expect(d.route).not.toBe('bind-first');
  });

  it("a genuinely NEW 'top 10 reps by quota attainment bar chart' ask is NOT refine", () => {
    const d = classifyAskRoute('top 10 reps by quota attainment bar chart', manifests);
    expect(
      REFINE_SHAPES.has(d.shape),
      'a new-viz ask with bare top-N vocab must not be refine',
    ).toBe(false);
    expect(d.shape).not.toBe('refine-top-n');
  });

  // fix/repair and "current/this/that (work)sheet" wording must carry sheet EDIT context so
  // the ask is routed as an in-place refine, never as a new-viz build. These invariants pin
  // the hasEditContext behavior (verified return: refine-encoding / free) without over-fitting.
  it.each(['fix current sheet', 'repair that worksheet', 'show this worksheet as a line'])(
    '"%s" carries sheet edit context without becoming a new viz',
    (ask) => {
      const d = classifyAskRoute(ask, manifests);
      // It resolves to a REFINE shape (edit of an existing sheet) ...
      expect(REFINE_SHAPES.has(d.shape), `${d.shape} should be a refine shape`).toBe(true);
      // ... never a bind-first new-viz build.
      expect(d.route).not.toBe('bind-first');
      expect(d.shape).not.toBe('bind-first-template');
    },
  );

  it('does not classify data-source repair wording as a sheet edit', () => {
    const d = classifyAskRoute('fix the data source', manifests);
    // The NON_SHEET_FIX_RE guard keeps "fix the data source" out of the edit-context path:
    // it stays unmatched (NOT a refine shape), unlike the "fix current sheet" case above.
    expect(d.shape).toBe('unmatched');
    expect(d.route).toBe('free');
    expect(REFINE_SHAPES.has(d.shape)).toBe(false);
    expect(d.shape).not.toBe('refine-encoding');
  });
});

describe('classifyAskRoute — fail-open free', () => {
  it('an absent/blank ask routes free', () => {
    expect(classifyAskRoute(undefined, manifests).route).toBe('free');
    expect(classifyAskRoute(undefined, manifests).shape).toBe('empty');
    expect(classifyAskRoute('   ', manifests).route).toBe('free');
  });

  it('gibberish routes free (no template supply)', () => {
    const d = classifyAskRoute('asdf qwerty zxcv plok', manifests);
    expect(d.route).toBe('free');
    expect(d.shape).toBe('unmatched');
  });
});
