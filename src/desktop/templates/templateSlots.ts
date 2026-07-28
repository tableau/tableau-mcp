// Merge layer: resolve a template's bindable slots from inference, a curated manifest,
// or both — with a single public entry point the discovery + binding surface can call.
//
// The design (plan §3): INFER FIRST from the `.tbm` bookmark, then OVERLAY a curated
// manifest field-by-field when one exists (manifest wins per field, inference fills
// gaps). This makes a hand-authored manifest an OPTIONAL refinement, never a
// prerequisite: a bookmark dropped in with no manifest is fully usable (source
// 'inferred'); a curated one is upgraded (source 'curated' / 'render-verified').
//
// The join key between an inferred slot and a curated slot is `template_field`
// ({{field_base_N}}), because both number their slots in the SAME encoding order — the
// tokenizer (bookmarkTemplate.ts) and synthesizeManifest (inferSlots.ts) come from one
// pass. Curated slots with no inferred equivalent (non-bindable calc/generated/pseudo
// slots inference deliberately skips) pass through untouched.
//
// NOTHING here is chart-specific: it is a generic three-way merge over slot records.

import type { SlotSpec, TemplateManifest } from '../binder/manifest-types.js';
import { bundledIntelligenceProvider } from '../intelligence/provider.js';
import type { TemplateSlotReference } from './fieldReferenceRewriter.js';
import { inferFromBookmark, synthesizeManifest } from './inferSlots.js';
import { readBookmark } from './templatePath.js';

/**
 * Where a resolved slot set's authority comes from:
 *   - 'inferred'         — derived purely from the bookmark, no curated manifest.
 *   - 'curated'          — a hand-authored manifest overlaid the inference.
 *   - 'render-verified'  — curated AND the manifest carries a live render stamp.
 * This is a TIER, never a visibility gate — an 'inferred' template is fully listable.
 */
export type SlotSource = 'inferred' | 'curated' | 'render-verified';

export interface ResolvedTemplateSlots {
  slots: TemplateSlotReference[];
  source: SlotSource;
  /** True when a `.tbm` bookmark backed the inference (vs. a manifest-only template). */
  fromBookmark: boolean;
}

/** SlotSpec → the leaner discovery/guard shape. Donor field names never appear here. */
function toReference(spec: SlotSpec): TemplateSlotReference {
  return {
    slot_id: spec.slot_id,
    template_field: spec.template_field,
    required: spec.required,
    bindable: spec.bindable,
    kind: spec.kind,
    role: spec.role,
    purpose: spec.purpose,
  };
}

/** A curated manifest with a `live-*` render stamp is the highest tier. */
function curatedSource(manifest: TemplateManifest): SlotSource {
  return manifest.portability_evidence?.render_verified?.startsWith('live-')
    ? 'render-verified'
    : 'curated';
}

/**
 * Overlay a curated SlotSpec onto an inferred one, keyed by template_field. The curated
 * manifest is authoritative per field (it reflects human verification); the inferred
 * spec fills any field the manifest omits. slot_id is taken from the curated spec when
 * present — it is the stable routing/proposal identity the binder contract depends on.
 */
function overlaySpec(inferred: SlotSpec | undefined, curated: SlotSpec | undefined): SlotSpec {
  // At least one is always defined by construction (see mergeSlots).
  if (!curated) return inferred as SlotSpec;
  if (!inferred) return curated;
  return {
    ...inferred,
    ...curated,
    // A field the curated manifest left undefined must not clobber the inferred value.
    slot_id: curated.slot_id || inferred.slot_id,
    purpose: curated.purpose ?? inferred.purpose,
    examples: curated.examples ?? inferred.examples,
  };
}

/**
 * Union the inferred and curated slot lists by template_field, preserving encoding
 * order for the shared slots and appending curated-only slots (calc/generated/pseudo
 * that inference skips) at the end.
 */
function mergeSlots(inferred: SlotSpec[], curated: SlotSpec[]): SlotSpec[] {
  const curatedByField = new Map(curated.map((s) => [s.template_field, s]));
  const merged: SlotSpec[] = inferred.map((s) =>
    overlaySpec(s, curatedByField.get(s.template_field)),
  );
  const inferredFields = new Set(inferred.map((s) => s.template_field));
  for (const s of curated) {
    if (!inferredFields.has(s.template_field)) merged.push(s);
  }
  return merged;
}

/**
 * Resolve the bindable slots for a template by name. Never throws for a missing
 * template — returns an empty slot set so callers can list gracefully.
 */
export function resolveTemplateSlots(templateName: string): ResolvedTemplateSlots {
  const bookmarkXml = readBookmark(templateName);
  const inferred = bookmarkXml
    ? synthesizeManifest(templateName, inferFromBookmark(bookmarkXml))
    : null;
  const curated = bundledIntelligenceProvider.getTemplateManifest(templateName) ?? null;

  if (inferred && curated) {
    return {
      slots: mergeSlots(inferred.slots, curated.slots).map(toReference),
      source: curatedSource(curated),
      fromBookmark: true,
    };
  }
  if (inferred) {
    return { slots: inferred.slots.map(toReference), source: 'inferred', fromBookmark: true };
  }
  if (curated) {
    // Manifest-only (a tokenized `.xml` template with no bookmark to infer from): the
    // curated manifest IS the authority. This is the pre-bookmark corpus's path.
    return {
      slots: curated.slots.map(toReference),
      source: curatedSource(curated),
      fromBookmark: false,
    };
  }
  return { slots: [], source: 'inferred', fromBookmark: false };
}
