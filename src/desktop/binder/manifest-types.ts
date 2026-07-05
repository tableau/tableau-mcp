// src/binder/manifest-types.ts
//
// Tier-1 fast-path binder — slot manifest schema (design doc §2.2).
// A manifest is a checked-in binding contract for a single injectable template:
// it names each structural slot, the derivation the template uses for that
// instance, and the hazards a deterministic gate must pre-check before calling
// `inject-template`. The shapes here are the source of truth the loader
// (`manifest.ts`) validates against and the generator
// (`scripts/build-template-manifests.js`) summarizes into the aggregate index.

export type Readiness = 'GREEN' | 'YELLOW' | 'RED';

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

/**
 * Machine-readable portability proof (attacks 5+10). Fixture binding is
 * NECESSARY but NOT sufficient: `fixture_bind` is COMPUTED by the generator by
 * actually binding this manifest's required slots against the committed schema
 * fixture (data/template-manifests.fixture.json); `render_verified` is the
 * hand-stamped completing proof — a `live-YYYY-MM-DD` date when a real Desktop
 * render-readback confirmed the template, else `'none'`. fast_path_eligible may
 * be true ONLY when both hold (portable across the committed fixture classes AND
 * render-verified — never a blanket "any dataset" claim).
 */
export interface PortabilityEvidence {
  /** Computed: every required bindable slot binds against the committed fixture schema. */
  fixture_bind: boolean;
  /** Hand-stamped: `live-YYYY-MM-DD` when render-readback proven, else `'none'`. */
  render_verified: string;
}

/** Datatype/role family a slot accepts. Derived from FieldReference {role,type,datatype}. */
export type SlotKind =
  | 'quantitative' // role=measure, type=quantitative
  | 'categorical' // role=dimension, nominal/ordinal
  | 'temporal' // dimension over datatype date|datetime
  | 'geo' // dimension, geocodable — bind with care
  // ── never user-bindable: template owns these fully ──
  | 'calc' // template-provided calculated field
  | 'generated' // Tableau-generated Latitude/Longitude/Geometry
  | 'pseudo' // Measure Names / Measure Values
  | 'parameter'; // Parameters datasource member

/**
 * Canonical derivation short-forms (written verbatim into column-instance names).
 * Each MUST be a key of the derivationMap in src/server/tools/templates.ts.
 * Month-Trunc is 'tmn' (the real short-form live Tableau writes); 'tmo' is only a
 * legacy input alias tolerated by that derivationMap, never emitted here.
 */
export type Derivation =
  | 'none'
  | 'sum'
  | 'avg'
  | 'cnt'
  | 'cntd'
  | 'median'
  | 'min'
  | 'max'
  | 'attr'
  | 'usr'
  | 'yr'
  | 'qr'
  | 'mn'
  | 'wk'
  | 'dy'
  | 'hr'
  | 'mi'
  | 'sc'
  | 'tyr'
  | 'tqr'
  | 'tmn'
  | 'tdy';

export interface SlotSpec {
  slot_id: string; // stable id used by the LLM contract, e.g. "region", "order_date_month"
  template_field: string; // bare field name AS IT APPEARS in the template <column name='[...]'>
  derivation: Derivation; // template's derivation for THIS instance → drives field_mapping key + value
  role: string[]; // structural roles this instance fills: ["rows","sort-dimension"]
  kind: SlotKind;
  bindable: boolean; // false ⇒ binder must NOT fill it (calc/generated/pseudo/parameter)
  required: boolean;
  /** true when template_field is reused at >1 derivation ⇒ binder MUST emit `template_field@derivation`. */
  qualified_key_required?: boolean;
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

export interface Hazard {
  code: string;
  detail: string;
  xml: string;
} // xml = "file.xml:line(s)"

/**
 * Golden-render anchor for a FACTORY template (compiled from an eval checkpoint by
 * scripts/compile-checkpoint-template.mjs). `checkpoint_render` is the path to the
 * graded checkpoint render this template was generalized from — the artifact a live
 * render of the bound template must be judged to MATCH before render_verified may be
 * stamped.
 *
 * NEW VERIFICATION STANDARD (the reason this field exists): a factory template earns
 * `portability_evidence.render_verified` ONLY when its live render is judged to MATCH
 * this checkpoint's graded render (a golden comparison — vision judge or human), NOT
 * merely by rendering "not blank / marks visible". Non-blank is necessary but NOT
 * sufficient (that weak bar is exactly what let ww-floating-bars — compiled from a
 * `leanest-passing` checkpoint — ship stamped while rendering as thin, unsized marks).
 * The golden itself must be a genuinely good render; anchoring to a leanest-passing
 * checkpoint makes the match trivial and the stamp meaningless.
 */
export interface GoldenSpec {
  /** Repo-relative path to the checkpoint render this template must match to earn render_verified. */
  checkpoint_render: string;
}

export interface TemplateManifest {
  template: string; // == filename == inject-template template_name
  family: Family; // required chart-intent family (attack 2)
  readiness: Readiness; // corrected verification value
  /**
   * Tier-1 one-shot allowed. Portable across the committed fixture classes +
   * render-verified (attacks 5+10) — true ONLY when readiness!==RED, no blockers,
   * portability_evidence.fixture_bind===true, AND render_verified is a live stamp.
   */
  fast_path_eligible: boolean;
  fast_path_blockers: BlockerCode[]; // why not, if false
  /** Machine-readable portability proof gating fast_path_eligible (attacks 5+10). */
  portability_evidence: PortabilityEvidence;
  datasource_placeholder: boolean; // has {{DATASOURCE}} (deviation-spine-chart = false ⇒ blocker)
  placeholders: string[]; // ["TITLE","DATASOURCE"]
  intent_keywords: string[]; // classifier terms (from the draft)
  description: string; // one line for the LLM prompt
  /**
   * Optional NEGATIVE routing guidance: chart-selection anti-patterns / "when NOT to
   * use this template" that no positive slot or intent keyword can encode (e.g. a pie
   * beyond a few slices, a dual axis without synchronized axes). Kept structured here so
   * the binder/prompt can surface the caution deterministically instead of hoping prose
   * retrieval fires (the retrieval-without-adherence failure). Absent ⇒ no encoded caution;
   * the JIT chart-selection knowledge still carries the full judgment.
   */
  avoid_when?: string[];
  slots: SlotSpec[]; // bindable + non-bindable structural slots
  calcs: CalcSlot[]; // template-owned calculated fields
  hazards: Hazard[];
  /**
   * Optional golden-render anchor for FACTORY templates (checkpoint→template compiled).
   * Present ⇒ render_verified is earned only by a live-render MATCH against
   * `golden.checkpoint_render` (see GoldenSpec). Absent for hand-authored templates.
   */
  golden?: GoldenSpec;
}
