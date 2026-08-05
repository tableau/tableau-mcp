// Merge layer: resolve a template's bindable slots from inference, a curated manifest,
// or both — with a single public entry point the discovery + binding surface can call.
//
// The design (plan §3): INFER FIRST from the `.tbm` bookmark, then OVERLAY a curated
// manifest field-by-field when one exists (manifest wins per field, inference fills
// gaps). This makes a hand-authored manifest an OPTIONAL refinement, never a
// prerequisite: a bookmark dropped in with no manifest is fully usable (source
// 'inferred'); a curated one is upgraded (source 'curated' / 'render-verified').
//
// WHY: legacy manifests can reuse tokens for different shelves, so token text is not a safe join key.
//
// NOTHING here is chart-specific: it is a generic three-way merge over slot records.

import type { CalcSlot, SlotSpec, TemplateManifest } from '../binder/manifest-types.js';
import { bundledIntelligenceProvider } from '../intelligence/provider.js';
import {
  bookmarkToTemplateWorkbook,
  deriveTemplatePass1Eligibility,
  hasExternalExecutionCalculationFunction,
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

const STRUCTURAL_SLOT_ROLES = new Set([
  'rows',
  'cols',
  'mark',
  'color',
  'size',
  'text',
  'label',
  'detail',
  'lod',
  'tooltip',
  'shape',
  'path',
  'geometry',
  'angle',
  'wedge-size',
  'filter',
  'title',
  'reference-line',
]);

function structuralRoles(slot: SlotSpec): string[] {
  return slot.role.filter((role) => STRUCTURAL_SLOT_ROLES.has(role)).sort();
}

function sameStructuralRoles(left: SlotSpec, right: SlotSpec): boolean {
  const leftRoles = structuralRoles(left);
  const rightRoles = structuralRoles(right);
  return (
    leftRoles.length === rightRoles.length &&
    leftRoles.every((role, index) => role === rightRoles[index])
  );
}

function slotJoinKey(slot: SlotSpec): string {
  return `${slot.template_field}\u001f${slot.derivation}`;
}

function curatedStructureAligns(inferred: SlotSpec[], curated: SlotSpec[]): boolean {
  if (curated.some((slot) => !FIELD_BASE_TOKEN.test(slot.template_field))) return false;

  const inferredByToken = new Map<string, SlotSpec[]>();
  for (const slot of inferred) {
    const matches = inferredByToken.get(slot.template_field) ?? [];
    matches.push(slot);
    inferredByToken.set(slot.template_field, matches);
  }

  for (const curatedSlot of curated) {
    const sameToken = inferredByToken.get(curatedSlot.template_field);
    if (!sameToken) continue;
    const inferredSlot = sameToken.find(
      (candidate) => candidate.derivation === curatedSlot.derivation,
    );
    if (
      !inferredSlot ||
      inferredSlot.kind !== curatedSlot.kind ||
      !sameStructuralRoles(inferredSlot, curatedSlot)
    ) {
      return false;
    }
  }
  return true;
}

function mergeSlots(inferred: SlotSpec[], curated: SlotSpec[]): SlotSpec[] {
  const alignedCurated = curatedStructureAligns(inferred, curated) ? curated : [];
  const curatedByField = new Map(alignedCurated.map((slot) => [slotJoinKey(slot), slot]));
  const merged: SlotSpec[] = inferred.map((s) =>
    overlaySpec(s, curatedByField.get(slotJoinKey(s))),
  );
  const inferredFields = new Set(inferred.map(slotJoinKey));
  for (const s of alignedCurated) {
    if (inferredFields.has(slotJoinKey(s))) continue;
    if (!FIELD_BASE_TOKEN.test(s.template_field)) continue;
    merged.push(s);
  }
  return merged;
}

function overlayCalc(inferred: CalcSlot | undefined, curated: CalcSlot | undefined): CalcSlot {
  if (!curated) return inferred as CalcSlot;
  if (!inferred) return curated;

  const merged: CalcSlot = {
    ...curated,
    ...inferred,
    slot_id: curated.slot_id || inferred.slot_id,
    purpose: curated.purpose ?? inferred.purpose,
    examples: curated.examples ?? inferred.examples,
    hint: curated.hint ?? inferred.hint,
    notes: curated.notes ?? inferred.notes,
    result_role: curated.result_role ?? inferred.result_role,
    avoid_when: curated.avoid_when ?? inferred.avoid_when,
    prereqs: curated.prereqs ?? inferred.prereqs,
  };
  // Curated inputs name legacy slot ids; only inference can supply inputs aligned to a .tbm.
  if (inferred.inputs === undefined) delete merged.inputs;
  return merged;
}

function mergeCalcs(inferred: CalcSlot[], curated: CalcSlot[]): CalcSlot[] {
  const curatedByField = new Map(curated.map((calc) => [calc.template_field, calc]));
  const merged = inferred.map((calc) => overlayCalc(calc, curatedByField.get(calc.template_field)));
  const inferredFields = new Set(inferred.map((calc) => calc.template_field));
  for (const calc of curated) {
    if (!inferredFields.has(calc.template_field)) merged.push(calc);
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

export const UNTRUSTED_EXTERNAL_CALCULATION_BLOCKER = 'untrusted-external-calculation-function';

function isTrustedTemplateProvenance(provenance: TemplateProvenance): boolean {
  return provenance === 'protected' || provenance === 'dev-override';
}

function deriveCatalogEligibility(
  bookmarkXml: string,
  converted: Pick<ReturnType<typeof bookmarkToTemplateWorkbook>, 'bareRefs' | 'xml'>,
  provenance: TemplateProvenance,
): TemplatePass1Eligibility {
  const eligibility = deriveTemplatePass1Eligibility(converted);
  if (
    isTrustedTemplateProvenance(provenance) ||
    !hasExternalExecutionCalculationFunction(bookmarkXml)
  ) {
    return eligibility;
  }
  const pass1_blockers = [
    ...new Set([...eligibility.pass1_blockers, UNTRUSTED_EXTERNAL_CALCULATION_BLOCKER]),
  ];
  return { pass1_eligible: false, pass1_blockers };
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
      manifest: {
        ...inferred,
        ...curated,
        slots: mergeSlots(inferred.slots, curated.slots),
        calcs: mergeCalcs(inferred.calcs, curated.calcs),
      },
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
  const provenance = catalogEntry?.provenance ?? 'protected';
  const eligibility =
    bookmarkXml && inference
      ? deriveCatalogEligibility(
          bookmarkXml,
          bookmarkToTemplateWorkbook(bookmarkXml, inference),
          provenance,
        )
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
      const eligibility = deriveCatalogEligibility(bookmarkXml, converted, catalogEntry.provenance);
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
