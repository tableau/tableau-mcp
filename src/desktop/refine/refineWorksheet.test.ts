import { ensureUserNamespace } from '../templates/injectTemplateCore.js';
import { runValidation } from '../validation/registry.js';
import { parseXml } from '../validation/rules/parseXml.js';
import {
  confirmSortDirectionApplied,
  confirmTopNApplied,
  planSortDirection,
  planTopN,
} from './refineWorksheet.js';

// A single-worksheet fragment shaped exactly like `tabui:save-worksheet` returns:
// one nominal dimension CI (Region) + one measure CI (SUM Sales), a safe self-closing
// <computed-sort>, and <aggregation> — the ranking-ordered-bar envelope.
const BASE = `<worksheet name='Sales by Region' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources>
        <datasource caption='Superstore' name='Superstore' />
      </datasources>
      <datasource-dependencies datasource='Superstore'>
        <column datatype='string' name='[Region]' role='dimension' type='nominal' />
        <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
        <column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />
        <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>
      <computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />
      <aggregation value='true' />
    </view>
    <style />
    <panes>
      <pane>
        <view><breakdown value='auto' /></view>
        <mark class='Bar' />
      </pane>
    </panes>
    <rows>[Superstore].[none:Region:nk]</rows>
    <cols>[Superstore].[sum:Sales:qk]</cols>
  </table>
  <simple-id uuid='00000000-0000-0000-0000-000000000001' />
</worksheet>`;

/** Replace the datasource-dependencies block body with custom columns/CIs. */
function withDeps(depBody: string): string {
  return BASE.replace(
    /<datasource-dependencies datasource='Superstore'>[\s\S]*?<\/datasource-dependencies>/,
    `<datasource-dependencies datasource='Superstore'>${depBody}</datasource-dependencies>`,
  );
}

const REGION_COL = "<column datatype='string' name='[Region]' role='dimension' type='nominal' />";
const SALES_COL = "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />";
const REGION_CI =
  "<column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />";
const SALES_CI =
  "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />";

describe('planTopN — happy path', () => {
  it('inserts a function=end top filter and a slices entry before aggregation', () => {
    const r = planTopN(BASE, { n: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filterColumn).toBe('[Superstore].[none:Region:nk]');

    // The Top-N filter, with the confirmed native attributes.
    expect(r.xml).toContain("<filter class='categorical' column='[Superstore].[none:Region:nk]'>");
    expect(r.xml).toMatch(/function='end'\s+end='top'\s+count='5'/);
    expect(r.xml).toContain("function='order' direction='DESC' expression='SUM([Sales])'");
    expect(r.xml).toContain(
      "function='level-members' level='[none:Region:nk]' user:ui-enumeration='all'",
    );

    // A slices node listing the filtered CI was created.
    expect(r.xml).toContain('<slices><column>[Superstore].[none:Region:nk]</column></slices>');

    // Ordering invariant: filter + slices both precede <aggregation>.
    const filterIdx = r.xml.indexOf('<filter');
    const slicesIdx = r.xml.indexOf('<slices>');
    const aggIdx = r.xml.indexOf('<aggregation');
    expect(filterIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeLessThan(slicesIdx);
    expect(slicesIdx).toBeLessThan(aggIdx);
    // Filter is placed after the datasource-dependencies anchor.
    expect(filterIdx).toBeGreaterThan(r.xml.indexOf('</datasource-dependencies>'));
  });

  it('emits end=bottom direction=ASC for a bottom-N ask', () => {
    const r = planTopN(BASE, { n: 3, end: 'bottom' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toMatch(/function='end'\s+end='bottom'\s+count='3'/);
    expect(r.xml).toContain("function='order' direction='ASC'");
  });
});

describe('planTopN — kill criteria (refuse with message)', () => {
  it('refuses n below 1', () => {
    const r = planTopN(BASE, { n: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/between 1 and 50/);
  });

  it('refuses n above 50', () => {
    const r = planTopN(BASE, { n: 51 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/between 1 and 50/);
  });

  it('refuses a non-integer n', () => {
    const r = planTopN(BASE, { n: 2.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/between 1 and 50/);
  });

  it('refuses a missing n', () => {
    const r = planTopN(BASE, { n: undefined as unknown as number });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/between 1 and 50/);
  });

  it('refuses when more than one categorical dimension is present', () => {
    const xml = withDeps(
      REGION_COL +
        "<column datatype='string' name='[Category]' role='dimension' type='nominal' />" +
        SALES_COL +
        REGION_CI +
        "<column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />" +
        SALES_CI,
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/more than one categorical dimension/i);
  });

  it('refuses when more than one measure is present', () => {
    const xml = withDeps(
      REGION_COL +
        SALES_COL +
        "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
        REGION_CI +
        SALES_CI +
        "<column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' pivot='key' type='quantitative' />",
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/more than one measure/i);
  });

  it('refuses when no categorical dimension can be identified', () => {
    const xml = withDeps(SALES_COL + SALES_CI);
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/single categorical dimension/i);
  });

  it('refuses when no measure can be identified', () => {
    const xml = withDeps(REGION_COL + REGION_CI);
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/single measure/i);
  });

  it('refuses when the worksheet uses a calculated field', () => {
    const xml = withDeps(
      REGION_COL +
        SALES_COL +
        REGION_CI +
        SALES_CI +
        "<column-instance column='[Calculation_1]' derivation='User' name='[usr:Calculation_1:qk]' pivot='key' type='quantitative' />",
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/calculated field/i);
  });

  it('refuses when the worksheet uses a set/group', () => {
    const xml = BASE.replace(
      '</datasource-dependencies>',
      "</datasource-dependencies>\n      <group name='[Top Regions]' name-style='unqualified'><groupfilter function='member' level='[none:Region:nk]' member='East' /></group>",
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/set\/group/i);
  });

  it('refuses when the worksheet references a parameter', () => {
    const xml = withDeps(
      REGION_COL +
        SALES_COL +
        "<column datatype='integer' name='[Top N]' param-domain-type='range' role='measure' type='quantitative' value='5' />" +
        REGION_CI +
        SALES_CI,
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/parameter/i);
  });

  it('refuses when a Top-N (function=end) filter already exists', () => {
    const existing =
      "</datasource-dependencies>\n      <filter class='categorical' column='[Superstore].[none:Region:nk]'>" +
      "<groupfilter function='end' end='top' count='10'><groupfilter function='order' direction='DESC' expression='SUM([Sales])'>" +
      "<groupfilter function='level-members' level='[none:Region:nk]' user:ui-enumeration='all' /></groupfilter></groupfilter></filter>";
    const xml = BASE.replace('</datasource-dependencies>', existing);
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/already exists/i);
  });

  it('refuses when there is no datasource-dependencies anchor', () => {
    // CIs present (so dim/measure are unambiguous) but the block is self-closing, so
    // there is no </datasource-dependencies> to anchor the filter insertion against.
    const xml = BASE.replace(
      /<datasource-dependencies datasource='Superstore'>[\s\S]*?<\/datasource-dependencies>/,
      `<datasource-dependencies datasource='Superstore' />\n      ${REGION_CI}\n      ${SALES_CI}`,
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/anchor/i);
  });
});

describe('planTopN — security (hostile derived values are escaped, not injected)', () => {
  it('escapes a datasource name containing XML metacharacters at insertion', () => {
    // A hostile datasource name carrying `& < >` — chars that WOULD break out of the
    // column='...' attribute (or open a bogus element) if the derived filterColumn were
    // string-built verbatim. Only the dependencies' datasource is changed; the CIs stay
    // unambiguous so the plan still succeeds.
    const xml = BASE.replace(
      "datasource-dependencies datasource='Superstore'",
      "datasource-dependencies datasource='Ev&il<x>'",
    );
    const r = planTopN(xml, { n: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The raw filterColumn is returned unescaped (used for the readback xpath) ...
    expect(r.filterColumn).toBe('[Ev&il<x>].[none:Region:nk]');
    // ... but the spliced attribute value is fully entity-escaped — no raw `& < >`.
    expect(r.xml).toContain("column='[Ev&amp;il&lt;x&gt;].[none:Region:nk]'");
    expect(r.xml).not.toContain("column='[Ev&il<x>]");
  });
});

describe('confirmTopNApplied', () => {
  it('is true for a patch that landed and false for the un-patched source', () => {
    const r = planTopN(BASE, { n: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(confirmTopNApplied(r.xml, r.filterColumn)).toBe(true);
    expect(confirmTopNApplied(BASE, r.filterColumn)).toBe(false);
  });

  it("neither throws nor false-positives on a column ref containing a quote ([none:O'Brien:nk])", () => {
    const quoted = "[none:O'Brien:nk]";
    const withFilter = `<worksheet name='q' xmlns:user='http://www.tableausoftware.com/xml/user'>
      <table><view>
        <filter class='categorical' column="${quoted}"><groupfilter function='end' /></filter>
      </view></table>
    </worksheet>`;
    expect(confirmTopNApplied(withFilter, quoted)).toBe(true);
    expect(confirmTopNApplied(withFilter, '[none:Other:nk]')).toBe(false);
    // The injection shape: a value engineered to alter an interpolated XPath
    // predicate must simply not match (it is compared as a plain string).
    expect(confirmTopNApplied(withFilter, "x' or @column!='")).toBe(false);
  });
});

describe('planSortDirection', () => {
  it('flips DESC to ASC on the single self-closing computed-sort', () => {
    const r = planSortDirection(BASE, { direction: 'ASC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.column).toBe('[Superstore].[none:Region:nk]');
    expect(r.xml).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='ASC' using='[Superstore].[sum:Sales:qk]' />",
    );
    expect(r.xml).not.toContain("direction='DESC'");
  });

  it('flips ASC to DESC', () => {
    const asc = BASE.replace("direction='DESC'", "direction='ASC'");
    const r = planSortDirection(asc, { direction: 'DESC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain("direction='DESC'");
    expect(r.xml).not.toContain("direction='ASC'");
  });

  it('refuses an invalid direction', () => {
    const r = planSortDirection(BASE, { direction: 'SIDEWAYS' as unknown as 'ASC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/ASC.*DESC/);
  });

  it('refuses when no computed-sort is present on a shape richer than a simple bar', () => {
    // This assertion previously used BASE-minus-sort (a single-dim/single-measure bar) to
    // prove the historic "refuse when unsorted" limitation. That exact shape is now the
    // ADD-a-sort case (covered below), so it can no longer refuse. The no-sort refusal is
    // still correct — and still exercised here — for any shape richer than the simple bar
    // (two categorical dimensions), where we never guess a sort.
    const xml = withDeps(
      REGION_COL +
        "<column datatype='string' name='[Category]' role='dimension' type='nominal' />" +
        SALES_COL +
        REGION_CI +
        "<column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />" +
        SALES_CI,
    ).replace(/<computed-sort[^>]*\/>/, '');
    const r = planSortDirection(xml, { direction: 'ASC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses when more than one computed-sort is present', () => {
    const xml = BASE.replace(
      "<aggregation value='true' />",
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='ASC' using='[Superstore].[sum:Sales:qk]' />\n      <aggregation value='true' />",
    );
    const r = planSortDirection(xml, { direction: 'ASC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/more than one <computed-sort>/i);
  });

  it('refuses the nested <sort class=computed-sort> crash form', () => {
    const nested = BASE.replace(
      /<computed-sort[^>]*\/>/,
      "<sort class='computed-sort' column='[Superstore].[none:Region:nk]' direction='DESC'><sort-computation direction='DESC' field='[Superstore].[sum:Sales:qk]' /></sort>",
    );
    const r = planSortDirection(nested, { direction: 'ASC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/nested/i);
  });
});

describe('planSortDirection — INSERT a sort on an unsorted simple bar', () => {
  // The unsorted single-dim/single-measure bar: BASE with its <computed-sort> removed —
  // the exact shape magnitude-simple-bar.xml ships, minus the sort node.
  const UNSORTED = BASE.replace(/<computed-sort[^>]*\/>/, '');

  it('inserts a safe self-closing computed-sort (desc) with template placement/attributes', () => {
    const r = planSortDirection(UNSORTED, { direction: 'DESC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.column).toBe('[Superstore].[none:Region:nk]');
    expect(r.direction).toBe('DESC');

    // Mirrors magnitude-simple-bar.xml:24 exactly (column = dim CI, using = measure CI).
    expect(r.xml).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />",
    );
    // Exactly one sort node (no accidental duplicate) and the XML still parses.
    expect([...r.xml.matchAll(/<computed-sort\b/g)]).toHaveLength(1);
    expect(parseXml(r.xml)?.documentElement).toBeTruthy();

    // Placed after the dependencies anchor and before <aggregation> (template ordering).
    const sortIdx = r.xml.indexOf('<computed-sort');
    expect(sortIdx).toBeGreaterThan(r.xml.indexOf('</datasource-dependencies>'));
    expect(sortIdx).toBeLessThan(r.xml.indexOf('<aggregation'));
  });

  it('honors the requested direction on insert (ASC)', () => {
    const r = planSortDirection(UNSORTED, { direction: 'ASC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xml).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='ASC' using='[Superstore].[sum:Sales:qk]' />",
    );
  });

  it('round-trip: the inserted node passes the SAME preflight validation the apply path runs', () => {
    const r = planSortDirection(UNSORTED, { direction: 'DESC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Mirror refineWorksheet.ts: ensureUserNamespace(patched) → runValidation(_, 'worksheet').
    const result = runValidation(ensureUserNamespace(r.xml), 'worksheet');
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    // Specifically NOT the crashing nested form.
    expect(result.issues.some((i) => i.ruleId === 'computed-sort-crash')).toBe(false);
    // And the inserted sort is confirmable by the same readback check the tool uses.
    expect(confirmSortDirectionApplied(r.xml, r.column, 'DESC')).toBe(true);
  });
});

describe('planSortDirection — INSERT refusals (richer shapes keep the no-sort refusal)', () => {
  const stripSort = (xml: string): string => xml.replace(/<computed-sort[^>]*\/>/, '');

  it('refuses to insert when a second measure makes the ranking key ambiguous', () => {
    const xml = stripSort(
      withDeps(
        REGION_COL +
          SALES_COL +
          "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />" +
          REGION_CI +
          SALES_CI +
          "<column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' pivot='key' type='quantitative' />",
      ),
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when the sheet uses a calculated field', () => {
    const xml = stripSort(
      withDeps(
        REGION_COL +
          SALES_COL +
          REGION_CI +
          "<column-instance column='[Calculation_1]' derivation='User' name='[usr:Calculation_1:qk]' pivot='key' type='quantitative' />",
      ),
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when a table calc is present', () => {
    // Still one dim + one measure CI (derivation Sum), but the measure carries a
    // <table-calc> child → out of the simple-bar envelope; the guard keeps the refusal.
    const xml = stripSort(BASE).replace(
      SALES_CI,
      "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative'><table-calc ordering-type='Rows' /></column-instance>",
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert on a dual-axis / multi-pane sheet', () => {
    const xml = stripSort(BASE).replace(
      '</panes>',
      "  <pane><view><breakdown value='auto' /></view><mark class='Line' /></pane>\n    </panes>",
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when the dimension is not bound to a shelf (sort would dangle)', () => {
    // 1 dim + 1 measure, but the dimension pill is not on rows/cols → the computed-sort
    // would couple to a pill that isn't placed; keep the refusal rather than guess.
    const xml = stripSort(BASE).replace('<rows>[Superstore].[none:Region:nk]</rows>', '<rows />');
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when the same dimension is bound to BOTH shelves (P1c)', () => {
    // rows AND cols both carry the dimension CI, so this is not the verified simple-bar
    // shape (dim on exactly one shelf, measure on the other). The old `includes` check
    // over the concatenated shelves would pass; the per-shelf binding must refuse.
    const xml = stripSort(BASE).replace(
      '<cols>[Superstore].[sum:Sales:qk]</cols>',
      '<cols>[Superstore].[none:Region:nk] / [Superstore].[sum:Sales:qk]</cols>',
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when more than one datasource-dependencies block is present (P1b)', () => {
    // A second dependency block (column metadata only) leaves the primary Region/Sales
    // CIs unambiguous, but insertion would land between the two blocks — refuse unless
    // there is EXACTLY one dependency block.
    const xml = stripSort(BASE).replace(
      '</datasource-dependencies>',
      "</datasource-dependencies>\n      <datasource-dependencies datasource='Superstore'>" +
        "<column datatype='string' name='[Segment]' role='dimension' type='nominal' /></datasource-dependencies>",
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it('refuses to insert when the datasource name carries XML-special characters (P1a)', () => {
    // A datasource whose name contains an apostrophe/ampersand would be interpolated raw
    // into single-quoted attributes → malformed XML. The shelves here reference the same
    // name (double-quoted, apostrophe-safe source) so shelf-binding passes and the ONLY
    // reason to refuse is the unescaped special char in the built column/using values.
    const xml = stripSort(BASE)
      .replace(
        "<datasource-dependencies datasource='Superstore'>",
        '<datasource-dependencies datasource="Bob\'s &amp; Sons">',
      )
      .replaceAll('[Superstore].', "[Bob's &amp; Sons].");
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });

  it("refuses to insert when the only 'dimension' is the Measure Names pseudo-field (P2)", () => {
    // Measure Names ([:Measure Names], nominal/None) matches the dimension pattern but is
    // an internal pseudo-CI, not a real categorical dimension — exclude it so the sheet
    // has no dimension to order and the insert refuses.
    const xml = stripSort(
      withDeps(
        "<column datatype='string' name='[:Measure Names]' role='dimension' type='nominal' />" +
          SALES_COL +
          "<column-instance column='[:Measure Names]' derivation='None' name='[none:Measure Names:nk]' pivot='key' type='nominal' />" +
          SALES_CI,
      ),
    ).replace(
      '<rows>[Superstore].[none:Region:nk]</rows>',
      '<rows>[Superstore].[none:Measure Names:nk]</rows>',
    );
    const r = planSortDirection(xml, { direction: 'DESC' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no <computed-sort>/i);
  });
});

describe('confirmSortDirectionApplied', () => {
  it('confirms the flipped direction on readback and rejects the stale one', () => {
    const r = planSortDirection(BASE, { direction: 'ASC' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(confirmSortDirectionApplied(r.xml, r.column, 'ASC')).toBe(true);
    expect(confirmSortDirectionApplied(BASE, r.column, 'ASC')).toBe(false);
  });

  it('neither throws nor false-positives on a column ref containing a quote', () => {
    const quoted = "[sum:O'Brien Sales:qk]";
    const withSort = `<worksheet name='q' xmlns:user='http://www.tableausoftware.com/xml/user'>
      <table><view>
        <computed-sort column="${quoted}" direction='ASC' />
      </view></table>
    </worksheet>`;
    expect(confirmSortDirectionApplied(withSort, quoted, 'ASC')).toBe(true);
    expect(confirmSortDirectionApplied(withSort, quoted, 'DESC')).toBe(false);
    expect(confirmSortDirectionApplied(withSort, "x' or @column!='", 'ASC')).toBe(false);
  });
});
