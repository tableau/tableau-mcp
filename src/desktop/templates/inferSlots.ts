// Metadata-free slot inference from a bookmark (.tbm).
//
// Given a Desktop-saved bookmark, derive the bindable slots — WITHOUT any
// hand-authored manifest and WITHOUT any chart-specific branching. Every fact about
// a slot (kind, derivation, role, required, generic purpose) comes from the sheet's
// OWN structure: the donor `<column>` dictionary's role/datatype/semantic-role and
// the shelf the field is placed on. No template name, chart family, or concrete field
// name ever steers the logic — the same code reads a bar chart and a map identically.
//
// Ported from the #716 TBM compiler authority. No sidecar catalog or static template
// manifest participates in this inference path.

import type {
  CalcSlot,
  CommunicativeRole,
  Derivation,
  SlotKind,
  SlotSpec,
  TableCalcFact,
  TemplateBindingContract,
} from '../binder/manifest-types.js';
import {
  type ColumnDef,
  type Inference,
  type InferredCalc,
  type InferredSlot,
  parseBookmarkDom,
  parseInstanceRef,
  parseInstanceRole,
  type Shelf,
} from './bookmarkTemplate.js';

/**
 * A slot's kind from role + datatype + semantic-role ONLY — never from the field name.
 * semantic-role present on a dimension ⇒ geo; else datatype decides.
 */
function kindOf(def: ColumnDef | undefined): SlotKind | 'unknown' {
  if (!def) return 'unknown';
  const dt = def.datatype.toLowerCase();
  if (def.role === 'dimension' && def.semanticRole) return 'geo';
  if (dt === 'date' || dt === 'datetime') return 'temporal';
  if (dt === 'integer' || dt === 'real') {
    return def.role === 'dimension' ? 'categorical' : 'quantitative';
  }
  if (dt === 'string' || dt === 'boolean') return 'categorical';
  return 'unknown';
}

/** Immediate column dependencies in a formula. Qualified parameter refs are not donor fields. */
function baseInputsOf(formula: string): string[] {
  const out = new Set<string>();
  for (const match of formula.matchAll(/\[([^\]]+)\](?:\.\[([^\]]+)\])?/g)) {
    const qualifier = match[2] === undefined ? undefined : match[1];
    const field = match[2] ?? match[1];
    if (qualifier?.toLowerCase() === 'parameters') continue;
    out.add(field);
  }
  return [...out];
}

/**
 * GENERIC purpose from kind + shelf position. MUST never contain the donor field's
 * name — this is the "expose a semantic derivation, not a concrete field" requirement,
 * enforced mechanically by the zero-leakage tests.
 */
export function autoPurpose(kind: SlotKind | 'unknown', shelf: Shelf[]): string {
  const onAxis = shelf.includes('cols') || shelf.includes('rows');
  // A field that appears ONLY at a refinement site — never on an axis or a mark encoding —
  // is described by that site, not as a mark encoding. Checked first so a filter/title/
  // reference-line-only field isn't mislabelled "encoded on a mark property".
  if (shelf.length > 0 && shelf.every((s) => REFINEMENT_SHELVES.has(s))) {
    if (shelf.includes('reference-line')) {
      return 'Measure that positions an analytical reference line.';
    }
    if (shelf.includes('filter')) {
      return 'Dimension that scopes which data the sheet shows (filter).';
    }
    if (shelf.includes('title')) {
      return 'Field surfaced in the sheet title text (display only).';
    }
  }
  switch (kind) {
    case 'quantitative':
      return onAxis
        ? 'Continuous measure that drives the primary quantitative axis (bar length / position).'
        : 'Continuous measure encoded on a mark property (size / color / label).';
    case 'temporal':
      return 'Date/time field that defines the sequence along the temporal axis.';
    case 'geo':
      return 'Geographic dimension that locates each mark on the map.';
    case 'categorical':
      // Not on rows/cols ⇒ a mark-encoding shelf (mark / color / size / detail / lod / …):
      // the dimension is encoded on a mark property, not partitioning an axis.
      if (!onAxis) {
        return 'Categorical dimension encoded on a mark property (color / detail / label).';
      }
      return shelf.includes('rows')
        ? 'Categorical dimension that partitions rows (one mark group per member).'
        : 'Categorical dimension that partitions columns (one mark group per member).';
    default:
      return 'Field placed on the sheet; role inferred from shelf position.';
  }
}

/** Tableau pseudo-fields are never bindable (mirrors the refineWorksheet predicate). */
function isPseudo(base: string): boolean {
  return base.startsWith(':') || base === 'Multiple Values' || base === '';
}

/**
 * Non-encoding REFINEMENT sites. A field seen only here (a filter/slices pill, a title run,
 * or a reference line) is described by the site, never as a mark encoding — `autoPurpose`
 * consults this to phrase the purpose accurately. `tooltip` is deliberately absent: it is a
 * mark-encoding shelf whose existing "encoded on a mark property" purpose still fits.
 */
const REFINEMENT_SHELVES = new Set<Shelf>(['filter', 'title', 'reference-line']);

/**
 * Shelves that NEVER add to the view's level of detail. A pill here does not partition the
 * marks: a `tooltip` only annotates an existing mark, a `filter`/`slices` pill scopes which
 * data shows without creating marks, a `title` run is display text, and a `reference-line`
 * positions an analytical line. Every OTHER shelf — rows / cols and the mark encodings
 * (color / size / text / label / detail / lod / shape / path / geometry / angle / wedge-size)
 * — is PARTITIONING: a discrete pill there adds marks and so changes the grain. This is the
 * LOD prong of the two-prong optionality rule below; read structurally, never keyed on chart
 * family.
 */
const NON_PARTITIONING_SHELVES = new Set<Shelf>(['tooltip', 'filter', 'title', 'reference-line']);

/**
 * Derivations that AGGREGATE — they collapse rows rather than partition them, so a field
 * carrying one is LOD-neutral no matter which shelf it sits on. The measure aggregates
 * (sum/avg/cnt/ctd/med/min/max/std/stp/var/vrp), `attr` (ATTR() — an aggregated dimension), and `usr`
 * (a table calc, computed post-aggregation) all clear the LOD prong for free. The complement
 * — `none` and the date-part truncations (yr/qr/mn/…) — are DISAGGREGATED dimension pills:
 * placed on a partitioning shelf they change the view's grain and so are load-bearing.
 */
const AGGREGATE_DERIVATIONS = new Set<Derivation>([
  'sum',
  'avg',
  'cnt',
  'ctd',
  'med',
  'min',
  'max',
  'std',
  'stp',
  'var',
  'vrp',
  'attr',
  'usr',
]);

/**
 * The single communicative role a slot plays — what it COMMUNICATES, not where it sits. Derived
 * from kind + derivation + placement using the SAME two-prong vocabulary as `required`:
 *   • on a rows/cols axis → `measure-value` (a measure) or `axis-partition` (a dimension);
 *   • off the axis, on ONLY non-partitioning sites → `filter-scope` (a filter/slices pill) or
 *     `decoration` (title / tooltip / reference-line — annotation only);
 *   • off the axis, on a partitioning mark encoding → `distribution-breakout` (a disaggregated
 *     dimension that adds marks / sets the grain — e.g. a pie's colour, a box-plot's detail),
 *     or, for an LOD-neutral field, `measure-value` (an aggregated measure on a defining size/
 *     angle encoding) / `decoration` (an aggregated dimension label, the box-plot attr case).
 * Table-calc addressing/partition roles are assigned by the table-calc pass (Track 1 chunk 4).
 */
function communicativeRole(
  kind: SlotKind,
  derivation: Derivation,
  shelf: Shelf[],
): CommunicativeRole {
  if (shelf.includes('rows') || shelf.includes('cols')) {
    return kind === 'quantitative' ? 'measure-value' : 'axis-partition';
  }
  const partitioning = shelf.some((s) => !NON_PARTITIONING_SHELVES.has(s));
  if (!partitioning) {
    // Only non-partitioning sites remain: a filter/slices pill scopes the data; a title,
    // tooltip, or reference-line merely annotates the existing marks.
    return shelf.includes('filter') ? 'filter-scope' : 'decoration';
  }
  // A partitioning mark encoding, but this field is not on a rows/cols axis of its own.
  if (!AGGREGATE_DERIVATIONS.has(derivation)) return 'distribution-breakout';
  return kind === 'quantitative' ? 'measure-value' : 'decoration';
}

/**
 * Derive the bindable slots (and the donor facts a caller needs to tokenize + audit)
 * from a raw bookmark. Reads the `<column>` dictionary for kinds, walks the
 * rows/cols/mark encodings for placement, and decomposes placed calcs to their base
 * inputs. `kind: 'unknown'` fields are SKIPPED (counted, never guessed).
 */
export function inferFromBookmark(rawXml: string): Inference {
  const { all, attr } = parseBookmarkDom(rawXml);
  const placementRoots = [...all('table'), ...all('window')];
  const placementElements = (tag: string): Element[] =>
    placementRoots.flatMap((root) =>
      root.tagName === tag
        ? [root]
        : (Array.from(root.getElementsByTagName(tag)) as unknown as Element[]),
    );

  const cols = new Map<string, ColumnDef>();
  for (const c of all('column')) {
    const name = attr(c, 'name');
    if (!name) continue;
    const key = name.replace(/^\[|\]$/g, '');
    const calcEl = Array.from(c.getElementsByTagName('calculation'))[0] as Element | undefined;
    const formula = calcEl ? attr(calcEl, 'formula') : '';
    let owner = c.parentNode as Element | null;
    let parameterOwner = false;
    while (owner) {
      if (owner.tagName === 'datasource' || owner.tagName === 'datasource-dependencies') {
        parameterOwner =
          (attr(owner, 'name') || attr(owner, 'datasource')).toLowerCase() === 'parameters';
        break;
      }
      owner = owner.parentNode as Element | null;
    }
    const prev = cols.get(key);
    cols.set(key, {
      name: key,
      caption: attr(c, 'caption') || prev?.caption || '',
      datatype: attr(c, 'datatype') || prev?.datatype || '',
      role: attr(c, 'role') || prev?.role || '',
      type: attr(c, 'type') || prev?.type || '',
      semanticRole: attr(c, 'semantic-role') || prev?.semanticRole || '',
      isCalc: !!calcEl || !!prev?.isCalc,
      isParameter: !!attr(c, 'param-domain-type') || parameterOwner || !!prev?.isParameter,
      formula: formula || prev?.formula || '',
      baseInputs: formula ? baseInputsOf(formula) : (prev?.baseInputs ?? []),
    });
  }

  // Sets/groups are template-owned dependency nodes rather than donor columns. Their
  // groupfilter levels/expressions still lead to real donor fields that must be bound.
  const groupInputs = new Map<string, string[]>();
  for (const group of all('group')) {
    const name = attr(group, 'name').replace(/^\[|\]$/g, '');
    if (!name) continue;
    const inputs = new Set<string>();
    for (const filter of Array.from(
      group.getElementsByTagName('groupfilter'),
    ) as unknown as Element[]) {
      for (const attribute of Array.from(filter.attributes) as Attr[]) {
        for (const dependency of baseInputsOf(attribute.value)) inputs.add(dependency);
      }
    }
    groupInputs.set(name, [...inputs]);
  }

  const terminalInputsByCalc = new Map<string, string[]>();
  const terminalInputsOf = (base: string, stack: string[] = []): string[] => {
    const cached = terminalInputsByCalc.get(base);
    if (cached) return cached;
    const def = cols.get(base);
    if (!def) {
      const ownedInputs = groupInputs.get(base);
      if (ownedInputs) {
        const leaves = new Set<string>();
        for (const dependency of ownedInputs) {
          for (const leaf of terminalInputsOf(dependency, stack)) leaves.add(leaf);
        }
        return [...leaves];
      }
      throw new Error(
        `Calculated field dependency '${base}' is missing from the column dictionary.`,
      );
    }
    if (def.isParameter) return [];
    if (!def.isCalc) return [base];
    if (stack.includes(base)) {
      throw new Error(
        `Calculated field dependency cycle: ${[...stack.slice(stack.indexOf(base)), base].join(' -> ')}.`,
      );
    }
    const leaves = new Set<string>();
    for (const dependency of def.baseInputs) {
      for (const leaf of terminalInputsOf(dependency, [...stack, base])) leaves.add(leaf);
    }
    const resolved = [...leaves];
    terminalInputsByCalc.set(base, resolved);
    return resolved;
  };

  // TABLE-CALC facts (Track 1 chunk 4). A quick/custom table calc lives on a
  // `<column-instance>` as one or more `<table-calc>` children (never on the `<column>` def for
  // a quick calc). The CI NAME chains the calc prefixes right-to-left
  // (`pcdf:cum:sum:Sales:qk` = SUM → cumulative → percent diff); parseInstanceRef strips those
  // wrappers so the measure still resolves to its base + aggregation. Two facts come off the
  // `<table-calc>` children and steer optionality:
  //   • the addressing MODE — `absolute` when any child pins the computation to a NAMED
  //     dimension (`ordering-type="Field"` + ordering-field / level-break / level-address),
  //     else `relative` (positional Compute Using: Table / Pane / Cell — names no dimension);
  //   • the dimensions it runs ALONG (ordering-field + level-address) and RESETS on
  //     (level-break). Read structurally — never keyed on chart family or field name.
  // The BARE ordering-field ref (`[ds].[Order Date]`, no deriv:field:role) is shielded from
  // tokenization and its rewrite/rebind is a separately tracked pass; here we only READ it to
  // name the addressing dimension and flag the dim slot that DOES appear on the sheet.
  const tableCalcByBase = new Map<string, TableCalcFact>();
  const addressingRole = new Map<string, CommunicativeRole>(); // dim base → tablecalc-* role
  for (const ci of all('column-instance')) {
    const tcs = Array.from(ci.getElementsByTagName('table-calc')) as unknown as Element[];
    if (tcs.length === 0) continue;
    const { base } = parseInstanceRef(attr(ci, 'name'));
    if (isPseudo(base)) continue;
    const fact: TableCalcFact = tableCalcByBase.get(base) ?? {
      types: [],
      addressing: 'relative',
      along: [],
      reset_on: [],
    };
    for (const tc of tcs) {
      const type = attr(tc, 'type');
      if (type && !fact.types.includes(type)) fact.types.push(type);
      const orderingField = attr(tc, 'ordering-field');
      const levelAddress = attr(tc, 'level-address');
      const levelBreak = attr(tc, 'level-break');
      if (attr(tc, 'ordering-type') === 'Field' || orderingField || levelAddress || levelBreak) {
        fact.addressing = 'absolute';
      }
      for (const ref of [orderingField, levelAddress]) {
        if (!ref) continue;
        const b = parseInstanceRef(ref).base;
        if (!isPseudo(b) && !fact.along.includes(b)) fact.along.push(b);
      }
      if (levelBreak) {
        const b = parseInstanceRef(levelBreak).base;
        if (!isPseudo(b) && !fact.reset_on.includes(b)) fact.reset_on.push(b);
      }
    }
    tableCalcByBase.set(base, fact);
  }
  // A dim named by level-break RESETS the calc (partition); a dim named only by
  // ordering-field/level-address is addressed ALONG it. reset_on wins when a dim is both.
  for (const fact of tableCalcByBase.values()) {
    for (const b of fact.along)
      if (!addressingRole.has(b)) addressingRole.set(b, 'tablecalc-addressing');
    for (const b of fact.reset_on) addressingRole.set(b, 'tablecalc-partition');
  }

  // Placements keyed by (base, DERIVATION), not base alone. A base field placed at two
  // date parts — YEAR + MONTH of one Order Date on a gantt's cols — is TWO placements,
  // each retaining its own derivation. Keying by base alone (the prior behaviour) merged
  // them and DISCARDED the second derivation, so both refs later rendered as the first
  // (YEAR twice). The semantic abstraction must expose the date part, so each distinct
  // (base, derivation) survives as its own placement.
  interface Placement {
    base: string;
    derivation: Derivation;
    instanceRoles: Set<'nk' | 'ok' | 'qk'>;
    shelves: Set<Shelf>;
    isCalc: boolean;
  }
  const pairKey = (base: string, d: Derivation): string => `${base}${d}`;
  const byPair = new Map<string, Placement>();
  const placed: Placement[] = [];
  const placedCalcs: Placement[] = [];
  // Register one donor field reference found at `shelf`. Dedup is by (base, DERIVATION): the
  // same field placed at two sites merges its shelves onto one placement; a field placed at
  // two date parts (YEAR + MONTH of one date) stays two placements, each with its own
  // derivation. Pseudo-fields ([:Measure Names], [Multiple Values]) are never bindable.
  const addRef = (refText: string, shelf: Shelf): void => {
    const { base, derivation } = parseInstanceRef(refText);
    const instanceRole = parseInstanceRole(refText);
    if (isPseudo(base)) return;
    const key = pairKey(base, derivation);
    const cur = byPair.get(key);
    if (cur) {
      cur.shelves.add(shelf);
      if (instanceRole) cur.instanceRoles.add(instanceRole);
      return;
    }
    const p: Placement = {
      base,
      derivation,
      instanceRoles: new Set(instanceRole ? [instanceRole] : []),
      shelves: new Set([shelf]),
      isCalc: !!cols.get(base)?.isCalc,
    };
    byPair.set(key, p);
    (p.isCalc ? placedCalcs : placed).push(p);
  };
  // Extract every bracketed column-instance ref from an element's TEXT content (the axis/mark
  // and title/label form, e.g. `[ds].[sum:Sales:qk]` — also inside a `<...>` title run).
  const addFromText = (el: Element | undefined, shelf: Shelf): void => {
    for (const m of (el?.textContent ?? '').matchAll(/\[[^\]]*\](?:\.\[[^\]]*\])*/g)) {
      addRef(m[0], shelf);
    }
  };

  // 1. AXIS + MARK shelves: refs live in element TEXT content.
  for (const tag of ['rows', 'cols', 'mark'] as Shelf[]) {
    for (const el of placementElements(tag)) addFromText(el, tag);
  }

  // 2. MARK-ENCODING shelves (color/size/text/lod/detail/tooltip/shape/…): ref in a `column`
  // attribute on a child of `<encodings>`, and the child's TAG NAME is the shelf. An
  // encoding-only chart (treemap, pie, symbol map) places EVERY field here and nothing on
  // rows/cols, so without this walk it inferred ZERO slots. Walked AFTER the axis shelves so
  // token numbering stays stable for the axis-first common case.
  for (const enc of placementElements('encodings')) {
    for (const child of Array.from(enc.getElementsByTagName('*')) as unknown as Element[]) {
      const ref = attr(child, 'column');
      if (ref) addRef(ref, (child.tagName || 'mark') as Shelf);
    }
  }

  // 3. REFINEMENT sites — a field can appear ONLY here (never on an axis or a mark encoding)
  // and still be part of the sheet: a categorical FILTER / slices pill, a field-reference run
  // surfaced in the TITLE or a customized mark LABEL, or a measure positioning a REFERENCE
  // LINE. Omitting these dropped such a field from inference entirely (no slot for an agent to
  // map — the box-plot's title/filter/reference-line fields were invisible). Read structurally
  // by site; never keyed on chart family. Walked LAST so axis/encoding fields keep their token
  // numbers. `<caption>` is deliberately NOT a ref site: it is auto-generated PROSE that names
  // fields in English, not machine refs (the display-prong optionality rule reads it, not this).
  for (const f of placementElements('filter')) {
    const ref = attr(f, 'column');
    if (ref) addRef(ref, 'filter');
  }
  for (const sl of placementElements('slices')) {
    for (const c of Array.from(sl.getElementsByTagName('column')) as unknown as Element[]) {
      addFromText(c, 'filter');
    }
  }
  for (const rl of placementElements('reference-line')) {
    for (const a of ['axis-column', 'value-column']) {
      const ref = attr(rl, a);
      if (ref) addRef(ref, 'reference-line');
    }
  }
  for (const t of placementElements('title')) addFromText(t, 'title');
  for (const cl of placementElements('customized-label')) addFromText(cl, 'label');

  // Expand placements to the (base, derivation) pairs actually emitted: direct
  // placements first (encoding order), then each calc's base-input leaves — preserving
  // the prior placed-then-calcs ordering so token numbering is stable for the common
  // single-derivation case. A placed CALC is decomposed to its base-column leaves; each
  // leaf becomes a bindable slot and the calc itself is fixed derived structure.
  interface Emit {
    base: string;
    derivation: Derivation;
    instanceRole?: 'nk' | 'ok' | 'qk';
    shelves: Set<Shelf>;
    tier: 'primary' | 'advanced';
  }
  const emits: Emit[] = placed.map((p) => ({
    base: p.base,
    derivation: p.derivation,
    instanceRole: p.instanceRoles.size === 1 ? [...p.instanceRoles][0] : undefined,
    shelves: p.shelves,
    tier: 'primary' as const,
  }));
  for (const p of placedCalcs) {
    const def = cols.get(p.base);
    if (!def) continue;
    // A decomposed leaf binds at derivation `none`, NOT the calc's outer aggregation
    // (`p.derivation`). Inside a formula the base columns are referenced RAW / row-level —
    // `DATEDIFF('day',[Order Date],[Ship Date])`, `SPLIT([Product Name],…)`,
    // `{ FIXED [Customer Name]: SUM([Profit]) }` — while the calc's `sum` wraps the whole
    // expression's scalar result, not each input. Stamping the outer `sum` onto a date or
    // string leaf produced an illegal (kind, derivation) pair the binder correctly rejects at
    // Gate 4 ("aggregation 'sum' requires a numeric measure"), failing the whole template. The
    // raw base name is also exactly what the formula-rewriter emits for the token, so `none` is
    // both the correct binding derivation and what the injected formula needs.
    for (const leaf of terminalInputsOf(p.base)) {
      emits.push({ base: leaf, derivation: 'none', shelves: p.shelves, tier: 'primary' });
    }
  }

  // A base emitted with >1 DISTINCT derivation needs derivation-qualified slot ids so its
  // two date parts are separate slots; a single-derivation base keeps its bare slot_id
  // byte-for-byte (zero change for the common case). Counts only known-kind pairs — an
  // unknown-kind pair is never emitted, so it must not force qualification.
  const derivsByBase = new Map<string, Set<Derivation>>();
  for (const e of emits) {
    if (kindOf(cols.get(e.base)) === 'unknown') continue;
    const set = derivsByBase.get(e.base) ?? new Set<Derivation>();
    set.add(e.derivation);
    derivsByBase.set(e.base, set);
  }

  // Tokens are assigned per DISTINCT base (first-emitted order), so every derivation of
  // one field shares a token — matching bookmarkToTemplateWorkbook, which tokenizes by
  // base name. Only known-kind bases consume a number, keeping the sequence dense.
  const tokenByBase = new Map<string, string>();
  const tokenForBase = (base: string): string => {
    let t = tokenByBase.get(base);
    if (!t) {
      t = `{{field_base_${tokenByBase.size + 1}}}`;
      tokenByBase.set(base, t);
    }
    return t;
  };

  // Does any BINDABLE field land on a rows/cols axis? An axis-based chart (bar, line,
  // gantt) makes its mark-encoding shelves optional refinements; an encoding-ONLY chart
  // (pie, treemap, symbol map, choropleth, kpi-text) has no bindable axis, so its defining
  // encodings ARE the chart and must be required. A symbol map / choropleth places
  // Tableau-GENERATED Latitude/Longitude on rows/cols — but those are unknown-kind (no
  // <column> dict entry), get SKIPPED as slots, and must NOT count as an axis: doing so
  // would leave every real encoding (size/color/geo-lod) optional and the chart with zero
  // required slots. So an axis counts only when a surviving (known-kind, non-pseudo) slot
  // sits on it.
  const hasAxisPlacement = emits.some(
    (e) =>
      (e.shelves.has('rows') || e.shelves.has('cols')) &&
      !isPseudo(e.base) &&
      kindOf(cols.get(e.base)) !== 'unknown',
  );

  const slots: InferredSlot[] = [];
  const seen = new Set<string>();
  let unknownCount = 0;

  const emit = (e: Emit): void => {
    const key = pairKey(e.base, e.derivation);
    if (seen.has(key) || isPseudo(e.base)) return;
    seen.add(key);
    const def = cols.get(e.base);
    const k = kindOf(def);
    if (k === 'unknown') {
      unknownCount++;
      return; // skip rather than guess
    }
    const shelf = [...e.shelves];
    const baseId = e.base.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    const multiDeriv = (derivsByBase.get(e.base)?.size ?? 0) > 1;
    // OPTIONALITY — the LOD + display two-prong rule (Track 1 chunk 2). A field is optional
    // only if removing it would change NEITHER the view's level of detail NOR its display;
    // it is REQUIRED if it fails either prong. The real test is aggregation/LOD impact, NOT
    // shelf name — an aggregated dimension (attr/min/max) is LOD-neutral anywhere, while a
    // disaggregated partitioning dimension is load-bearing wherever it partitions.
    const partitioning = shelf.some((s) => !NON_PARTITIONING_SHELVES.has(s));
    // LOD prong: a DISAGGREGATED pill on a partitioning shelf adds marks → changes the grain.
    // An aggregate derivation clears this prong for free; a filter/title/tooltip-only pill
    // never partitions, so it clears it too.
    const affectsLod = !AGGREGATE_DERIVATIONS.has(e.derivation) && partitioning;
    // Display prong: a rows/cols placement always defines the chart. On an encoding-ONLY
    // chart (no bindable axis anywhere) a defining mark encoding IS the chart, so a
    // partitioning placement there defines display too. Purely non-partitioning shelves
    // (tooltip/filter/title/reference-line) never define display.
    const onAxis = shelf.includes('rows') || shelf.includes('cols');
    const definesDisplay = onAxis || (!hasAxisPlacement && partitioning);
    // TABLE-CALC upgrade (Track 1 chunk 4): a dimension an absolute-addressed calc runs ALONG
    // or RESETS on is load-bearing — drop it and the computation is undefined — so it is
    // REQUIRED and carries a tablecalc-addressing / tablecalc-partition role that overrides the
    // placement-derived one. The measure carrying the calc gets the fact attached (its
    // required/role are unchanged — placement already governs them).
    const tcRole = addressingRole.get(e.base);
    const tableCalc = tableCalcByBase.get(e.base);
    const required = affectsLod || definesDisplay || !!tcRole;
    slots.push({
      slot_id: multiDeriv ? `${baseId}_${e.derivation}` : baseId,
      sourceField: e.base,
      templateField: tokenForBase(e.base),
      caption: def?.caption ?? '',
      shelves: shelf,
      kind: k,
      ...(def?.semanticRole ? { semanticRole: def.semanticRole } : {}),
      derivation: e.derivation,
      ...(e.instanceRole ? { instanceRole: e.instanceRole } : {}),
      required,
      role: tcRole ?? communicativeRole(k, e.derivation, shelf),
      purpose: autoPurpose(k, shelf),
      tier: e.tier,
      ...(tableCalc ? { tableCalc } : {}),
    });
  };

  for (const e of emits) emit(e);

  // Build the calc contract from the placed calcs decomposed above. A decomposed leaf binds at
  // derivation `none` (the calc references its base columns row-level), so each formula ref
  // resolves to the leaf slot whose sourceField is that base AND derivation is `none` — the
  // SAME slot the emit loop produced. Deduped per DISTINCT calc base, shelves unioned. Nested
  // calcs and template-owned groups have already been resolved to terminal donor leaves; refs
  // whose leaves have unknown kinds are dropped so dependsOnSlots only names real slot ids.
  const slotIdForLeaf = (leafBase: string): string | undefined =>
    slots.find((s) => s.sourceField === leafBase && s.derivation === 'none')?.slot_id;
  const calcByBase = new Map<string, InferredCalc>();
  for (const p of placedCalcs) {
    const def = cols.get(p.base);
    if (!def) continue;
    const existing = calcByBase.get(p.base);
    if (existing) {
      existing.shelves = [...new Set([...existing.shelves, ...p.shelves])];
      continue;
    }
    const terminalInputs = terminalInputsOf(p.base);
    const dependsOnSlots = terminalInputs
      .map(slotIdForLeaf)
      .filter((id): id is string => id !== undefined);
    calcByBase.set(p.base, {
      slotId: `calc_${p.base.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`,
      templateField: p.base,
      caption: def.caption ?? '',
      formula: def.formula ?? '',
      formulaRefs: terminalInputs,
      dependsOnSlots,
      shelves: [...p.shelves],
    });
  }
  const calcs = [...calcByBase.values()];

  return {
    slots,
    calcs,
    unknownCount,
    donorCaptions: [...cols.values()].map((c) => c.caption).filter(Boolean),
    donorDatasources: [
      ...new Set(
        all('datasource')
          .map((d) => attr(d, 'caption'))
          .filter(Boolean),
      ),
    ],
    donorDatasourceNames: [
      ...new Set(
        [...all('datasource'), ...all('datasource-dependencies')]
          .map((d) => attr(d, 'name') || attr(d, 'datasource'))
          .filter(Boolean),
      ),
    ].filter((name) => name.toLowerCase() !== 'parameters'),
    version: parseBookmarkVersion(rawXml),
    hasColumnDict: cols.size > 0,
  };
}

/** `<bookmark version='…'>` — the era discriminator for the zero-slot legacy population. */
function parseBookmarkVersion(rawXml: string): string {
  return rawXml.match(/<bookmark[^>]*\bversion='([^']*)'/)?.[1] ?? '?';
}

export type TemplateBindingDescriptor = TemplateBindingContract;

/** Inferred structural binding facts consumed by the binder; no catalog or readiness policy lives here. */
export function inferBindingDescriptor(name: string, inf: Inference): TemplateBindingDescriptor {
  // A token shared by >1 slot means one base field is placed at several derivations
  // (e.g. YEAR + MONTH of one date). Those slots MUST carry qualified_key_required so the
  // binder emits `template_field@derivation` mapping keys and the rewriter resolves each
  // ref by its own date part — otherwise a single bare mapping stamps one derivation onto
  // every placement (the YEAR-twice collapse).
  const tokenCount = new Map<string, number>();
  for (const s of inf.slots)
    tokenCount.set(s.templateField, (tokenCount.get(s.templateField) ?? 0) + 1);
  const neutralSlotId = new Map<string, string>();
  const slots: SlotSpec[] = inf.slots.map((s) => {
    const tokenId = s.templateField.match(/^\{\{(field_base_[1-9]\d*)\}\}$/)?.[1];
    if (!tokenId) {
      throw new Error(
        `Inferred slot '${s.slot_id}' has non-structural field token '${s.templateField}'.`,
      );
    }
    const slotId =
      (tokenCount.get(s.templateField) ?? 0) > 1 ? `${tokenId}_${s.derivation}` : tokenId;
    neutralSlotId.set(s.slot_id, slotId);
    return {
      slot_id: slotId,
      template_field: s.templateField,
      derivation: s.derivation,
      ...(s.instanceRole ? { instance_role: s.instanceRole } : {}),
      role: s.shelves.slice(),
      communicative_role: s.role,
      kind: s.kind,
      ...(s.semanticRole ? { semantic_role: s.semanticRole } : {}),
      bindable: true,
      required: s.required,
      purpose: s.purpose,
      ...((tokenCount.get(s.templateField) ?? 0) > 1 ? { qualified_key_required: true } : {}),
      ...(s.tableCalc ? { table_calc: s.tableCalc } : {}),
    };
  });
  // Calc contract from the decomposed placed calcs. A calc is template-owned derived structure
  // (never user-bindable), declared here as a CalcSlot so the binder's calc-dependency gate
  // (Gate 6) and aggregation-level gate (Gate 4b) can fire on the pure-inferred path. The outer
  // derivation is `usr` (a user calc); depends_on_slots are the
  // already-resolved leaf slot_ids, so the calc contract is consistent with `slots` by
  // construction. `inputs` is left off — Gate 6 falls back to depends_on_slots.
  const calcs: CalcSlot[] = inf.calcs.map((c, index) => ({
    slot_id: `calc_${index + 1}`,
    template_field: c.templateField,
    derivation: 'usr',
    role: c.shelves.slice(),
    kind: 'calc',
    bindable: false,
    required: true,
    formula: c.formula,
    formula_refs: c.formulaRefs.slice(),
    depends_on_slots: c.dependsOnSlots.map((slotId) => neutralSlotId.get(slotId) ?? slotId),
  }));
  return {
    template: name,
    slots,
    calcs,
  };
}
