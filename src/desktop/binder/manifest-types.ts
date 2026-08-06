// src/binder/manifest-types.ts
//
// In-memory template descriptor consumed by deterministic binding. The descriptor
// may be inferred from a TBM at runtime; these types do not imply a static sidecar.

import type { CanonicalDerivationShort } from '../derivations.js';

/**
 * Chart-intent family (attack 2). A required, closed taxonomy so the classifier
 * shortlist can be capped per-family (K applies within-family) and an anti-overlap
 * test can catch cross-family keyword collisions before they cause classifier
 * tie-storms. Derived from each template's name/intent.
 */
export type Family =
  | 'time-series'
  | 'ranking'
  | 'part-to-whole'
  | 'correlation'
  | 'distribution'
  | 'deviation'
  | 'magnitude'
  | 'spatial'
  | 'kpi'
  | 'specialized';

/** Datatype/role family a slot accepts. Derived from FieldReference {role,type,datatype}. */
export type SlotKind =
  | 'quantitative' // role=measure, type=quantitative
  | 'categorical' // role=dimension, nominal/ordinal
  | 'quantitative-or-categorical' // encoding shelf accepts either a measure or dimension
  | 'temporal' // dimension over datatype date|datetime
  | 'geo' // dimension, geocodable — bind with care
  // ── never user-bindable: template owns these fully ──
  | 'calc' // template-provided calculated field
  | 'generated' // Tableau-generated Latitude/Longitude/Geometry
  | 'pseudo' // Measure Names / Measure Values
  | 'parameter'; // Parameters datasource member

export type CommunicativeRole =
  | 'measure-value'
  | 'axis-partition'
  | 'distribution-breakout'
  | 'decoration'
  | 'filter-scope'
  | 'tablecalc-addressing'
  | 'tablecalc-partition';

/**
 * Canonical derivation short-forms (written verbatim into column-instance names).
 * Each MUST be a key of the derivationMap in src/server/tools/templates.ts.
 * Month-Trunc is 'tmn' (the real short-form live Tableau writes); 'tmo' is only a
 * legacy input alias tolerated by that derivationMap, never emitted here.
 */
export type Derivation = CanonicalDerivationShort;

export interface TableCalcFact {
  types: string[];
  addressing: 'relative' | 'absolute';
  along: string[];
  reset_on: string[];
}

export interface SlotSpec {
  slot_id: string; // stable id used by the LLM contract, e.g. "region", "order_date_month"
  /**
   * Exact base token AS IT APPEARS in the template <column name='[...]'>.
   * Migrated bindable slots use `{{field_base_N}}`; concrete names remain
   * temporarily valid only for templates on the migration grandfather list.
   */
  template_field: string;
  derivation: Derivation; // template's derivation for THIS instance → drives field_mapping key + value
  /** Tableau output role marker authored on this template instance (not the donor field type). */
  instance_role?: 'nk' | 'ok' | 'qk';
  role: string[]; // structural roles this instance fills: ["rows","sort-dimension"]
  communicative_role?: CommunicativeRole;
  kind: SlotKind;
  /** Tableau geographic semantic role inferred from the TBM column dictionary. */
  semantic_role?: string;
  bindable: boolean; // false ⇒ binder must NOT fill it (calc/generated/pseudo/parameter)
  required: boolean;
  /**
   * Semantic reason this field exists in the chart. Required by corpus lint for
   * migrated bindable slots; optional at runtime until the migration completes.
   */
  purpose?: string;
  /**
   * Agent-facing examples of field captions that would fit this slot. Present only
   * as matching hints alongside `purpose`; not used by deterministic binding.
   */
  examples?: string[];
  hint?: string;
  /** true when template_field is reused at >1 derivation ⇒ binder MUST emit `template_field@derivation`. */
  qualified_key_required?: boolean;
  table_calc?: TableCalcFact;
  /**
   * Opt-in (temporal slots only): when set, a date-like STRING field is an acceptable
   * source for this temporal slot. The binder injects a DATEPARSE calc that parses the
   * string into a real date and points the slot's Month-Trunc axis at the calc, instead
   * of rejecting the string with a kind-mismatch. Off by default — only templates whose
   * temporal axis can render off a parsed string month opt in (trend-line-chart).
   */
  temporal_from_string?: boolean;
  notes?: string;
}

/** A calc's OUTPUT role — measure|dimension — read from the calc <column role=…> in the XML. */
export type CalcResultRole = 'measure' | 'dimension';

/**
 * One first-class INPUT to a calc slot (H3 flagship). Each bare `[Field]` token
 * in the formula becomes a declared, classified input so the propose/validate
 * path can PROVE the input binds against a new dataset instead of discovering
 * breakage at render:
 *   • `slot_id` — the declared slot whose `template_field` equals `ref` (the input
 *     is bound by binding that slot), or `null` when the input is template-INTERNAL.
 *   • `template_internal` — true ⇒ `ref` does NOT name a declared slot: the template
 *     owns/provides the field itself (a nested calc or a template-only column), so
 *     the binder must NOT try to bind it and the dataset need not carry it.
 *   • `slot_kind` — the bindable kind the referenced slot must satisfy (mirrors the
 *     slot's kind); for a template-internal input it is "calc" (owned, non-bindable).
 *   • `required` — the input must resolve for the calc to compute (true for every
 *     ref of a required calc — a formula cannot drop a term).
 *   • `coercion` — OPTIONAL advisory: the coercion/parse function wrapping the ref
 *     in the formula (e.g. INT/FLOAT/STR/DATE). It signals a dataset-SHAPE constraint
 *     the binder cannot prove (INT([x]) needs a leading-numeric string) — surfaced
 *     like avoid_when, never a hard blocker.
 */
export interface CalcInput {
  ref: string;
  slot_id: string | null;
  slot_kind: SlotKind;
  required: boolean;
  template_internal: boolean;
  coercion?: string;
}

/**
 * A first-class CALC SLOT: a template-owned calculated field declared as a
 * bindable/validatable contract rather than opaque XML. `formula`/`formula_refs`/
 * `depends_on_slots` are the original opaque form (kept for backward compatibility
 * with the single opaque calc entries in existing manifests); `inputs`, `result_role`,
 * `avoid_when`, and `prereqs` are the H3 first-class additions and are OPTIONAL so a
 * manifest authored/compiled before this layer still validates.
 */
export interface CalcSlot extends SlotSpec {
  kind: 'calc';
  formula: string; // raw template formula
  formula_refs: string[]; // bare [Field] tokens in the formula (e.g. ["Profit","Sales"])
  depends_on_slots: string[]; // slot_ids whose template_field appears in formula_refs
  /** OUTPUT role of the calc (measure|dimension), from the calc <column role=…>. */
  result_role?: CalcResultRole;
  /** First-class per-input binding contract, one entry per formula_ref (generator-derived from XML). */
  inputs?: CalcInput[];
  /**
   * Calc-scoped negative guidance (dataset-shape parse patterns like compound
   * strings → INT()). Advisory only, like the manifest-level avoid_when. Absent ⇒
   * no encoded caution for this calc.
   */
  avoid_when?: string[];
  /**
   * Hazard/prereq codes (referencing this manifest's `hazards[].code`) a
   * deterministic gate should pre-check before relying on this calc — e.g. the
   * min-derivation-per-row grain hazard. Advisory pointers, not blockers.
   */
  prereqs?: string[];
}

export type BlockerCode =
  | 'HARDCODED_FILTER_MEMBERS'
  | 'GENERATED_GEO_REQUIRED'
  | 'PSEUDO_FIELD_REQUIRED'
  | 'PARAMETER_REQUIRED'
  | 'NO_DATASOURCE_PLACEHOLDER'
  | 'DATASET_SPECIFIC_FORMULA';

export interface TemplateBindingContract {
  template: string;
  slots: SlotSpec[];
  calcs: CalcSlot[];
  intent_keywords?: string[];
  avoid_when?: string[];
}

/** Runtime-only facts derived from one resolved TBM and its filename. */
export interface RuntimeTemplateDescriptor extends TemplateBindingContract {
  family: Family;
  fast_path_eligible: boolean;
  /** Exact structural eligibility findings from the TBM compiler. */
  fast_path_blockers: string[];
  intent_keywords: string[];
  description: string;
}
