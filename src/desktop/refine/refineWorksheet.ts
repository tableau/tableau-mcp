/**
 * Pure worksheet-XML planners for the `refine-worksheet` desktop tool (refine fast lane).
 *
 * These functions are the ONLY place the tool decides WHAT to change. They take a single
 * fetched worksheet fragment (as `tabui:save-worksheet` / the External Client API sheet
 * slice returns it), plan a MINIMAL patch, and either return the patched XML or a precise
 * refusal. They do NO I/O — the tool wraps them with fetch -> preflight -> apply-once ->
 * readback.
 *
 * Two operations only:
 *   - top_n: insert a native `function="end"` top/bottom filter on the sheet's single
 *     unambiguous categorical dimension CI, keyed by its single measure CI, then
 *     create/extend <slices>.
 *   - sort_direction: flip `direction` on an existing single self-closing <computed-sort>.
 *     The nested <sort class="computed-sort"> form crashes Desktop and is refused.
 *
 * Refusal, not repair: anything outside this tiny envelope (ambiguous dims/measures, n
 * outside 1..50, sets/params/rollups/calcs, an existing Top-N, a nested/absent/multiple
 * computed-sort) returns `{ ok: false, reason }` so the caller can hand back to the
 * standard authoring path instead of entering whole-workbook XML surgery.
 *
 * Repo-agnostic by construction: this module imports only third-party XML libraries
 * (@xmldom/xmldom, xpath) — no tableau-mcp modules — so it is a byte-adoption candidate
 * for cross-repo lockstep. Derived values (field/CI names read out of the live, untrusted
 * worksheet XML) are XML-escaped before insertion; only closed enums and an integer count
 * ever reach an attribute unescaped.
 */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

export type TopNEnd = 'top' | 'bottom';
export type SortDirection = 'ASC' | 'DESC';

export interface TopNPlan {
  ok: true;
  xml: string;
  /** DS-qualified CI of the filtered dimension — the readback confirmation target. */
  filterColumn: string;
}
export interface SortPlan {
  ok: true;
  xml: string;
  /** The computed-sort `column` (may be "") — the readback confirmation target. */
  column: string;
  direction: SortDirection;
}
export interface RefineRefusal {
  ok: false;
  reason: string;
}

/** Canonical measure-aggregation derivation -> the aggregation function used in the Top-N `expression`. */
const AGG_DERIVATIONS: Record<string, string> = {
  Sum: 'SUM',
  Avg: 'AVG',
  Count: 'COUNT',
  CountD: 'COUNTD',
  Median: 'MEDIAN',
  Min: 'MIN',
  Max: 'MAX',
  Stdev: 'STDEV',
  StdevP: 'STDEVP',
  Var: 'VAR',
  VarP: 'VARP',
  Attribute: 'ATTR',
};

interface ColumnInstance {
  name: string;
  column: string;
  derivation: string;
  type: string;
}

const refuse = (reason: string): RefineRefusal => ({ ok: false, reason });

/**
 * Error-suppressing DOM parse. Malformed XML is surfaced by the apply path's preflight
 * validation, so here a parse failure simply yields `null` and the readback confirmation
 * fails safe (returns false -> refusal). The function-form `errorHandler` matches
 * @xmldom/xmldom >=0.9, which rejects the legacy object form.
 */
function parseXml(xml: string): Document | null {
  try {
    const parser = new DOMParser({ errorHandler: () => {} });
    const doc = parser.parseFromString(String(xml ?? '').trim(), 'text/xml') as unknown as Document;
    return doc ?? null;
  } catch {
    return null;
  }
}

/**
 * Escape a value derived from the (untrusted) worksheet XML before it is spliced back into
 * an attribute value or element text. For a normal Tableau qualified name (bracketed
 * identifier, no `& < > ' "`) this is the identity function, so patched XML is byte-stable;
 * a hostile name cannot break out of its attribute/text context.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

/** Read a single/double-quoted attribute value out of an element's attribute slice. */
function attrVal(attrs: string, key: string): string {
  const m = attrs.match(new RegExp(`\\b${key}=(?:'([^']*)'|"([^"]*)")`));
  return m ? (m[1] ?? m[2] ?? '') : '';
}

/** All `<column-instance>` declarations (open tag only — table-calc CIs may have children). */
function parseColumnInstances(xml: string): ColumnInstance[] {
  const out: ColumnInstance[] = [];
  const re = /<column-instance\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = attrVal(attrs, 'name');
    if (!name) continue;
    out.push({
      name,
      column: attrVal(attrs, 'column'),
      derivation: attrVal(attrs, 'derivation'),
      type: attrVal(attrs, 'type'),
    });
  }
  return out;
}

/** The datasource name — from the dependencies block, else the first <datasource>. */
function datasourceName(xml: string): string {
  const dep = xml.match(/<datasource-dependencies\b[^>]*\bdatasource=(?:'([^']*)'|"([^"]*)")/);
  if (dep) return dep[1] ?? dep[2] ?? '';
  const ds = xml.match(/<datasource\b[^>]*\bname=(?:'([^']*)'|"([^"]*)")/);
  return ds ? (ds[1] ?? ds[2] ?? '') : '';
}

/** A plain categorical dimension CI: nominal + None derivation (e.g. [none:Region:nk]). */
function isDimensionCi(ci: ColumnInstance): boolean {
  return ci.type === 'nominal' && ci.derivation === 'None';
}

/** A measure CI: quantitative with a canonical aggregation derivation (e.g. [sum:Sales:qk]). */
function isMeasureCi(ci: ColumnInstance): boolean {
  return (
    ci.type === 'quantitative' &&
    Object.prototype.hasOwnProperty.call(AGG_DERIVATIONS, ci.derivation)
  );
}

/**
 * Detect a construct that puts the sheet OUTSIDE the envelope. Returns a short kind
 * ("calc"|"set"|"param") or null. Order matters only for the message; all three refuse.
 */
function unsupportedConstruct(xml: string, cis: ColumnInstance[]): 'calc' | 'set' | 'param' | null {
  if (cis.some((c) => c.derivation === 'User') || /<calculation\b/.test(xml)) return 'calc';
  // `<group ` / `<group>` is a set/group; `<groupfilter` (no boundary) is NOT matched.
  if (/<group(\s|>)/.test(xml)) return 'set';
  if (/\[Parameters\]/.test(xml) || /\bparam-domain-type=/.test(xml)) return 'param';
  return null;
}

/** A Top-N filter is already present iff any groupfilter carries `function="end"`. */
function hasExistingTopN(xml: string): boolean {
  return /function=(?:'end'|"end")/.test(xml);
}

function buildTopNFilter(p: {
  filterColumn: string;
  count: number;
  end: TopNEnd;
  direction: SortDirection;
  expression: string;
  level: string;
}): string {
  return (
    `<filter class='categorical' column='${p.filterColumn}'>` +
    `<groupfilter function='end' end='${p.end}' count='${p.count}' user:ui-top-by-field='true' units='records' user:ui-marker='end'>` +
    `<groupfilter function='order' direction='${p.direction}' expression='${p.expression}' user:ui-marker='order'>` +
    `<groupfilter function='level-members' level='${p.level}' user:ui-enumeration='all' user:ui-marker='enumerate' />` +
    '</groupfilter>' +
    '</groupfilter>' +
    '</filter>'
  );
}

/**
 * Insert the filter after </datasource-dependencies> and create/extend <slices> so the
 * filtered CI is listed. Order stays: dependencies -> filter -> (sort) -> slices -> aggregation.
 */
function insertFilterAndSlices(xml: string, filterXml: string, sliceColumn: string): string {
  let out = xml.replace(/<\/datasource-dependencies>/, (m) => `${m}\n      ${filterXml}`);
  const sliceEntry = `<column>${sliceColumn}</column>`;

  if (/<slices\b[^>]*\/>/.test(out)) {
    // Empty self-closing <slices/> -> expand with the one entry.
    out = out.replace(/<slices\b[^>]*\/>/, `<slices>${sliceEntry}</slices>`);
  } else if (/<slices>[\s\S]*?<\/slices>/.test(out)) {
    // Existing <slices>...</slices> -> append the entry unless the CI is already listed.
    if (!out.includes(sliceColumn)) {
      out = out.replace(/<\/slices>/, `${sliceEntry}</slices>`);
    }
  } else if (/<aggregation\b/.test(out)) {
    // No slices node -> create one immediately before <aggregation>, matching its indent.
    out = out.replace(/(\s*)(<aggregation\b)/, `$1<slices>${sliceEntry}</slices>$1$2`);
  } else {
    // No aggregation anchor either -> place slices right after the filter.
    out = out.replace(filterXml, `${filterXml}\n      <slices>${sliceEntry}</slices>`);
  }
  return out;
}

/**
 * Plan a Top-N filter on the worksheet's single categorical dimension by its single
 * measure. Refuses per the kill criteria. Pure: returns patched XML or a refusal.
 */
export function planTopN(
  xml: string,
  opts: { n: number; end?: TopNEnd },
): TopNPlan | RefineRefusal {
  const n = opts.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 50) {
    return refuse(`top_n.n must be an integer between 1 and 50 (got ${JSON.stringify(opts.n)}).`);
  }
  const end: TopNEnd = opts.end ?? 'top';
  if (end !== 'top' && end !== 'bottom') {
    return refuse(`top_n.end must be "top" or "bottom" (got ${JSON.stringify(opts.end)}).`);
  }

  const cis = parseColumnInstances(xml);
  const unsupported = unsupportedConstruct(xml, cis);
  if (unsupported === 'calc') {
    return refuse(
      'the worksheet uses a calculated field (derivation="User"); Top-N over calcs is out of scope for this refinement.',
    );
  }
  if (unsupported === 'set') {
    return refuse(
      'the worksheet uses a set/group; set-based Top-N is out of scope for this refinement.',
    );
  }
  if (unsupported === 'param') {
    return refuse(
      'the worksheet references a parameter; parameterized Top-N is out of scope for this refinement.',
    );
  }

  const dims = cis.filter(isDimensionCi);
  if (dims.length === 0)
    return refuse('could not identify a single categorical dimension to rank.');
  if (dims.length > 1) {
    return refuse('more than one categorical dimension is present; the Top-N target is ambiguous.');
  }

  const measures = cis.filter(isMeasureCi);
  if (measures.length === 0) return refuse('could not identify a single measure to rank by.');
  if (measures.length > 1) {
    return refuse('more than one measure is present; the ranking measure is ambiguous.');
  }

  if (hasExistingTopN(xml)) {
    return refuse(
      'a Top-N (function="end") filter already exists; refusing to patch an existing filter without risking <slices>/<aggregation> ordering.',
    );
  }
  if (!/<\/datasource-dependencies>/.test(xml)) {
    return refuse(
      'the worksheet <view> has no <datasource-dependencies> anchor; cannot place the filter safely before <slices>/<aggregation>.',
    );
  }

  const ds = datasourceName(xml);
  if (!ds) return refuse('could not determine the worksheet datasource name.');

  const dim = dims[0];
  const measure = measures[0];
  const func = AGG_DERIVATIONS[measure.derivation];
  const expression = `${func}(${measure.column})`;
  const direction: SortDirection = end === 'top' ? 'DESC' : 'ASC';
  // Returned raw (used for the readback xpath + tool label); escaped only at insertion.
  const filterColumn = `[${ds}].${dim.name}`;

  const filterXml = buildTopNFilter({
    filterColumn: escapeXml(filterColumn),
    count: n,
    end,
    direction,
    expression: escapeXml(expression),
    level: escapeXml(dim.name),
  });
  const out = insertFilterAndSlices(xml, filterXml, escapeXml(filterColumn));
  return { ok: true, xml: out, filterColumn };
}

/**
 * Plan a direction flip on the worksheet's single self-closing <computed-sort>. Refuses if
 * absent, if more than one is present, if the direction is invalid, or if the sort uses the
 * nested <sort class="computed-sort"> crash form. Pure.
 */
export function planSortDirection(
  xml: string,
  opts: { direction: SortDirection },
): SortPlan | RefineRefusal {
  const direction = opts.direction;
  if (direction !== 'ASC' && direction !== 'DESC') {
    return refuse(
      `sort_direction.direction must be "ASC" or "DESC" (got ${JSON.stringify(opts.direction)}).`,
    );
  }

  // The crashing/undefined nested form: a <sort class="computed-sort"> element, or a
  // non-self-closing <computed-sort> open tag (a child follows). Both are refused — only
  // the safe self-closing <computed-sort .../> can be flipped.
  const hasNestedSortEl = /<sort\b[^>]*\bclass=(?:'computed-sort'|"computed-sort")[^>]*>/.test(xml);
  const nonSelfClosingComputedSort = /<computed-sort\b[^>]*[^/]>/.test(xml);
  if (hasNestedSortEl || nonSelfClosingComputedSort) {
    return refuse(
      'the sort uses the nested <sort class="computed-sort"> form; only the safe self-closing <computed-sort/> can be flipped.',
    );
  }

  const selfClosing = [...xml.matchAll(/<computed-sort\b[^>]*\/>/g)];
  if (selfClosing.length === 0) return refuse('no <computed-sort> present to change direction on.');
  if (selfClosing.length > 1) {
    return refuse('more than one <computed-sort> present; the target sort is ambiguous.');
  }

  const tag = selfClosing[0][0];
  const column = attrVal(tag, 'column');
  let newTag: string;
  if (/\bdirection=(?:'[^']*'|"[^"]*")/.test(tag)) {
    newTag = tag.replace(/\bdirection=(?:'[^']*'|"[^"]*")/, `direction='${direction}'`);
  } else {
    newTag = tag.replace(/\s*\/>$/, ` direction='${direction}' />`);
  }
  const out = xml.replace(tag, newTag);
  return { ok: true, xml: out, column, direction };
}

/**
 * Confirm on readback that a Top-N filter for `filterColumn` (a groupfilter with
 * `function="end"`) is present. Quote-agnostic (parses the DOM).
 */
export function confirmTopNApplied(readbackXml: string, filterColumn: string): boolean {
  const doc = parseXml(readbackXml);
  if (!doc) return false;
  // Column refs legally contain quotes (e.g. [none:O'Brien:nk]) — never
  // interpolate them into an XPath literal; compare attributes in JS.
  const filters = (xpath.select('//filter', doc as unknown as Node) as Element[]).filter(
    (f) => !filterColumn || f.getAttribute('column') === filterColumn,
  );
  return filters.some(
    (f) =>
      (xpath.select("count(.//groupfilter[@function='end'])", f as unknown as Node) as number) > 0,
  );
}

/**
 * Confirm on readback that the computed-sort for `column` carries the requested
 * `direction`. Quote-agnostic (parses the DOM).
 */
export function confirmSortDirectionApplied(
  readbackXml: string,
  column: string,
  direction: SortDirection,
): boolean {
  const doc = parseXml(readbackXml);
  if (!doc) return false;
  // Same quote-safety rule as confirmTopNApplied: attribute match in JS.
  const sorts = (xpath.select('//computed-sort', doc as unknown as Node) as Element[]).filter(
    (s) => !column || s.getAttribute('column') === column,
  );
  return sorts.some((s) => (s.getAttribute('direction') ?? '') === direction);
}
