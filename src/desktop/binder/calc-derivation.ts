// src/binder/calc-derivation.ts
//
// Pure derivation of first-class CALC SLOTS from template XML (H3 flagship).
//
// A template's calculated fields ride along as opaque XML: a
// `<column …><calculation formula='…'/></column>` in the template's
// datasource-dependencies. This module turns that XML into a DECLARED, CLASSIFIED
// contract — each bare `[Field]` token in the formula becomes an input that either
// references one of the template's declared slots (bindable ⇒ the binder resolves it
// via field_mapping) or is template-INTERNAL (the template owns the field). With the
// inputs declared, the propose/validate path can PROVE a calc's inputs bind against a
// new dataset instead of discovering breakage at render.
//
// This is the single TS source of truth. scripts/build-template-manifests.js mirrors
// the same logic in JS (it cannot import TS at runtime); calc-slots-contract.test.ts
// asserts the generator-written manifests equal a fresh derivation from these helpers,
// so the two can never silently drift (the same sync pattern as computeFixtureBind).

import type { CalcInput, CalcResultRole, CalcSlot, SlotKind, SlotSpec } from './manifest-types.js';

/** A calc column parsed from template XML. */
export interface ParsedCalc {
  template_field: string; // bare column name, e.g. "Calculation_GanttSize"
  formula: string; // entity-decoded formula body
  result_role: CalcResultRole; // measure|dimension from the <column role=…>
}

/**
 * Coercion/parse functions that impose a dataset-SHAPE constraint on their argument
 * the binder cannot prove (INT("35-31") parses only the leading integer). An
 * aggregation (SUM/AVG/…) is deliberately NOT here — aggregating a bound measure is
 * expected, not a hazard.
 */
const COERCION_FUNCTIONS: ReadonlySet<string> = new Set([
  'INT',
  'FLOAT',
  'STR',
  'DATE',
  'DATETIME',
  'MAKEDATE',
  'MAKEDATETIME',
  'MAKETIME',
]);

/** Decode the handful of XML entities a Tableau formula attribute can carry. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}='([^']*)'`));
  return m ? m[1] : undefined;
}

/**
 * Parse every calc `<column …><calculation formula='…'/></column>` from template
 * XML, de-duplicated by template_field (a calc column is often declared in both
 * `<datasources>` and `<datasource-dependencies>`). Order = first appearance.
 */
export function parseTemplateCalcs(xml: string): ParsedCalc[] {
  const re = /<column\b([^>]*)>\s*<calculation\b[^>]*\bformula='([^']*)'[^>]*\/>/g;
  const out: ParsedCalc[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const colAttrs = m[1];
    const nameAttr = attr(colAttrs, 'name');
    if (!nameAttr) continue;
    // bareName inlined to keep this lockstep-core file import-pure (severs the divergent
    // schema-summary edge): strip surrounding brackets, "[Region]" → "Region".
    const template_field = nameAttr.replace(/^\[|\]$/g, '');
    if (seen.has(template_field)) continue;
    seen.add(template_field);
    const result_role: CalcResultRole =
      attr(colAttrs, 'role') === 'measure' ? 'measure' : 'dimension';
    out.push({ template_field, formula: decodeEntities(m[2]), result_role });
  }
  return out;
}

/** Bare `[Field]` tokens in a formula, first-appearance order, de-duplicated. */
export function extractFormulaRefs(formula: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * The coercion/parse function immediately wrapping `[ref]` in the formula
 * (e.g. INT([Actual Input]) → "INT"), or undefined when the ref is bare or wrapped
 * only by an aggregation. Advisory signal for a dataset-shape constraint.
 */
export function detectCoercion(formula: string, ref: string): string | undefined {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`([A-Za-z_][A-Za-z0-9_]*)\\s*\\(\\s*\\[${escaped}\\]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const fn = m[1].toUpperCase();
    if (COERCION_FUNCTIONS.has(fn)) return fn;
  }
  return undefined;
}

/**
 * Classify every formula ref into a first-class CalcInput against the template's
 * declared slots. A ref that names a declared slot's template_field binds by
 * binding that slot (slot_kind = the slot's kind); a ref with no declared slot is
 * template-INTERNAL (the template owns the field — slot_kind "calc", non-bindable).
 * `required` follows the owning calc's required flag (a formula cannot drop a term).
 */
export function deriveCalcInputs(
  formula: string,
  slots: SlotSpec[],
  calcRequired: boolean,
): CalcInput[] {
  const byField = new Map<string, SlotSpec>();
  for (const s of slots) if (!byField.has(s.template_field)) byField.set(s.template_field, s);

  return extractFormulaRefs(formula).map((ref) => {
    const slot = byField.get(ref);
    const slot_kind: SlotKind = slot ? slot.kind : 'calc';
    const input: CalcInput = {
      ref,
      slot_id: slot ? slot.slot_id : null,
      slot_kind,
      required: calcRequired,
      template_internal: slot === undefined,
    };
    const coercion = detectCoercion(formula, ref);
    if (coercion) input.coercion = coercion;
    return input;
  });
}

/**
 * The BINDABLE slot_ids a calc depends on (formula refs that name a bindable
 * declared slot), in formula-appearance order. Non-bindable slot refs and
 * template-internal refs are excluded — only bindable deps must be bound for the
 * calc's formula rewrite to resolve (validate.ts gate 6).
 */
export function deriveDependsOnSlots(formula: string, slots: SlotSpec[]): string[] {
  const byField = new Map<string, SlotSpec>();
  for (const s of slots) if (!byField.has(s.template_field)) byField.set(s.template_field, s);

  const out: string[] = [];
  for (const ref of extractFormulaRefs(formula)) {
    const slot = byField.get(ref);
    if (slot && slot.bindable) out.push(slot.slot_id);
  }
  return out;
}

/**
 * The bindable slot_ids a REQUIRED calc forces to bind (H3 calc-input proof). A
 * required calc cannot compute unless every bindable slot its formula references
 * is bound, so those slots must bind even when the slot itself is authored
 * OPTIONAL. `depends_on_slots` lists exactly the bindable deps (template-internal
 * refs excluded), so it is the source of truth. Shared by the eligibility gate
 * (computeFixtureBind), the no-LLM binder (classifyNoLlm) and validate gate 6.
 */
export function calcForcedSlotIds(m: {
  calcs?: Array<Pick<CalcSlot, 'required' | 'depends_on_slots'>>;
}): Set<string> {
  const forced = new Set<string>();
  for (const c of m.calcs ?? []) {
    if (!c.required) continue;
    for (const dep of c.depends_on_slots ?? []) forced.add(dep);
  }
  return forced;
}
