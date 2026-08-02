// Metadata-free slot inference from a bookmark (.tbm).
//
// Given a Desktop-saved bookmark, derive the bindable slots — WITHOUT any
// hand-authored manifest and WITHOUT any chart-specific branching. Every fact about
// a slot (kind, derivation, role, required, generic purpose) comes from the sheet's
// OWN structure: the donor `<column>` dictionary's role/datatype/semantic-role and
// the shelf the field is placed on. No template name, chart family, or concrete field
// name ever steers the logic — the same code reads a bar chart and a map identically.
//
// Ported verbatim from the proven §0 probe (scripts/local/tbmBindProbe.mts): 74/74
// modern-format bookmarks bound on two unrelated datasources with IDENTICAL slot
// structure per base (the dataset-independence proof) and ZERO donor-name leakage.

import type { Derivation, SlotKind, SlotSpec, TemplateManifest } from '../binder/manifest-types.js';
import {
  type ColumnDef,
  type Inference,
  type InferredSlot,
  parseBookmarkDom,
  parseInstanceRef,
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

/** Base columns referenced by a calc formula, skipping nested `Calculation_*` refs. */
function baseInputsOf(formula: string): string[] {
  const out = new Set<string>();
  for (const m of formula.matchAll(/\[([^\]]+)\]/g)) {
    if (/^Calculation_/i.test(m[1])) continue;
    out.add(m[1]);
  }
  return [...out];
}

/**
 * GENERIC purpose from kind + shelf position. MUST never contain the donor field's
 * name — this is the "expose a semantic derivation, not a concrete field" requirement,
 * enforced mechanically by the probe's zero-leakage assertion.
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
 * Shelves that DECORATE or REFINE a mark rather than define it. A field placed only on
 * one of these is genuinely optional even on an encoding-only chart — dropping a tooltip
 * field, a filter pill, a title run, or a reference line never changes what the chart IS.
 * Every other encoding shelf (color / size / text / detail / lod / shape / angle …) is a
 * DEFINING encoding on a chart with no rows/cols axis, so it must be required (a pie with
 * no wedge-size or a treemap with no size/color is not that chart at all). Kept as a tiny
 * closed set, read structurally — no branch on chart family. `label` and `path` are treated
 * as defining (a line/label chart needs them).
 *
 * NOTE: this is the interim optionality heuristic; the LOD+display two-prong rule (Track 1
 * chunk 2) supersedes it. Keep the refinement sites here so the interim `required` stays
 * correct — a field seen only in a filter/title/reference-line is not what the chart is.
 */
const INCIDENTAL_SHELVES = new Set<Shelf>(['tooltip', 'filter', 'title', 'reference-line']);

/**
 * Derive the bindable slots (and the donor facts a caller needs to tokenize + audit)
 * from a raw bookmark. Reads the `<column>` dictionary for kinds, walks the
 * rows/cols/mark encodings for placement, and decomposes placed calcs to their base
 * inputs. `kind: 'unknown'` fields are SKIPPED (counted, never guessed).
 */
export function inferFromBookmark(rawXml: string): Inference {
  const { all, attr } = parseBookmarkDom(rawXml);

  const cols = new Map<string, ColumnDef>();
  for (const c of all('column')) {
    const name = attr(c, 'name');
    if (!name) continue;
    const key = name.replace(/^\[|\]$/g, '');
    const calcEl = Array.from(c.getElementsByTagName('calculation'))[0] as Element | undefined;
    const formula = calcEl ? attr(calcEl, 'formula') : '';
    const prev = cols.get(key);
    cols.set(key, {
      name: key,
      caption: attr(c, 'caption') || prev?.caption || '',
      datatype: attr(c, 'datatype') || prev?.datatype || '',
      role: attr(c, 'role') || prev?.role || '',
      type: attr(c, 'type') || prev?.type || '',
      semanticRole: attr(c, 'semantic-role') || prev?.semanticRole || '',
      isCalc: !!calcEl || !!prev?.isCalc,
      formula: formula || prev?.formula || '',
      baseInputs: formula ? baseInputsOf(formula) : (prev?.baseInputs ?? []),
    });
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
    if (isPseudo(base)) return;
    const key = pairKey(base, derivation);
    const cur = byPair.get(key);
    if (cur) {
      cur.shelves.add(shelf);
      return;
    }
    const p: Placement = {
      base,
      derivation,
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
    for (const el of all(tag)) addFromText(el, tag);
  }

  // 2. MARK-ENCODING shelves (color/size/text/lod/detail/tooltip/shape/…): ref in a `column`
  // attribute on a child of `<encodings>`, and the child's TAG NAME is the shelf. An
  // encoding-only chart (treemap, pie, symbol map) places EVERY field here and nothing on
  // rows/cols, so without this walk it inferred ZERO slots. Walked AFTER the axis shelves so
  // token numbering stays stable for the axis-first common case.
  for (const enc of all('encodings')) {
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
  for (const f of all('filter')) {
    const ref = attr(f, 'column');
    if (ref) addRef(ref, 'filter');
  }
  for (const sl of all('slices')) {
    for (const c of Array.from(sl.getElementsByTagName('column')) as unknown as Element[]) {
      addFromText(c, 'filter');
    }
  }
  for (const rl of all('reference-line')) {
    for (const a of ['axis-column', 'value-column']) {
      const ref = attr(rl, a);
      if (ref) addRef(ref, 'reference-line');
    }
  }
  for (const t of all('title')) addFromText(t, 'title');
  for (const cl of all('customized-label')) addFromText(cl, 'label');

  // Expand placements to the (base, derivation) pairs actually emitted: direct
  // placements first (encoding order), then each calc's base-input leaves — preserving
  // the prior placed-then-calcs ordering so token numbering is stable for the common
  // single-derivation case. A placed CALC is decomposed to its base-column leaves; each
  // leaf becomes a bindable slot and the calc itself is fixed derived structure.
  interface Emit {
    base: string;
    derivation: Derivation;
    shelves: Set<Shelf>;
    tier: 'primary' | 'advanced';
  }
  const emits: Emit[] = placed.map((p) => ({
    base: p.base,
    derivation: p.derivation,
    shelves: p.shelves,
    tier: 'primary' as const,
  }));
  for (const p of placedCalcs) {
    const def = cols.get(p.base);
    if (!def) continue;
    for (const leaf of def.baseInputs) {
      emits.push({ base: leaf, derivation: p.derivation, shelves: p.shelves, tier: 'primary' });
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
    // Required when the field sits on an axis, OR — on an encoding-only chart (no
    // rows/cols anywhere) — when it defines a mark encoding (any shelf that is not purely
    // incidental like tooltip). Otherwise it is an optional refinement.
    const onAxis = shelf.includes('rows') || shelf.includes('cols');
    const required =
      onAxis || (!hasAxisPlacement && !shelf.every((s) => INCIDENTAL_SHELVES.has(s)));
    slots.push({
      slot_id: multiDeriv ? `${baseId}_${e.derivation}` : baseId,
      sourceField: e.base,
      templateField: tokenForBase(e.base),
      caption: def?.caption ?? '',
      shelves: shelf,
      kind: k,
      derivation: e.derivation,
      required,
      purpose: autoPurpose(k, shelf),
      tier: e.tier,
    });
  };

  for (const e of emits) emit(e);

  return {
    slots,
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
    ],
    version: parseBookmarkVersion(rawXml),
    hasColumnDict: cols.size > 0,
  };
}

/** `<bookmark version='…'>` — the era discriminator for the zero-slot legacy population. */
function parseBookmarkVersion(rawXml: string): string {
  return rawXml.match(/<bookmark[^>]*\bversion='([^']*)'/)?.[1] ?? '?';
}

/**
 * Inferred slots → an in-memory TemplateManifest. `template_field` is the SAME
 * {{field_base_N}} token bookmarkToTemplateWorkbook writes, numbered in encoding
 * order, so the manifest and the tokenized XML come from one pass and agree exactly.
 * `derivation` is carried through because the binder keys qualified slots on it.
 *
 * The readiness/portability fields are the honest UNVERIFIED defaults for a freshly
 * inferred template (YELLOW, not fast-path eligible, render_verified 'none'); a curated
 * manifest overlay upgrades them where a human has done the verification.
 */
export function synthesizeManifest(name: string, inf: Inference): TemplateManifest {
  // A token shared by >1 slot means one base field is placed at several derivations
  // (e.g. YEAR + MONTH of one date). Those slots MUST carry qualified_key_required so the
  // binder emits `template_field@derivation` mapping keys and the rewriter resolves each
  // ref by its own date part — otherwise a single bare mapping stamps one derivation onto
  // every placement (the YEAR-twice collapse).
  const tokenCount = new Map<string, number>();
  for (const s of inf.slots)
    tokenCount.set(s.templateField, (tokenCount.get(s.templateField) ?? 0) + 1);
  const slots: SlotSpec[] = inf.slots.map((s) => {
    // Suggestion hint: the donor's caption when it carried one, else the base field name.
    // ~41/44 Superstore-derived bookmarks carry no caption, so sourceField is the real hint.
    const hint = s.caption || s.sourceField;
    return {
      slot_id: s.slot_id,
      template_field: s.templateField,
      derivation: s.derivation,
      role: s.shelves.slice(),
      kind: s.kind,
      bindable: true,
      required: s.required,
      purpose: s.purpose,
      ...(hint ? { hint } : {}),
      ...((tokenCount.get(s.templateField) ?? 0) > 1 ? { qualified_key_required: true } : {}),
    };
  });
  return {
    template: name,
    family: 'specialized',
    readiness: 'YELLOW',
    fast_path_eligible: false,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: false, render_verified: 'none' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: [],
    description: `Inferred from bookmark ${name}`,
    slots,
    calcs: [],
    hazards: [],
  };
}
