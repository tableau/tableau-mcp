// src/binder/validate.ts
//
// Tier-1 fast-path binder — the deterministic validation gate (design doc §2.4).
//
// `validateBinding(manifest, proposal, schema)` is PURE (no I/O): it takes a
// proposed slot→field mapping and either returns the exact `field_mapping` the
// injector (`replaceFieldReferences`, src/server/tools/templates.ts) needs, or a
// list of blockers describing why the fast path must escalate. It runs gates 1–7
// in order:
//
//   1. slot coverage        — every required+bindable slot bound exactly once;
//                             no binding targets an unknown / non-bindable slot.
//   2. field resolves       — each field resolves to exactly one schema field
//                             (ambiguous / not_found ⇒ escalate, carrying candidates).
//   3. kind/role compat     — resolved field's role/type/datatype fits slot.kind.
//   4. derivation legality  — temporal derivations only on date/datetime;
//                             aggregations only on numeric; an aggregated calc
//                             forces `usr` and forbids re-aggregation.
//   5. base-column consistency — all slots sharing a template_field must resolve
//                             to the SAME base column, else replaceFieldReferences
//                             would throw (templates.ts:145-162); pre-fail here.
//   6. calc dependency closure — every calc's depends_on_slots is a bound slot.
//   7. emit                 — build the column-instance value FROM the slot's
//                             derivation (qualified key `Field@deriv` when reused).
//
// Field resolution runs against the SchemaSummary (itself derived from
// `listAvailableFields`, the same source `resolveField` uses), so the gate is a
// pure function of (manifest, proposal, schema) and every gate has a
// deterministic fire / no-fire outcome — mirroring the planner's no-guessing
// block (coordination.ts:185-303) without needing the raw workbook XML.

import Fuse from 'fuse.js';

import { COLUMN_REF_REGEX } from '../metadata/field-resolver.js';
import type { DateparseAxisSpec } from '../templates/dateparseTemporalAxis.js';
import type { OptionalFieldPruneSpec } from '../templates/optionalFieldPrune.js';
import { matchAvoidWhen } from './classify.js';
import { escapeXml } from './escape.js';
import type {
  BlockerCode,
  CalcSlot,
  Derivation,
  SlotSpec,
  TemplateManifest,
} from './manifest-types.js';
import { bareName, type SchemaField, type SchemaSummary } from './schema-summary.js';
import { inferStringTemporal } from './stringTemporal.js';

/**
 * A proposed template + slot→field mapping (the small-LLM / no-LLM output).
 *
 * `derivation` on a binding is an OPTIONAL per-slot override of the manifest's
 * authored derivation. Manifest derivations are the TEMPLATE's defaults, not the
 * user's intent — set an override ONLY when the ask explicitly requests an
 * aggregation/date grain different from the template default (e.g. the ask says
 * "average" but the template slot is authored as sum). The override is gated for
 * legality against the resolved field's datatype (gate 4) exactly like a template
 * default, and emitted in the field_mapping value on success (gate 7).
 */
/**
 * A declarative interactive dimension filter (m7 order-of-operations). `field` is a
 * NAME from SchemaSummary.fields. `context: true` marks it a CONTEXT filter — Tableau
 * order-of-operations step 3, which runs BEFORE a Top-N dimension filter (step 4), so a
 * "top N of A within an interactively-selected B" bind ranks WITHIN the selected B rather
 * than globally-then-filtering. `values` is OPTIONAL: when the ask names no member (m7:
 * "let me filter down to one region"), the apply path emits an enumerate-all interactive
 * control (function="level-members" + user:ui-enumeration="all"), not a member list.
 */
export interface FilterSpec {
  field: string; // a NAME from SchemaSummary.fields
  values?: string[];
  context?: boolean;
}

export interface BindingProposal {
  template: string;
  title: string;
  bindings: Array<{ slot_id: string; field: string; derivation?: Derivation }>; // field = a NAME from SchemaSummary.fields
  sort?: { by: string; direction: 'asc' | 'desc' };
  top_n?: number;
  filters?: FilterSpec[];
  confidence?: number;
}

/** The gate-specific escalation reasons (design §3.2). */
export type EscalateReason =
  | 'template-not-found'
  | 'not-fast-path'
  | 'missing-required-slot'
  | 'ambiguous-field'
  | 'field-not-found'
  | 'kind-mismatch'
  | 'derivation-illegal'
  | 'base-column-conflict'
  | 'cross-datasource-binding'
  | 'calc-dependency-unmet'
  | 'low-confidence'
  // M10 Finding 3: the ask's schema exceeds MAX_CLASSIFIABLE_FIELDS, so the no-LLM
  // classifier fails closed (never classifies a truncated subset) and escalates to
  // the general authoring flow rather than risk a silent wrong bind.
  | 'schema-too-large';

export interface Blocker {
  code: EscalateReason | BlockerCode;
  slot_id?: string;
  detail: string;
  candidates?: string[];
}

export type ValidateResult =
  | {
      ok: true;
      datasource: string;
      field_mapping: Record<string, string>;
      warnings?: string[];
      /** temporal_axis_from_string: the apply-side DATEPARSE splice spec, when a temporal
       * slot accepted a date-like string source (undefined for every normal bind). */
      dateparse_axis?: DateparseAxisSpec;
      /** Manifest-approved optional template refs to remove when their slots are unbound. */
      optional_field_prunes?: OptionalFieldPruneSpec[];
    }
  | { ok: false; blockers: Blocker[] };

// Derivation short-forms that are only legal over date/datetime fields.
const TEMPORAL_DERIVATIONS: ReadonlySet<string> = new Set([
  'yr',
  'qr',
  'mn',
  'wk',
  'dy',
  'hr',
  'mi',
  'sc',
  'tyr',
  'tqr',
  'tmn',
  'tdy',
]);

// Date-TRUNCATION derivations. Unlike discrete date parts (yr/qr/mn/…), a
// truncation yields a continuous date value, so its column-instance pivot is
// always the continuous ':qk' the templates author — independent of the source
// field's `type` (a top-level date dimension is frequently type="ordinal").
// Month-Trunc is 'tmn' (the real short-form Tableau writes), not the legacy 'tmo'.
const TRUNCATION_DERIVATIONS: ReadonlySet<string> = new Set(['tyr', 'tqr', 'tmn', 'tdy']);

// Derivation short-forms that aggregate a numeric measure.
const AGGREGATION_DERIVATIONS: ReadonlySet<string> = new Set([
  'sum',
  'avg',
  'cnt',
  'cntd',
  'median',
  'min',
  'max',
  'attr',
]);

const NUMERIC_DATATYPES: ReadonlySet<string> = new Set(['integer', 'real']);
const TEMPORAL_DATATYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

// Aggregations that are ALSO legal over a date/datetime field. MIN/MAX of a date are
// real Tableau aggregations (earliest/latest date, a continuous green pill) — e.g.
// gantt-task-rollup-chart authors MIN on its DATE start_date slot. The other
// aggregations (sum/avg/count/median) stay numeric-only. Scoped to temporal datatypes
// only; MIN/MAX on a plain string dimension remains illegal (unchanged).
const TEMPORAL_MINMAX_DERIVATIONS: ReadonlySet<string> = new Set(['min', 'max']);

// Geo semantic-role concept check (red-team GEO-02). MIRRORS the private
// tables in hash-gated src/desktop/binder/classify.ts (geoConceptFromSlotId /
// GEO_SEMANTIC_ROLE_CONCEPT) — they are intentionally not exported because this
// port must keep lockstep-core bytes unchanged.
type GeoConcept = 'country' | 'state' | 'city' | 'zip';

const GEO_TOKEN_CONCEPT: Readonly<Record<string, GeoConcept>> = {
  country: 'country',
  nation: 'country',
  state: 'state',
  province: 'state',
  region: 'state',
  admin: 'state',
  city: 'city',
  zip: 'zip',
  zipcode: 'zip',
  postal: 'zip',
};

const GEO_SEMANTIC_ROLE_CONCEPT: Readonly<Record<string, GeoConcept>> = {
  '[Country].[ISO3166_2]': 'country',
  '[Country].[Name]': 'country',
  '[State].[Name]': 'state',
  '[City].[Name]': 'city',
  '[ZipCode].[Name]': 'zip',
};

function geoNameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function geoConceptFromSlotId(slotId: string): GeoConcept | null {
  for (const t of geoNameTokens(slotId)) {
    const concept = GEO_TOKEN_CONCEPT[t];
    if (concept) return concept;
  }
  return null;
}

function geoConceptFromSemanticRole(semanticRole?: string): GeoConcept | null {
  if (!semanticRole) return null;
  return GEO_SEMANTIC_ROLE_CONCEPT[semanticRole] ?? null;
}

/**
 * A geo slot must not bind a field whose Tableau semantic role names a
 * DIFFERENT geo concept — a [City].[Name]-tagged field can't fill a
 * state/province slot no matter what its name suggests. Fires only when BOTH
 * concepts are known; an untagged field or exotic slot keeps today's
 * dimension-only acceptance.
 */
function geoConceptMismatch(
  slot: SlotSpec,
  f: SchemaField,
): { slotConcept: GeoConcept; fieldConcept: GeoConcept } | null {
  if (slot.kind !== 'geo') return null;
  const slotConcept = geoConceptFromSlotId(slot.slot_id);
  const fieldConcept = geoConceptFromSemanticRole(f.semanticRole);
  if (!slotConcept || !fieldConcept || slotConcept === fieldConcept) return null;
  return { slotConcept, fieldConcept };
}

/** Column-instance type suffix (field-resolver.ts:107-112 / field-builder.ts:408-410). */
function typeSuffixFor(type: string): string {
  if (type === 'quantitative') return 'qk';
  if (type === 'ordinal') return 'ok';
  return 'nk';
}

/**
 * Pivot suffix for the emitted column-instance value. A date TRUNCATION is
 * continuous and must carry ':qk' (the authored template pivot), regardless of
 * the source field's `type` — otherwise an ordinal date dimension drifts a
 * tmn/tqr/tdy slot to ':ok', diverging from the template contract (P1-3).
 * Every other derivation (aggregations, dimensions, discrete date parts) keeps
 * the field-type rule.
 */
function suffixFor(derivation: string, type: string): string {
  if (TRUNCATION_DERIVATIONS.has(derivation)) return 'qk';
  return typeSuffixFor(type);
}

interface Resolution {
  kind: 'exact' | 'rewritten' | 'ambiguous' | 'not_found';
  field?: SchemaField;
  candidates?: SchemaField[];
  notes?: string[];
}

function displayName(f: SchemaField): string {
  return f.caption ?? bareName(f.columnName);
}

function numericSuffixParts(name: string): { base: string; suffix: string | null } {
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match || match[1].length === 0) return { base: name, suffix: null };
  return { base: match[1], suffix: match[2] };
}

function nearDuplicateNote(fields: SchemaField[], chosen: SchemaField): string | undefined {
  const chosenName = displayName(chosen);
  const chosenParts = numericSuffixParts(chosenName);
  const family = fields.filter((candidate) => {
    if (candidate.datasource !== chosen.datasource) return false;
    const candidateName = displayName(candidate);
    const candidateParts = numericSuffixParts(candidateName);
    return candidateParts.base === chosenParts.base;
  });
  if (family.length < 2 || !family.some((candidate) => candidate !== chosen)) return undefined;

  const names = [...new Set(family.map(displayName))].sort((a, b) => {
    const aSuffix = numericSuffixParts(a).suffix;
    const bSuffix = numericSuffixParts(b).suffix;
    if (aSuffix === null && bSuffix !== null) return -1;
    if (aSuffix !== null && bSuffix === null) return 1;
    return a.localeCompare(b);
  });
  return `dataset has near-duplicate columns ${names.join('/')} - used ${chosenName}; consider cleaning the source`;
}

function exactWithNotes(fields: SchemaField[], field: SchemaField): Resolution {
  const note = nearDuplicateNote(fields, field);
  return { kind: 'exact', field, ...(note ? { notes: [note] } : {}) };
}

function rewrittenWithNotes(fields: SchemaField[], field: SchemaField): Resolution {
  const note = nearDuplicateNote(fields, field);
  return { kind: 'rewritten', field, ...(note ? { notes: [note] } : {}) };
}

function disambiguateRanked(
  candidates: SchemaField[],
  query: string,
  fields: SchemaField[],
): Resolution | null {
  const captionMatches = candidates.filter((f) => f.caption === query);
  if (captionMatches.length === 1) return exactWithNotes(fields, captionMatches[0]);

  const parts = candidates.map((candidate) => ({
    candidate,
    parts: numericSuffixParts(displayName(candidate)),
  }));
  const bases = new Set(parts.map(({ parts: p }) => p.base));
  const unsuffixed = parts.filter(({ parts: p }) => p.suffix === null);
  const suffixed = parts.filter(({ parts: p }) => p.suffix !== null);
  if (bases.size === 1 && unsuffixed.length === 1 && suffixed.length > 0) {
    return exactWithNotes(fields, unsuffixed[0].candidate);
  }

  return null;
}

/**
 * Resolve a proposed field NAME against the schema summary. Mirrors
 * `resolveField`'s outcome semantics (exact → rewritten → ambiguous → not_found)
 * but returns the matched SchemaField directly, so gates 3/4/7 have the resolved
 * field's role/type/datatype/isAggregated (which `resolveField` does not expose).
 */
export function resolveInSummary(s: SchemaSummary, query: string): Resolution {
  const q = query.trim();
  if (!q) return { kind: 'not_found', candidates: [] };
  const qBare = bareName(q);

  // Exact column_ref is already datasource-qualified, so resolve it before names/captions.
  const refMatches = s.fields.filter((f) => f.column_ref === q);
  if (refMatches.length === 1) return exactWithNotes(s.fields, refMatches[0]);
  if (refMatches.length > 1) return { kind: 'ambiguous', candidates: refMatches };
  if (COLUMN_REF_REGEX.test(q)) return { kind: 'not_found', candidates: [] };

  // Phase 1: exact (case-sensitive) on friendly name, caption, or bare column name.
  const exact = s.fields.filter(
    (f) => f.name === q || f.caption === q || bareName(f.columnName) === qBare,
  );
  if (exact.length === 1) return exactWithNotes(s.fields, exact[0]);
  if (exact.length > 1) {
    const ranked = disambiguateRanked(exact, q, s.fields);
    return ranked ?? { kind: 'ambiguous', candidates: exact };
  }

  // Phase 2: case-insensitive bare match (classifier/agent may vary casing).
  const qi = q.toLowerCase();
  const ci = s.fields.filter(
    (f) =>
      f.name.toLowerCase() === qi ||
      (f.caption ? f.caption.toLowerCase() === qi : false) ||
      bareName(f.columnName).toLowerCase() === qBare.toLowerCase(),
  );
  if (ci.length === 1) return rewrittenWithNotes(s.fields, ci[0]);
  if (ci.length > 1) {
    const ranked = disambiguateRanked(ci, q, s.fields);
    return ranked ?? { kind: 'ambiguous', candidates: ci };
  }

  // Phase 3: fuzzy did-you-mean (mirrors resolveField's Fuse fallback).
  const fuse = new Fuse(s.fields, {
    keys: ['name', 'caption', 'columnName'],
    threshold: 0.4,
    includeScore: true,
  });
  const fuzzy = fuse
    .search(q)
    .slice(0, 5)
    .map((r) => r.item);
  return { kind: 'not_found', candidates: fuzzy };
}

/** Does the resolved field satisfy the slot's kind? (design §2.4 gate 3.) */
function kindCompatible(kind: SlotSpec['kind'], f: SchemaField): boolean {
  switch (kind) {
    case 'quantitative':
      return f.role === 'measure' || f.isAggregated;
    case 'categorical':
      return f.role === 'dimension' && (f.type === 'nominal' || f.type === 'ordinal');
    case 'temporal':
      return TEMPORAL_DATATYPES.has(f.datatype);
    case 'geo':
      return f.role === 'dimension';
    // calc / generated / pseudo / parameter are never user-bindable and are
    // rejected in gate 1 before reaching here.
    default:
      return false;
  }
}

function optionalFieldPrunesFor(
  manifest: TemplateManifest,
  resolved: Map<string, { slot: SlotSpec; field: SchemaField }>,
): OptionalFieldPruneSpec[] {
  return manifest.slots
    .filter(
      (slot) =>
        slot.bindable &&
        !slot.required &&
        slot.kind === 'geo' &&
        slot.role.includes('lod') &&
        !resolved.has(slot.slot_id),
    )
    .map((slot) => ({
      templateField: slot.template_field,
      derivation: slot.derivation,
      role: 'nk',
    }));
}

/**
 * `ask` is optional advisory context: when provided, avoid_when entries whose
 * terms overlap the ask are attached to a successful result as `warnings` (never
 * as blockers). Omitting `ask` leaves the result unchanged (no warnings), so
 * every existing caller keeps its exact behavior.
 */
export function validateBinding(
  m: TemplateManifest,
  p: BindingProposal,
  s: SchemaSummary,
  ask?: string,
): ValidateResult {
  const blockers: Blocker[] = [];
  const resolutionNotes: string[] = [];

  const slotById = new Map<string, SlotSpec>();
  for (const slot of m.slots) slotById.set(slot.slot_id, slot);
  const calcById = new Map<string, CalcSlot>();
  for (const c of m.calcs) calcById.set(c.slot_id, c);

  // Index the proposed bindings by slot_id (last wins if duplicated).
  const boundBySlot = new Map<string, string>();
  const overrideBySlot = new Map<string, Derivation>(); // optional per-slot derivation override
  for (const b of p.bindings) {
    boundBySlot.set(b.slot_id, b.field);
    if (b.derivation !== undefined) overrideBySlot.set(b.slot_id, b.derivation);
  }

  // ── Gate 1: slot coverage ────────────────────────────────────────
  for (const slot of m.slots) {
    if (slot.required && slot.bindable && !boundBySlot.has(slot.slot_id)) {
      blockers.push({
        code: 'missing-required-slot',
        slot_id: slot.slot_id,
        detail: `required slot '${slot.slot_id}' (${slot.template_field}) has no binding`,
      });
    }
  }
  for (const b of p.bindings) {
    const slot = slotById.get(b.slot_id);
    if (!slot) {
      // Binding to a calc slot or a wholly unknown slot_id.
      const detail = calcById.has(b.slot_id)
        ? `slot '${b.slot_id}' is a template-owned calc and is not user-bindable`
        : `binding names unknown slot_id '${b.slot_id}'`;
      blockers.push({ code: 'kind-mismatch', slot_id: b.slot_id, detail });
    } else if (!slot.bindable) {
      blockers.push({
        code: 'kind-mismatch',
        slot_id: b.slot_id,
        detail: `slot '${b.slot_id}' (kind ${slot.kind}) is not user-bindable`,
      });
    }
  }

  // ── Gates 2–4 per bound, bindable slot ───────────────────────────
  // Track the resolved base column per binding for gates 5 and 7.
  const resolved = new Map<string, { slot: SlotSpec; field: SchemaField }>();
  // temporal_axis_from_string: set when a temporal slot accepts a date-like string
  // via DATEPARSE. The apply-side splice owns that slot's XML, so gate 7 skips its
  // field_mapping key and the result carries the axis spec to injectTemplateCore.
  let dateparseAxis: DateparseAxisSpec | undefined;
  let dateparseAxisSlotId: string | undefined;
  for (const [slotId, fieldQuery] of boundBySlot) {
    const slot = slotById.get(slotId);
    if (!slot || !slot.bindable) continue; // gate 1 already recorded these

    // Gate 2: field resolves.
    const r = resolveInSummary(s, fieldQuery);
    if (r.kind === 'ambiguous') {
      blockers.push({
        code: 'ambiguous-field',
        slot_id: slotId,
        detail: `"${fieldQuery}" matches ${r.candidates?.length ?? 0} fields; disambiguate before binding`,
        candidates: (r.candidates ?? []).map((c) => c.column_ref),
      });
      continue;
    }
    if (r.kind === 'not_found' || !r.field) {
      blockers.push({
        code: 'field-not-found',
        slot_id: slotId,
        detail: `no field named "${fieldQuery}" in datasource(s)`,
        candidates: (r.candidates ?? []).map((c) => c.column_ref),
      });
      continue;
    }
    resolutionNotes.push(...(r.notes ?? []));
    const f = r.field;

    // Gate 3: kind/role compatibility.
    if (!kindCompatible(slot.kind, f)) {
      // temporal_axis_from_string: a temporal slot that opted in accepts a date-like
      // STRING field, which the apply-side DATEPARSE splice turns into a real date
      // (see dateparseTemporalAxis.ts). Only when the slot opts in AND the string
      // field's name is date-like (inferStringTemporal, fail-closed) — otherwise the
      // kind-mismatch stands unchanged.
      if (slot.kind === 'temporal' && slot.temporal_from_string) {
        const inf = inferStringTemporal(f);
        if (inf) {
          dateparseAxis = {
            templateField: slot.template_field,
            sourceField: bareName(f.columnName),
            format: inf.format,
          };
          dateparseAxisSlotId = slotId;
          resolved.set(slotId, { slot, field: f });
          continue; // accepted via dateparse — skip the kind-mismatch blocker
        }
      }
      blockers.push({
        code: 'kind-mismatch',
        slot_id: slotId,
        detail:
          `slot '${slotId}' expects ${slot.kind} but "${fieldQuery}" is ` +
          `role=${f.role}, type=${f.type}, datatype=${f.datatype}`,
      });
      continue;
    }

    // Gate 3b: geo semantic-role concept (red-team GEO-02) — the deterministic
    // path already enforces this in pickGeoField; the validate leg must too or
    // a City-tagged field can bind a state slot via Call-2.
    const geoMismatch = geoConceptMismatch(slot, f);
    if (geoMismatch) {
      blockers.push({
        code: 'kind-mismatch',
        slot_id: slotId,
        detail:
          `slot '${slotId}' expects geo concept ${geoMismatch.slotConcept} but "${fieldQuery}" is tagged ` +
          `semanticRole=${f.semanticRole} (${geoMismatch.fieldConcept})`,
      });
      continue;
    }

    // Gate 4: derivation legality per datatype, evaluated on the EFFECTIVE
    // derivation (an optional per-slot override, else the manifest default). An
    // aggregated calc forces `usr` (handled in gate 7) and bypasses legality
    // entirely. An illegal override yields a teaching blocker so the caller
    // knows why the requested aggregation/grain cannot apply.
    const override = overrideBySlot.get(slotId);
    const effDeriv = override ?? slot.derivation;
    const src = override !== undefined ? 'requested override' : 'template derivation';
    if (!f.isAggregated) {
      if (TEMPORAL_DERIVATIONS.has(effDeriv) && !TEMPORAL_DATATYPES.has(f.datatype)) {
        blockers.push({
          code: 'derivation-illegal',
          slot_id: slotId,
          detail:
            `date-grain ${src} '${effDeriv}' requires a date/datetime field, but "${fieldQuery}" ` +
            `is ${f.datatype}. Date parts (year/quarter/month/…) apply only to date/datetime fields — ` +
            'bind a date field or drop the derivation override.',
        });
        continue;
      }
      // MIN/MAX over a date/datetime field is legal (earliest/latest date), so the
      // numeric-measure requirement is waived for that temporal case; every other
      // aggregation still requires a numeric measure.
      const temporalMinMaxOk =
        TEMPORAL_MINMAX_DERIVATIONS.has(effDeriv) && TEMPORAL_DATATYPES.has(f.datatype);
      if (
        AGGREGATION_DERIVATIONS.has(effDeriv) &&
        !(NUMERIC_DATATYPES.has(f.datatype) || f.role === 'measure') &&
        !temporalMinMaxOk
      ) {
        blockers.push({
          code: 'derivation-illegal',
          slot_id: slotId,
          detail:
            `aggregation ${src} '${effDeriv}' requires a numeric measure, but "${fieldQuery}" is ` +
            `role=${f.role}, datatype=${f.datatype}. Aggregations (sum/avg/median/count) apply only ` +
            'to numeric measures (min/max also apply to date/datetime fields) — bind a numeric ' +
            'measure or drop the derivation override.',
        });
        continue;
      }
    }

    resolved.set(slotId, { slot, field: f });
  }

  // ── Gate 5: base-column consistency ──────────────────────────────
  // All slots sharing a template_field must resolve to the same base column.
  const byTemplateField = new Map<string, Set<string>>();
  for (const { slot, field } of resolved.values()) {
    const bases = byTemplateField.get(slot.template_field) ?? new Set<string>();
    bases.add(bareName(field.columnName));
    byTemplateField.set(slot.template_field, bases);
  }
  for (const [templateField, bases] of byTemplateField) {
    if (bases.size > 1) {
      blockers.push({
        code: 'base-column-conflict',
        detail:
          `template field '${templateField}' resolves to multiple base columns ` +
          `(${[...bases].map((b) => `[${b}]`).join(', ')}); all derivations of one ` +
          'template field must map to the same base column',
      });
    }
  }

  // ── Gate 5b: single-datasource closure ───────────────────────────
  // The injector substitutes ONE {{DATASOURCE}} and rewrites every mapped field
  // onto it (templates.ts strips each value's datasource prefix, then step 4/5
  // rewrite all refs with the single `datasourceName`). If bound fields resolve
  // to different datasources, the fast path would silently repoint the
  // secondary-datasource fields onto the primary — fail closed instead.
  const fieldsByDatasource = new Map<string, string[]>();
  for (const { field } of resolved.values()) {
    const list = fieldsByDatasource.get(field.datasource) ?? [];
    list.push(bareName(field.columnName));
    fieldsByDatasource.set(field.datasource, list);
  }
  if (fieldsByDatasource.size > 1) {
    const breakdown = [...fieldsByDatasource.entries()]
      .map(([ds, cols]) => `${ds} (${cols.map((c) => `[${c}]`).join(', ')})`)
      .join('; ');
    blockers.push({
      code: 'cross-datasource-binding',
      detail:
        `bound fields resolve to multiple datasources — ${breakdown}. The fast-path ` +
        'injector substitutes a single {{DATASOURCE}} and rewrites every field onto ' +
        'it, so a mixed-datasource binding would silently repoint fields to the wrong ' +
        'datasource. Bind all fields from one datasource, or build a data-model ' +
        'relationship/blend and bind within the primary datasource.',
    });
  }

  // ── Gate 6: calc dependency closure ──────────────────────────────
  // Prefer the first-class `inputs` contract (H3): each REQUIRED, slot-referencing
  // input must resolve to a bound bindable slot, else the calc's formula ref would
  // dangle after rewriteFormulaFieldRefs. Template-INTERNAL inputs (the template
  // owns the field) are not user-bound and never block here. Legacy/opaque calc
  // entries with no derived inputs fall back to `depends_on_slots`.
  for (const calc of m.calcs) {
    const checkDep = (dep: string, refLabel: string): void => {
      const depSlot = slotById.get(dep);
      if (!depSlot || !depSlot.bindable || !resolved.has(dep)) {
        blockers.push({
          code: 'calc-dependency-unmet',
          slot_id: calc.slot_id,
          detail: `calc '${calc.slot_id}' ${refLabel} resolves to slot '${dep}', which is not bound; ${calc.template_field} would dangle`,
        });
      }
    };
    if (Array.isArray(calc.inputs) && calc.inputs.length > 0) {
      for (const input of calc.inputs) {
        if (!input.required || input.template_internal || input.slot_id === null) continue;
        checkDep(input.slot_id, `input [${input.ref}]`);
      }
    } else {
      for (const dep of calc.depends_on_slots) checkDep(dep, 'dependency');
    }
  }

  if (blockers.length > 0) return { ok: false, blockers };

  // ── Gate 7: emit the field_mapping ───────────────────────────────
  const field_mapping: Record<string, string> = {};
  let datasource = s.datasource;
  let first = true;
  for (const slot of m.slots) {
    if (!slot.bindable) continue;
    // The dateparse-axis slot is resolved entirely by the apply-side splice (it
    // rewrites the template's temporal base column into a DATEPARSE calc), so it must
    // NOT emit a field_mapping key — the core rewrite must leave [templateField] alone.
    if (slot.slot_id === dateparseAxisSlotId) continue;
    const entry = resolved.get(slot.slot_id);
    if (!entry) continue; // optional unbound slot
    const f = entry.field;
    // Emit the EFFECTIVE derivation in the VALUE: an aggregated calc forces `usr`;
    // otherwise a legal per-slot override wins over the manifest default. The
    // qualified KEY stays at the template's AUTHORED derivation (slot.derivation)
    // so the injector still matches the template instance it identifies — the
    // override changes the resolved value, not which instance is targeted.
    const override = overrideBySlot.get(slot.slot_id);
    const deriv = f.isAggregated ? 'usr' : (override ?? slot.derivation);
    // Suffix follows the EFFECTIVE derivation, not the field type alone: a date
    // truncation is continuous (':qk') even on an ordinal date field (P1-3).
    const suffix = suffixFor(deriv, f.type);
    const key = slot.qualified_key_required
      ? `${slot.template_field}@${slot.derivation}`
      : slot.template_field;
    // SECURITY (M10 Finding 1): the VALUE is substituted verbatim into a template XML
    // attribute, and both datasource + column name are workbook-controlled — escape the
    // five XML metachars EXACTLY ONCE, here at production. The KEY is the manifest's
    // template_field (trusted, shape-validated) and is NOT escaped. Tableau field-ref
    // brackets carry no metachars, so a clean value stays byte-identical.
    field_mapping[key] = escapeXml(
      `[${f.datasource}].[${deriv}:${bareName(f.columnName)}:${suffix}]`,
    );
    if (first) {
      datasource = f.datasource;
      first = false;
    }
  }

  // Advisory cautions: surface any avoid_when guidance whose terms match the ask
  // as WARNINGS on the bound result. These NEVER block — the model (or the
  // no-LLM path that reached here) has already committed to this template; the
  // warning rides along so the caller sees the anti-pattern it chose.
  const warnings = [
    ...resolutionNotes,
    ...(ask ? matchAvoidWhen(ask, m.avoid_when, m.intent_keywords) : []),
  ];
  // The datasource is workbook-controlled and flows verbatim into {{DATASOURCE}} (an XML
  // attribute), so escape it here at production alongside the field_mapping values —
  // escaped exactly once (validateAndBuild consumes this value as-is, no re-escape).
  const escapedDatasource = escapeXml(datasource);
  // The dateparse splice injects raw sourceField/format into template XML; escaping is
  // done inside the splice (escapeXmlAttr), so pass the values RAW here. datasource is
  // not used by the splice (it edits base columns, not qualified refs) but carried for
  // completeness/debuggability.
  const optionalFieldPrunes = optionalFieldPrunesFor(m, resolved);
  const base = {
    ok: true as const,
    datasource: escapedDatasource,
    field_mapping,
    ...(optionalFieldPrunes.length > 0 ? { optional_field_prunes: optionalFieldPrunes } : {}),
  };
  const withAxis = dateparseAxis ? { ...base, dateparse_axis: dateparseAxis } : base;
  return warnings.length > 0 ? { ...withAxis, warnings } : withAxis;
}
