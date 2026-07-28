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
      if (shelf.includes('mark')) {
        return 'Categorical dimension encoded on a mark property (color / detail).';
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

  const placed = new Map<string, { shelves: Set<Shelf>; derivation: Derivation }>();
  const placedCalcs = new Map<string, { shelves: Set<Shelf>; derivation: Derivation }>();
  for (const tag of ['rows', 'cols', 'mark'] as Shelf[]) {
    for (const el of all(tag)) {
      const text = (el.textContent ?? '').trim();
      for (const m of text.matchAll(/\[[^\]]*\](?:\.\[[^\]]*\])*/g)) {
        const { base, derivation } = parseInstanceRef(m[0]);
        if (isPseudo(base)) continue;
        const def = cols.get(base);
        const target = def?.isCalc ? placedCalcs : placed;
        const cur = target.get(base);
        if (cur) cur.shelves.add(tag);
        else target.set(base, { shelves: new Set([tag]), derivation });
      }
    }
  }

  const slots: InferredSlot[] = [];
  const seen = new Set<string>();
  let unknownCount = 0;

  const emit = (
    base: string,
    shelves: Set<Shelf>,
    derivation: Derivation,
    tier: 'primary' | 'advanced',
  ): void => {
    if (seen.has(base) || isPseudo(base)) return;
    seen.add(base);
    const def = cols.get(base);
    const k = kindOf(def);
    if (k === 'unknown') {
      unknownCount++;
      return; // skip rather than guess
    }
    const shelf = [...shelves];
    slots.push({
      slot_id: base.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase(),
      sourceField: base,
      caption: def?.caption ?? '',
      shelves: shelf,
      kind: k,
      derivation,
      required: shelf.includes('rows') || shelf.includes('cols'),
      purpose: autoPurpose(k, shelf),
      tier,
    });
  };

  for (const [base, info] of placed) emit(base, info.shelves, info.derivation, 'primary');
  // A placed CALC is decomposed to its base-column leaves — each leaf becomes a
  // bindable slot; the calc itself is fixed derived structure the binder keeps.
  for (const [calcName, info] of placedCalcs) {
    const def = cols.get(calcName);
    if (!def) continue;
    for (const leaf of def.baseInputs) emit(leaf, info.shelves, info.derivation, 'primary');
  }

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
  const slots: SlotSpec[] = inf.slots.map((s, i) => ({
    slot_id: s.slot_id,
    template_field: `{{field_base_${i + 1}}}`,
    derivation: s.derivation,
    role: s.shelves.slice(),
    kind: s.kind,
    bindable: true,
    required: s.required,
    purpose: s.purpose,
  }));
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
