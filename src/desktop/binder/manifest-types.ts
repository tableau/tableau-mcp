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
  /**
   * OPTIONAL provenance for a HAND-STAMP (attacks 5+10). Required by contract whenever
   * `render_verified` is a `live-*` stamp that was NOT produced by the golden-parity gate:
   * a generic template with no pixel oracle for its anchor, whose composite is therefore not
   * computable (an anchor-only pixel leg is circular and is not credited). Records the
   * substantive basis — live render + structural parity + human review — so the stamp is
   * auditable rather than a bare date. Absent ⇒ a gate-produced stamp (golden-anchored
   * template) or `render_verified === 'none'`. `validateManifest` treats it as pass-through
   * (unknown-but-typed), so it is additive and never re-derives the gate.
   */
  render_evidence?: RenderEvidence;
}

/**
 * The auditable basis behind a HAND-STAMPED `render_verified` (see PortabilityEvidence).
 * `gate_composite` is the golden-parity composite when a real pixel oracle exists and the
 * score is computable; it is `null` for a hand-stamp where no pixel oracle exists (the
 * only credible pixel comparison would be anchor-to-itself, which is circular).
 */
export interface RenderEvidence {
  /** One-line human description of what earned the stamp. */
  basis: string;
  /** The lane/session that measured and applied the stamp. */
  lane: string;
  /**
   * Live structural-parity score 0..1 (golden-parity structuralParity leg) when a
   * numeric score was actually measured and retained; `null` for a legacy hand-stamp
   * where the stamp was earned by live render + human review but NO numeric score was
   * recorded (never invent one — an unmeasured score is `null`, not a guess).
   */
  structural: number | null;
  /** CRITICAL (salience-5) pass-list ratio, e.g. "5/5"; an honest note when not recorded. */
  critical_pass: string;
  /** HIGH (salience-4) pass-list ratio, e.g. "3/3"; an honest note when not recorded. */
  high_pass: string;
  /** Pixel-oracle status; a `none (…)` note when no credible oracle exists. */
  pixel_oracle: string;
  /** Golden-parity composite when computable; `null` when no pixel oracle exists. */
  gate_composite: number | null;
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

/**
 * DERIVATION CONTRACT (Lane G1 / H2.6) — declares that this template is a documented
 * DERIVATION of another template's worksheet, so the golden-parity gate can grade it in
 * ANCHORED-DERIVATION mode: score the derived worksheet against its PARENT's golden anchor
 * while EXEMPTING the structural facets the derivation intentionally changes.
 *
 * Present ⇒ the gate exempts exactly the DECLARED facets (auditable, labeled
 * `exempt-derivation`, excluded from both the structural numerator AND denominator — they
 * NEVER count as passes). An UNDECLARED mismatch is still a full/critical fail; the exemption
 * set is a CLOSED, hand-authored allow-list, never inferred from the live diff. The gate also
 * enforces a surviving-critical-facet FLOOR (it REFUSES to grade rather than stamp on air when
 * a derivation would exempt too many critical facets). Absent ⇒ ordinary golden-vs-live grading
 * (zero behavior change for non-derivation templates).
 *
 * The facet names in `removed_facets` / `changed_facets` MUST be members of the golden-parity
 * gate's structural facet vocabulary; an unknown facet fails loud AT THE GATE.
 *
 * PORT NOTE (superset ported from A for A↔B manifest-shape convergence): B's `validateManifest`
 * treats a present `derivation` as PASS-THROUGH (unknown-but-typed), exactly like
 * `render_evidence` — the object-shape / closed-key-set / facet-vocabulary / parent-existence
 * cross-checks live at the golden-parity gate, not in this repo's shape validator.
 */
export interface DerivationContract {
  /** The template whose golden worksheet anchor this template derives from (e.g. `ww-ou-arrow`). */
  parent_template: string;
  /**
   * Facets the derivation REMOVES (present in the parent, intentionally absent in the derivation
   * — e.g. `color-encoding-presence`). Excluded from grading, labeled `exempt-derivation`.
   */
  removed_facets: string[];
  /**
   * Facets the derivation CHANGES (present in both but with an intentionally different value —
   * e.g. `mark-classes-per-pane`, `diff-calc-on-cols`). Excluded from grading, labeled
   * `exempt-derivation`. Must be DISJOINT from `removed_facets`.
   */
  changed_facets: string[];
}

/**
 * Datasource-level MARK STYLE sidecar (the fidelity fix, productized 2026-07-05).
 *
 * Golden workbooks carry value→hex/glyph maps at DATASOURCE scope, OUTSIDE the
 * <worksheet> that `extractWorksheet` slices — so a worksheet-only template drops
 * them (marks fall back to the default palette + default shape on apply). This
 * sidecar captures that dropped fidelity so the apply path can re-splice it:
 *   - `style_rule` — the datasource-scope `<style-rule element='mark'>…</style-rule>`
 *     (the color palette + shape glyph maps), calc refs left in TEMPLATE-CANONICAL
 *     (un-namespaced) form so the per-apply `_tpl_<hex>` calc namespacing can rewrite
 *     them identically to the worksheet fragment.
 *   - `column_instances` — the datasource-scope `<column-instance …/>` declaration(s)
 *     the style-rule's field refs require. WITHOUT the referenced instance declared at
 *     datasource scope the maps are silently dropped on live apply / inert on file open
 *     (proven live 2026-07-05).
 *   - `maps` — convenience counts of the color/shape value maps carried (audit only,
 *     not load-bearing).
 *
 * Apply-side splice logic + the proven insertion anchors live in
 * `evals/lib/tier1-fastpath.mjs` (`spliceDatasourceStyle`): column-instance(s) go
 * before `<layout>`; the `<style>` block goes before `<semantic-values>` (else before
 * `</datasource>`).
 */
export interface DatasourceStyleSidecar {
  /** The datasource-scope `<style-rule element='mark'>…</style-rule>` XML (calc refs un-namespaced). */
  style_rule: string;
  /** Datasource-scope `<column-instance …/>` declarations the style-rule's field refs require. */
  column_instances: string[];
  /** Convenience counts of the value maps carried per encoding attr (audit, not load-bearing). */
  maps: { color: number; shape: number };
}

/**
 * One append-only LOCAL render-stamp ledger entry (W3 local-stamp flow). Superset type
 * ported from A for A↔B manifest-shape convergence: it describes the ledger the golden-parity
 * gate write path appends and a local-side-load loader reads to decide whether a side-loaded
 * LOCAL template's on-disk `render_verified` stamp is TRUSTED.
 *
 * A stamp is honored ONLY when a ledger entry matches the CURRENT on-disk package by all three
 * machine hashes + the slug tuple + a passing gate verdict (composite >= 85, no critical fail,
 * sanity `sane`). No HMAC — the threat model is a careless hand edit, not adversarial tampering,
 * so a hash-bound ledger is the right bar.
 *
 * NOT part of the on-disk manifest schema (so `validateManifest` never sees it) and NOT yet
 * consumed by B's bundled loader — it is an additive convergence type. All fields are OPTIONAL
 * at the type level so a malformed/partial line never crashes a reader; a trust check treats any
 * missing/mismatching field as fail-closed (untrusted ⇒ the stamp is neutralized in memory, the
 * template stays propose-routable).
 */
export interface RenderStampLedgerEntry {
  /** sha256 of the raw template XML bytes (`<template>.xml`). */
  template_xml_sha256?: string;
  /** sha256 of the manifest with stamp fields excluded, canonicalized (key-sorted). */
  manifest_unstamped_sha256?: string;
  /** The source/golden anchor hash, copied from `provenance.json.source_sha256`. */
  anchor_sha256?: string;
  /** The template / workbook / sheet slug tuple this stamp was earned for. */
  slug?: { template?: string; workbook?: string; sheet?: string };
  /** golden-parity composite 0..100 measured at stamp time (>= 85 to trust). */
  composite?: number;
  /** golden-parity structural leg 0..1. */
  structural?: number;
  /** golden-parity pixel leg 0..1 (source-workbook render oracle). */
  pixel?: number;
  /** CRITICAL (salience-5) pass-list ratio, e.g. "5/5" — a full ratio means no critical fail. */
  critical_pass?: string;
  /** HIGH (salience-4/3) pass-list ratio, e.g. "3/3" (audit; not load-bearing for trust). */
  high_pass?: string;
  /** Independent binding-sanity verdict — must be `sane` to trust (fail-closed). */
  sanity?: string;
  /** The `live-YYYY-MM-DD` stamp written to the manifest (audit; not matched). */
  render_verified?: string;
  /** ISO timestamp the stamp was written (audit). */
  timestamp?: string;
  /** Package version at stamp time (audit). */
  package_version?: string;
  /** The lane/session that measured + applied the stamp (audit). */
  lane?: string;
}

/**
 * Load-time PROVENANCE (W2-C1 local side-load). NOT part of the on-disk manifest
 * schema and NOT written by any generator — these are stamped onto the in-memory
 * manifest by `loadManifests()` so the classifier/apply path can tell a repo
 * template from a runtime-side-loaded LOCAL one WITHOUT the local XML/manifest
 * ever entering the repo tree. `validateManifest` ignores them (unknown fields
 * pass), so a disk manifest never needs to carry them.
 *   - `'repo'`  — loaded from `data/template-manifests/` (the committed set).
 *   - `'local'` — side-loaded from the local compiled store pointed at by
 *                 the source's local-template-dir env var. Local templates arrive UNSTAMPED
 *                 (readiness YELLOW, render_verified 'none', fast_path_eligible
 *                 false) and can only be stamped by the golden-parity gate.
 * Absent ⇒ treat as a repo manifest (back-compat with synthetic fixtures).
 */
export type TemplateSource = 'repo' | 'local';

export interface TemplateManifest {
  template: string; // == filename == inject-template template_name
  /**
   * Load-time provenance (W2-C1). Set to `'local'` for a runtime-side-loaded
   * template; absent/`'repo'` for the committed set. Never serialized to disk.
   */
  source?: TemplateSource;
  /**
   * LOCAL side-load ONLY: absolute path to this template's XML in the local
   * compiled store (`<dir>/<workbook-slug>/<sheet-slug>/<template>.xml`). The
   * apply/inject path resolves side-loaded slugs here instead of the repo's
   * `data/data-visualization-templates-xml/`. Never a repo-relative path; the
   * local XML is never copied into the repo (licensing wall).
   */
  local_xml_path?: string;
  /**
   * LOCAL side-load ONLY: the PRECISE chart family from the compiled index
   * (e.g. `'gantt'` for a template whose closed-enum `family` is `'time-series'`).
   * Refines within-family routing without widening the closed `Family` enum.
   */
  family_precise?: string;
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
  /**
   * Optional datasource-level MARK STYLE sidecar (the fidelity fix). Present when the
   * golden's datasource carried a `<style-rule element='mark'>` value→hex/glyph map the
   * worksheet-only template would otherwise drop; the apply path re-splices it at the
   * proven datasource anchors. Absent ⇒ the template carries no datasource-scope style.
   */
  datasource_style?: DatasourceStyleSidecar;
  /**
   * Optional DERIVATION CONTRACT (Lane G1 / H2.6). Present ⇒ this template is a documented
   * derivation of `derivation.parent_template`'s worksheet; the golden-parity gate grades it in
   * ANCHORED-DERIVATION mode, exempting the declared facets against the parent's golden anchor.
   * Absent ⇒ ordinary golden-vs-live grading (no behavior change for non-derivation templates).
   */
  derivation?: DerivationContract;
}
