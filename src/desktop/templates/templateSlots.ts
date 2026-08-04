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
import {
  bookmarkToTemplateWorkbook,
  deriveTemplatePass1Eligibility,
  type Inference,
  type TemplatePass1Eligibility,
} from './bookmarkTemplate.js';
import type { TemplateSlotReference } from './fieldReferenceRewriter.js';
import { inferFromBookmark, synthesizeManifest } from './inferSlots.js';
import {
  getLegacyTemplateCatalogEntry,
  getTemplateCatalogEntry,
  listLegacyTemplateCatalog,
  listTemplateCatalog as listTemplateSourceCatalog,
  readBookmark,
  readBookmarkFromCatalogEntry,
  readXmlFromCatalogEntry,
  type TemplateArtifact,
  type TemplateCatalogEntry,
  type TemplateCatalogOptions,
  type TemplateProvenance,
} from './templatePath.js';

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

/**
 * SlotSpec → the leaner discovery/guard shape. A donor field name never appears as slot
 * IDENTITY (slot_id/template_field); it is carried only in the clearly-labeled `hint`
 * suggestion field, and only when the spec actually has one.
 */
function toReference(spec: SlotSpec): TemplateSlotReference {
  return {
    slot_id: spec.slot_id,
    template_field: spec.template_field,
    required: spec.required,
    bindable: spec.bindable,
    kind: spec.kind,
    role: spec.role,
    purpose: spec.purpose,
    ...(spec.hint ? { hint: spec.hint } : {}),
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
    hint: curated.hint ?? inferred.hint,
  };
}

/** The token grammar inference emits — a curated slot must speak it to align with a .tbm. */
const FIELD_BASE_TOKEN = /^\{\{field_base_\d+\}\}$/;

/**
 * Union the inferred and curated slot lists by template_field, preserving encoding
 * order for the shared slots and appending genuine curated-only slots at the end.
 *
 * A curated-only slot is appended ONLY when its token is a {{field_base_N}} (a real
 * additive slot inference skipped, e.g. an optional calc). A LEGACY curated slot whose
 * token is a bare donor name (`'Category'`, `'Sales'` — authored against the retired
 * `.xml`) can never align with the `.tbm`'s inferred tokens, so appending it would
 * DUPLICATE an already-inferred slot under a stale id (the "6-slots-for-a-3-field-chart"
 * doubling). Those are dropped: the `.tbm` is canonical, so inference owns the slot set.
 */
function mergeSlots(inferred: SlotSpec[], curated: SlotSpec[]): SlotSpec[] {
  const curatedByField = new Map(curated.map((s) => [s.template_field, s]));
  const merged: SlotSpec[] = inferred.map((s) =>
    overlaySpec(s, curatedByField.get(s.template_field)),
  );
  const inferredFields = new Set(inferred.map((s) => s.template_field));
  for (const s of curated) {
    if (inferredFields.has(s.template_field)) continue;
    if (!FIELD_BASE_TOKEN.test(s.template_field)) continue;
    merged.push(s);
  }
  return merged;
}

/**
 * Resolve the bindable slots for a template by name. Never throws for a missing
 * template — returns an empty slot set so callers can list gracefully.
 */
export function resolveTemplateSlots(
  templateName: string,
  catalogEntry = getLegacyTemplateCatalogEntry(templateName),
): ResolvedTemplateSlots {
  const bookmarkXml = catalogEntry
    ? readBookmarkFromCatalogEntry(catalogEntry)
    : readBookmark(templateName);
  const inferred = bookmarkXml
    ? synthesizeManifest(templateName, inferFromBookmark(bookmarkXml))
    : null;
  const curated =
    !catalogEntry ||
    catalogEntry.provenance === 'protected' ||
    catalogEntry.provenance === 'dev-override'
      ? (bundledIntelligenceProvider.getTemplateManifest(templateName) ?? null)
      : null;

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

/**
 * The full-manifest analog of {@link ResolvedTemplateSlots}: the merged
 * `TemplateManifest` plus the same authority tier. The Show Me matcher and the
 * worksheet constructor need the WHOLE manifest (family, calcs, hazards, placeholders,
 * portability evidence), not just the discovery-shaped slot references.
 */
export interface ResolvedTemplateManifest {
  manifest: TemplateManifest;
  source: SlotSource;
  /** True when a `.tbm` bookmark backed the inference (vs. a manifest-only template). */
  fromBookmark: boolean;
  eligibility: TemplatePass1Eligibility;
  provenance: TemplateProvenance;
  overridesLowerPrecedence: boolean;
}

export interface ResolvedTemplateSnapshot {
  artifact: TemplateArtifact;
  resolvedManifest: ResolvedTemplateManifest | null;
  provenance: TemplateProvenance;
  overridesLowerPrecedence: boolean;
}

export interface ResolveTemplateSnapshotOptions {
  catalogEntry?: TemplateCatalogEntry | null;
  repositoryRoot?: string;
}

function resolveTemplateManifestFromInference(
  templateName: string,
  catalogEntry: TemplateCatalogEntry | null,
  inference: Inference | null,
  eligibility: TemplatePass1Eligibility,
): ResolvedTemplateManifest | null {
  const inferred = inference ? synthesizeManifest(templateName, inference) : null;
  const curated =
    !catalogEntry ||
    catalogEntry.provenance === 'protected' ||
    catalogEntry.provenance === 'dev-override'
      ? (bundledIntelligenceProvider.getTemplateManifest(templateName) ?? null)
      : null;
  const provenance = catalogEntry?.provenance ?? 'protected';
  const overridesLowerPrecedence = catalogEntry?.overridesLowerPrecedence ?? false;

  if (inferred && curated) {
    return {
      manifest: { ...inferred, ...curated, slots: mergeSlots(inferred.slots, curated.slots) },
      source: curatedSource(curated),
      fromBookmark: true,
      eligibility,
      provenance,
      overridesLowerPrecedence,
    };
  }
  if (inferred) {
    return {
      manifest: inferred,
      source: 'inferred',
      fromBookmark: true,
      eligibility,
      provenance,
      overridesLowerPrecedence,
    };
  }
  if (curated) {
    return {
      manifest: curated,
      source: curatedSource(curated),
      fromBookmark: false,
      eligibility,
      provenance,
      overridesLowerPrecedence,
    };
  }
  return null;
}

/**
 * Resolve a template's FULL manifest by name, applying the same infer-first /
 * overlay-curated semantics as {@link resolveTemplateSlots}: inference is the base, a
 * curated manifest wins field-by-field, and the slot lists are unioned by template_field
 * via {@link mergeSlots}. Curated top-level metadata (family, intent_keywords, avoid_when,
 * calcs, fast_path_*, portability_evidence, description) overrides the inferred defaults;
 * any field the curated manifest omits keeps the inferred value.
 *
 * Returns `null` (never throws) when the name resolves to neither a bookmark nor a curated
 * manifest, so callers iterating the catalog can skip gracefully.
 */
export function resolveTemplateManifest(
  templateName: string,
  catalogEntry: TemplateCatalogEntry | null = getLegacyTemplateCatalogEntry(templateName),
): ResolvedTemplateManifest | null {
  const bookmarkXml = catalogEntry
    ? readBookmarkFromCatalogEntry(catalogEntry)
    : readBookmark(templateName);
  const inference = bookmarkXml ? inferFromBookmark(bookmarkXml) : null;
  const eligibility =
    bookmarkXml && inference
      ? deriveTemplatePass1Eligibility(bookmarkToTemplateWorkbook(bookmarkXml, inference))
      : { pass1_eligible: true, pass1_blockers: [] };
  return resolveTemplateManifestFromInference(templateName, catalogEntry, inference, eligibility);
}

/** Read one winning source version and derive every constructor input from that snapshot. */
export function resolveTemplateSnapshot(
  templateName: string,
  options: ResolveTemplateSnapshotOptions = {},
): ResolvedTemplateSnapshot | null {
  const catalogEntry =
    options.catalogEntry === undefined
      ? getTemplateCatalogEntry(templateName, { repositoryRoot: options.repositoryRoot })
      : options.catalogEntry;
  if (!catalogEntry) return null;

  const resolve = (): ResolvedTemplateSnapshot | null => {
    if (catalogEntry.format === 'tbm') {
      const bookmarkXml = readBookmarkFromCatalogEntry(catalogEntry);
      if (bookmarkXml === null) return null;
      const inference = inferFromBookmark(bookmarkXml);
      const converted = bookmarkToTemplateWorkbook(bookmarkXml, inference);
      const eligibility = deriveTemplatePass1Eligibility(converted);
      return {
        provenance: catalogEntry.provenance,
        overridesLowerPrecedence: catalogEntry.overridesLowerPrecedence,
        artifact: { xml: converted.xml, eligibility },
        resolvedManifest: resolveTemplateManifestFromInference(
          templateName,
          catalogEntry,
          inference,
          eligibility,
        ),
      };
    }

    const xml = readXmlFromCatalogEntry(catalogEntry);
    if (xml === null) return null;
    const eligibility = { pass1_eligible: true, pass1_blockers: [] };
    return {
      provenance: catalogEntry.provenance,
      overridesLowerPrecedence: catalogEntry.overridesLowerPrecedence,
      artifact: { xml, eligibility },
      resolvedManifest: resolveTemplateManifestFromInference(
        templateName,
        catalogEntry,
        null,
        eligibility,
      ),
    };
  };

  if (catalogEntry.provenance === 'protected') return resolve();
  try {
    return resolve();
  } catch {
    return null;
  }
}

export function resolveAllTemplateCatalog(
  options: TemplateCatalogOptions = {},
): Map<string, ResolvedTemplateManifest> {
  const catalog = new Map<string, ResolvedTemplateManifest>();
  for (const source of listTemplateSourceCatalog(options)) {
    if (source.provenance === 'protected') {
      const resolved = resolveTemplateManifest(source.template, source);
      if (resolved) catalog.set(source.template, resolved);
      continue;
    }
    try {
      const resolved = resolveTemplateManifest(source.template, source);
      if (resolved) catalog.set(source.template, resolved);
    } catch {
      // A single malformed or unreadable external template cannot sink discovery.
    }
  }
  return catalog;
}

/** Legacy apply catalog: MCP-protected assets, or the exclusive development override. */
export function resolveAllTemplateManifests(): Map<string, TemplateManifest> {
  const manifests = new Map<string, TemplateManifest>();
  for (const source of listLegacyTemplateCatalog()) {
    const resolved = resolveTemplateManifest(source.template, source);
    if (resolved) manifests.set(source.template, resolved.manifest);
  }
  return manifests;
}
