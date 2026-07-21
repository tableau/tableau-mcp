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
 *     The nested <sort class="computed-sort"> form crashes Desktop and is refused. When
 *     NO sort node exists yet, INSERT a safe self-closing <computed-sort> — but only under
 *     the confirmed simple-bar shape (exactly one categorical dimension + one measure, both
 *     on a shelf, single pane): the exact shape magnitude-simple-bar.xml ships (its sort
 *     node at :24). Any richer shape keeps the no-sort refusal.
 *
 * Refusal, not repair: anything outside this tiny envelope (ambiguous dims/measures, n
 * outside 1..50, sets/params/rollups/calcs, an existing Top-N, a nested/multiple
 * computed-sort, or an absent computed-sort on a shape richer than a simple bar) returns
 * `{ ok: false, reason }` so the caller can hand back to the standard authoring path
 * instead of entering whole-workbook XML surgery.
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
export interface SortByFieldPlan extends SortPlan {
  /** The computed-sort `using` field — the readback confirmation target. */
  using: string;
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

interface ColumnDefinition {
  name: string;
  caption: string;
}

interface ComputedSortTarget {
  /** XML slice to replace: the whole computed-sort pair, or the child inside a safe wrapper. */
  tag: string;
  column: string;
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

/** All field `<column>` declarations keyed by their internal field name. */
function parseColumns(xml: string): Map<string, ColumnDefinition> {
  const out = new Map<string, ColumnDefinition>();
  const re = /<column(?=[\s>/])([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = attrVal(attrs, 'name');
    if (!name) continue;
    out.set(name, {
      name,
      caption: attrVal(attrs, 'caption'),
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

/**
 * Internal pseudo-fields (Measure Names / Measure Values and any `[:...]` internal
 * column) match the nominal/quantitative derivation patterns but are NOT real dims or
 * measures — never treat them as the sheet's single dimension/measure.
 */
function isPseudoFieldCi(ci: ColumnInstance): boolean {
  return /^\[:/.test(ci.column) || ci.column === '[Multiple Values]';
}

/** A plain categorical dimension CI: nominal + None derivation (e.g. [none:Region:nk]). */
function isDimensionCi(ci: ColumnInstance): boolean {
  return !isPseudoFieldCi(ci) && ci.type === 'nominal' && ci.derivation === 'None';
}

/** A measure CI: quantitative with a canonical aggregation derivation (e.g. [sum:Sales:qk]). */
function isMeasureCi(ci: ColumnInstance): boolean {
  return (
    !isPseudoFieldCi(ci) &&
    ci.type === 'quantitative' &&
    Object.prototype.hasOwnProperty.call(AGG_DERIVATIONS, ci.derivation)
  );
}

function unbracket(value: string): string {
  const m = value.match(/^\[(.*)\]$/);
  return m ? m[1] : value;
}

function normalizeCaption(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function fieldCaptionCandidates(
  ci: ColumnInstance,
  columns: Map<string, ColumnDefinition>,
): string[] {
  const col = columns.get(ci.column);
  return [
    ...new Set(
      [col?.caption, col?.name && unbracket(col.name), unbracket(ci.column)].filter(
        Boolean,
      ) as string[],
    ),
  ];
}

function resolveCiByCaption(
  cis: ColumnInstance[],
  columns: Map<string, ColumnDefinition>,
  caption: string,
  kind: 'target field' | 'sort-by field',
  predicate: (ci: ColumnInstance) => boolean,
): ColumnInstance | RefineRefusal {
  const wanted = normalizeCaption(caption);
  if (!wanted) return refuse(`${kind} caption is required.`);

  const candidates = cis.filter(predicate);
  const matches = candidates.filter((ci) =>
    fieldCaptionCandidates(ci, columns).some((value) => normalizeCaption(value) === wanted),
  );
  if (matches.length === 1) return matches[0];

  const available = candidates
    .flatMap((ci) => fieldCaptionCandidates(ci, columns))
    .filter(Boolean)
    .sort()
    .join(', ');
  if (matches.length === 0) {
    return refuse(
      `unknown ${kind} caption "${caption}". Available ${kind} captions: ${available || '(none)'}.`,
    );
  }
  return refuse(`ambiguous ${kind} caption "${caption}" matched ${matches.length} fields.`);
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

/** The text of a single shelf (`rows`/`cols`) — where placed (bound) pills appear DS-qualified. */
function shelfText(xml: string, shelf: 'rows' | 'cols'): string {
  return xml.match(new RegExp(`<${shelf}\\b[^>]*>([\\s\\S]*?)</${shelf}>`))?.[1] ?? '';
}

/** True if a value carries any XML-special char that would break a single-quoted attribute. */
function hasXmlSpecialChars(value: string): boolean {
  return /['"<>&]/.test(value);
}

/**
 * Plan the INSERTION of a safe self-closing <computed-sort> on an UNSORTED sheet, but
 * ONLY when the sheet is the confirmed simple-bar shape magnitude-simple-bar.xml ships:
 * exactly one categorical dimension + one measure (and no other CIs), both bound to a
 * shelf, a single pane, and none of the out-of-envelope constructs (calc/set/param/
 * table-calc). Attributes/placement mirror that template's sort node (:24):
 *   <computed-sort column='[ds].[dimCI]' direction='…' using='[ds].[measureCI]' />
 * placed right after </datasource-dependencies>. The node is the self-closing form the
 * lossy-apply detector explicitly recommends (it round-trips as <computed-sort>, never a
 * dropped <shelf-sort-v2>), so it cannot trip shelf-sort-v2 loss. Returns a SortPlan when
 * the shape is safe, else null so the caller keeps the standard no-sort refusal — we never
 * guess a sort for a richer shape.
 */
function planSortInsertion(xml: string, direction: SortDirection): SortPlan | null {
  const cis = parseColumnInstances(xml);
  // Out-of-envelope constructs (calc/set/param) or a table calc → do not guess.
  if (unsupportedConstruct(xml, cis) !== null) return null;
  if (/<table-calc\b/.test(xml)) return null;
  // Dual-axis / layered marks show up as multiple panes; the simple bar has exactly one.
  if ((xml.match(/<pane\b/g) ?? []).length !== 1) return null;
  // Exactly ONE dependency block, or the insertion anchor (its </…>) is ambiguous and the
  // node could land between blocks. The simple bar has a single dependency block.
  if ((xml.match(/<datasource-dependencies\b/g) ?? []).length !== 1) return null;
  // Exactly the template's two CIs: one categorical dimension + one measure, nothing else.
  if (cis.length !== 2) return null;
  const dims = cis.filter(isDimensionCi);
  const measures = cis.filter(isMeasureCi);
  if (dims.length !== 1 || measures.length !== 1) return null;

  const ds = datasourceName(xml);
  if (!ds) return null;
  if (!/<\/datasource-dependencies>/.test(xml)) return null;

  const column = `[${ds}].${dims[0].name}`;
  const using = `[${ds}].${measures[0].name}`;
  // The attribute values are string-built into single-quoted attributes; a datasource name
  // or CI carrying a quote/angle-bracket/ampersand would emit malformed XML. Refuse rather
  // than guess an escaping — refusal falls back to the always-safe standard path.
  if (hasXmlSpecialChars(column) || hasXmlSpecialChars(using)) return null;
  // The simple bar binds the dimension to exactly one shelf and the measure to the other.
  // A dimension present on BOTH shelves (or the two sharing a shelf) is not that shape —
  // check each shelf separately rather than the concatenation (manifest hazard
  // "computed-sort-pill-coupling": the dimension is what we order, the measure is the key).
  const rows = shelfText(xml, 'rows');
  const cols = shelfText(xml, 'cols');
  const dimOnRows = rows.includes(column);
  const dimOnCols = cols.includes(column);
  const measOnRows = rows.includes(using);
  const measOnCols = cols.includes(using);
  const boundLikeSimpleBar =
    (dimOnRows && !dimOnCols && measOnCols && !measOnRows) ||
    (dimOnCols && !dimOnRows && measOnRows && !measOnCols);
  if (!boundLikeSimpleBar) return null;

  const node = `<computed-sort column='${column}' direction='${direction}' using='${using}' />`;
  const out = xml.replace(/<\/datasource-dependencies>/, (m) => `${m}\n      ${node}`);
  return { ok: true, xml: out, column, direction };
}

function plainNestedComputedSortTargets(
  xml: string,
): Array<ComputedSortTarget & { childStart: number }> {
  const out: Array<ComputedSortTarget & { childStart: number }> = [];
  const re =
    /<sort\b([^>]*\bclass=(?:'computed-sort'|"computed-sort")[^>]*)>\s*(<computed-sort\b([^>]*?)\/>)\s*<\/sort>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[2];
    const childOffset = m[0].indexOf(tag);
    out.push({
      tag,
      column: attrVal(m[3], 'column'),
      childStart: (m.index ?? 0) + childOffset,
    });
  }
  return out;
}

function isInsidePlainNestedComputedSortChild(
  index: number,
  plainNested: Array<{ tag: string; childStart: number }>,
): boolean {
  return plainNested.some(
    ({ tag, childStart }) => index >= childStart && index < childStart + tag.length,
  );
}

function computedSortTargets(xml: string): ComputedSortTarget[] {
  const plainNested = plainNestedComputedSortTargets(xml);
  const out: ComputedSortTarget[] = plainNested.map(({ tag, column }) => ({ tag, column }));

  for (const m of xml.matchAll(/<computed-sort\b([^>]*?)\/>/g)) {
    if (isInsidePlainNestedComputedSortChild(m.index ?? 0, plainNested)) continue;
    out.push({ tag: m[0], column: attrVal(m[1], 'column') });
  }

  for (const m of xml.matchAll(/<computed-sort\b([^>]*?)>\s*<\/computed-sort>/g)) {
    out.push({ tag: m[0], column: attrVal(m[1], 'column') });
  }

  return out;
}

function stripSafeComputedSortForms(xml: string): string {
  return xml
    .replace(
      /<sort\b[^>]*\bclass=(?:'computed-sort'|"computed-sort")[^>]*>\s*<computed-sort\b[^>]*?\/>\s*<\/sort>/g,
      '',
    )
    .replace(/<computed-sort\b[^>]*?\/>/g, '')
    .replace(/<computed-sort\b[^>]*?>\s*<\/computed-sort>/g, '');
}

function validateComputedSortShape(xml: string): RefineRefusal | null {
  const unsafeSortXml = stripSafeComputedSortForms(xml);
  const hasNestedSortEl = /<sort\b[^>]*\bclass=(?:'computed-sort'|"computed-sort")[^>]*>/.test(
    unsafeSortXml,
  );
  const nonPlainComputedSort = /<computed-sort\b[^>]*>/.test(unsafeSortXml);
  if (hasNestedSortEl || nonPlainComputedSort) {
    return refuse(
      'the sort uses the nested <sort class="computed-sort"> form; only the safe self-closing <computed-sort/> can be changed.',
    );
  }

  if ((xml.match(/<datasource-dependencies\b/g) ?? []).length !== 1) {
    return refuse('expected exactly one datasource-dependencies block to resolve field captions.');
  }
  if (!/<\/datasource-dependencies>/.test(xml)) {
    return refuse('the worksheet <view> has no <datasource-dependencies> anchor.');
  }
  return null;
}

function planComputedSortByRefs(
  xml: string,
  opts: { targetField: string; column: string; using: string; direction: SortDirection },
): SortByFieldPlan | RefineRefusal {
  const node = `<computed-sort column='${escapeXml(opts.column)}' direction='${opts.direction}' using='${escapeXml(opts.using)}' />`;
  const targetSorts = computedSortTargets(xml).filter((sort) => sort.column === opts.column);
  if (targetSorts.length > 1) {
    return refuse(`more than one <computed-sort> present for target field "${opts.targetField}".`);
  }

  const out =
    targetSorts.length === 1
      ? xml.replace(targetSorts[0].tag, node)
      : xml.replace(/<\/datasource-dependencies>/, (m) => `${m}\n      ${node}`);
  return { ok: true, xml: out, column: opts.column, using: opts.using, direction: opts.direction };
}

/**
 * Plan a direction change on the worksheet's single self-closing <computed-sort>: flip an
 * existing one, or INSERT one on an unsorted simple bar (see planSortInsertion). Refuses if
 * more than one sort is present, if the direction is invalid, if the sort uses the nested
 * <sort class="computed-sort"> crash form, or if the sheet is unsorted AND richer than a
 * simple bar. Pure.
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
  if (selfClosing.length === 0) {
    // No sort yet: ADD one iff the sheet is the safe simple-bar shape; otherwise keep the
    // historic refusal so a richer shape falls back to the standard build path.
    const inserted = planSortInsertion(xml, direction);
    if (inserted) return inserted;
    return refuse('no <computed-sort> present to change direction on.');
  }
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
 * Plan a computed sort for one caption-addressed dimension by one caption-addressed
 * measure. This is the explicit sort primitive for sheets where "flip direction" is not
 * enough: callers name the displayed fields, never Tableau's internal CI refs.
 */
export function planSortByField(
  xml: string,
  opts: { targetField: string; sortByField: string; direction?: SortDirection },
): SortByFieldPlan | RefineRefusal {
  const direction = opts.direction ?? 'ASC';
  if (direction !== 'ASC' && direction !== 'DESC') {
    return refuse(
      `sort_by_field.direction must be "ASC" or "DESC" (got ${JSON.stringify(opts.direction)}).`,
    );
  }

  const invalidShape = validateComputedSortShape(xml);
  if (invalidShape) return invalidShape;

  const ds = datasourceName(xml);
  if (!ds) return refuse('could not determine the worksheet datasource name.');

  const cis = parseColumnInstances(xml);
  const columns = parseColumns(xml);
  const target = resolveCiByCaption(cis, columns, opts.targetField, 'target field', isDimensionCi);
  if (!('name' in target)) return target;
  const sortBy = resolveCiByCaption(cis, columns, opts.sortByField, 'sort-by field', isMeasureCi);
  if (!('name' in sortBy)) return sortBy;

  const column = `[${ds}].${target.name}`;
  const using = `[${ds}].${sortBy.name}`;
  return planComputedSortByRefs(xml, { targetField: opts.targetField, column, using, direction });
}

/**
 * Bind-template shorthand: sort the sheet's single categorical axis by a schema field.
 * If the sort field is not already a worksheet CI, callers may pass its schema column_ref.
 */
export function planSortByFieldOnCategoricalAxis(
  xml: string,
  opts: { sortByField: string; sortByColumnRef?: string; direction?: SortDirection },
): SortByFieldPlan | RefineRefusal {
  const direction = opts.direction ?? 'ASC';
  if (direction !== 'ASC' && direction !== 'DESC') {
    return refuse(
      `sort.direction must be "ASC" or "DESC" (got ${JSON.stringify(opts.direction)}).`,
    );
  }

  const invalidShape = validateComputedSortShape(xml);
  if (invalidShape) return invalidShape;

  const ds = datasourceName(xml);
  if (!ds) return refuse('could not determine the worksheet datasource name.');

  const cis = parseColumnInstances(xml);
  // The sortable "categorical axis" is a dimension CI placed ON A SHELF (rows/cols) — never a
  // filter-only dimension. A waterfall's anchor_category exclude-filter adds a nominal/None CI
  // that lives only inside <filter>; counting it as a second axis wrongly trips the ambiguity
  // refusal below (the seam that kept anchor+sort from co-existing). Restrict axis candidates
  // to dims whose DS-qualified ref appears on a shelf, mirroring planSortInsertion's proven
  // membership check — a filter-only CI has no axis to order, so it can never be the target.
  // Substring membership is exact for CI refs: `[${ds}].${ci.name}` ends in the CI's closing
  // bracket (e.g. `[none:Region:nk]`), and the `:suffix]` structure means one CI ref is never a
  // substring of a longer one (`[none:Region:nk]` ≠ inside `[none:RegionName:nk]`). `ds` and
  // `ci.name` are read raw from the same document as the shelf text, so any XML escaping in the
  // DS name (e.g. `P&amp;L Data`) is identical on both sides of the comparison.
  const rows = shelfText(xml, 'rows');
  const cols = shelfText(xml, 'cols');
  const dims = cis
    .filter(isDimensionCi)
    .filter((ci) => rows.includes(`[${ds}].${ci.name}`) || cols.includes(`[${ds}].${ci.name}`));
  if (dims.length === 0) return refuse('could not identify a single categorical axis to sort.');
  if (dims.length > 1)
    return refuse('more than one categorical axis is present; sort is ambiguous.');

  const columns = parseColumns(xml);
  const sortBy = resolveCiByCaption(cis, columns, opts.sortByField, 'sort-by field', isMeasureCi);
  if (!('name' in sortBy) && !opts.sortByColumnRef) return sortBy;
  const using = 'name' in sortBy ? `[${ds}].${sortBy.name}` : opts.sortByColumnRef!;

  const target = dims[0];
  const targetField = fieldCaptionCandidates(target, columns)[0] ?? target.column;
  return planComputedSortByRefs(xml, {
    targetField,
    column: `[${ds}].${target.name}`,
    using,
    direction,
  });
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

/** Confirm that the computed-sort column/using/direction tuple landed on readback. */
export function confirmSortByFieldApplied(
  readbackXml: string,
  column: string,
  using: string,
  direction: SortDirection,
): boolean {
  const doc = parseXml(readbackXml);
  if (!doc) return false;
  const sorts = (xpath.select('//computed-sort', doc as unknown as Node) as Element[]).filter(
    (s) => s.getAttribute('column') === column && s.getAttribute('using') === using,
  );
  return sorts.some((s) => (s.getAttribute('direction') ?? '') === direction);
}
