import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from '../metadata/field-resolver.js';
import type { FieldMetadataOverride } from '../templates/fieldReferenceRewriter.js';
import {
  optionalFieldPrunesFor,
  type OptionalFieldPruneSpec,
} from '../templates/optionalFieldPrune.js';
import { geoConceptFromSemanticRole, geoConceptFromSlotId } from './geo-concept.js';
import { loadManifests } from './manifest.js';
import type { Derivation, SlotSpec, TemplateManifest } from './manifest-types.js';
import { bareName, type SchemaField, type SchemaSummary } from './schema-summary.js';
import { type BindingProposal, type Blocker, validateBinding } from './validate.js';

export type ExplicitBindInput = string[] | Record<string, string>;

export interface AvailableFieldLike {
  datasource: string;
  columnName: string;
  role: string;
  type: string;
  datatype?: string;
  caption?: string;
  isAggregated?: boolean;
  isGroup?: boolean;
  column_ref: string;
}

export interface ExplicitBindOptions {
  manifests?: Map<string, TemplateManifest>;
  title?: string;
  datasource?: string;
  passthroughFieldMapping?: Record<string, string>;
}

export interface ExplicitBindError {
  code: string;
  slot_id?: string;
  detail: string;
  candidates?: string[];
  fix: string;
}

export type ExplicitBindResult =
  | {
      ok: true;
      template: string;
      datasource: string;
      fieldMapping: Record<string, string>;
      fieldMetadata: Record<string, FieldMetadataOverride>;
      consumedFieldRefs: string[];
      templateSlots: SlotSpec[];
      optionalFieldPrunes: OptionalFieldPruneSpec[];
      warnings: string[];
      passthrough: boolean;
    }
  | {
      ok: false;
      template: string;
      errors: ExplicitBindError[];
      blockers: Blocker[];
      warnings: string[];
    };

interface ResolvedSource {
  raw: string;
  field: SchemaField;
}

interface ProposalBuild {
  proposal: BindingProposal;
  fieldBySlot: Map<string, SchemaField>;
  warnings: string[];
}

interface GreedyAssignment {
  slot: SlotSpec;
  field: SchemaField;
  affinityPlaced: boolean;
}

interface CompatibleSourceSelection {
  source: ResolvedSource;
  affinityPlaced: boolean;
}

export function schemaSummaryFromAvailableFields(fields: AvailableFieldLike[]): SchemaSummary {
  const summaryFields: SchemaField[] = fields.map((f) => {
    const bare = bareName(f.columnName);
    const caption = f.caption && f.caption.length > 0 ? f.caption : undefined;
    return {
      name: caption ?? bare,
      caption,
      columnName: f.columnName,
      role: f.role === 'measure' ? 'measure' : 'dimension',
      type: f.type,
      datatype: f.datatype ?? '',
      datasource: f.datasource,
      isAggregated: !!f.isAggregated,
      ...(f.isGroup ? { isGroup: true } : {}),
      column_ref: f.column_ref,
    };
  });

  return { datasource: pickPrimaryDatasource(summaryFields), fields: summaryFields };
}

export function bindExplicitTemplate(
  templateName: string,
  input: ExplicitBindInput,
  schema: SchemaSummary,
  opts: ExplicitBindOptions = {},
): ExplicitBindResult {
  // Fail-open when the manifest layer is unavailable (e.g. broken disk assets or
  // heavily-mocked test envs): explicit applies degrade to legacy passthrough with
  // a warning instead of crashing. SEA builds already fail closed inside
  // loadManifests when the embedded supply is broken.
  let manifest: TemplateManifest | undefined;
  let manifestLayerUnavailable = false;
  try {
    const manifests = opts.manifests ?? loadManifests();
    manifest = manifests.get(templateName);
  } catch {
    manifestLayerUnavailable = true;
  }

  if (!manifest) {
    const fieldMapping = Array.isArray(input) ? (opts.passthroughFieldMapping ?? {}) : input;
    return {
      ok: true,
      template: templateName,
      datasource: opts.datasource ?? schema.datasource,
      fieldMapping,
      fieldMetadata: {},
      consumedFieldRefs: Object.values(fieldMapping),
      templateSlots: [],
      optionalFieldPrunes: [],
      warnings: [
        manifestLayerUnavailable
          ? `manifest-layer-unavailable: could not load template manifests; caller mapping for '${templateName}' applied without enforcement.`
          : `no-manifest: template '${templateName}' has no manifest; caller mapping applied without enforcement.`,
      ],
      passthrough: true,
    };
  }

  const warnings = manifestWarnings(manifest);
  const built = Array.isArray(input)
    ? buildProposalFromOrderedRefs(manifest, input, schema, opts.title)
    : buildProposalFromFieldMapping(manifest, input, schema, opts.title);
  warnings.push(...built.warnings);

  const validation = validateBinding(manifest, built.proposal, schema);
  if (!validation.ok) {
    return {
      ok: false,
      template: templateName,
      blockers: validation.blockers,
      errors: validation.blockers.map(blockerToFixError),
      warnings,
    };
  }

  return {
    ok: true,
    template: templateName,
    datasource: rawDatasourceFor(built.fieldBySlot, opts.datasource ?? schema.datasource),
    fieldMapping: emitRawFieldMapping(manifest, built.fieldBySlot),
    fieldMetadata: fieldMetadataFor(manifest, built.fieldBySlot),
    consumedFieldRefs: consumedFieldRefsFor(manifest, built.fieldBySlot),
    templateSlots: manifest.slots,
    optionalFieldPrunes: optionalFieldPrunesFor(manifest, built.fieldBySlot),
    warnings: [...warnings, ...(validation.warnings ?? [])],
    passthrough: false,
  };
}

export function formatExplicitBindErrors(
  templateName: string,
  errors: ExplicitBindError[],
): string {
  const rendered = errors
    .map((e) => {
      const slot = e.slot_id ? ` (slot '${e.slot_id}')` : '';
      const candidates =
        e.candidates && e.candidates.length > 0
          ? `\n      candidates: ${e.candidates.join(', ')}`
          : '';
      return `  - [${e.code}]${slot} ${e.detail}${candidates}\n    FIX: ${e.fix}`;
    })
    .join('\n');

  return `Explicit template binding BLOCKED for '${templateName}'. No worksheet was produced.\n\n${rendered}`;
}

function buildProposalFromOrderedRefs(
  manifest: TemplateManifest,
  refs: string[],
  schema: SchemaSummary,
  title?: string,
): ProposalBuild {
  const warnings: string[] = [];
  const sources: ResolvedSource[] = [];

  for (const ref of refs) {
    const resolved = resolveSource(ref, schema);
    if ('field' in resolved) sources.push(resolved);
    else warnings.push(`unresolved-column-ref: ${resolved.detail}`);
  }

  const needsGeocodableGeo = requiresGeocodableGeo(manifest);
  const used = new Set<SchemaField>();
  const reusableByTemplateField = new Map<string, ResolvedSource>();
  const fieldBySlot = new Map<string, SchemaField>();
  const bindings: BindingProposal['bindings'] = [];
  const greedyAssignments: GreedyAssignment[] = [];

  const orderedSlots = manifest.slots.filter((slot) => slot.bindable);
  for (const [index, slot] of orderedSlots.entries()) {
    if (shouldReserveCategoricalSource(slot, orderedSlots.slice(index + 1), sources, used)) {
      continue;
    }
    const selection = takeCompatibleSource(
      slot,
      sources,
      used,
      reusableByTemplateField,
      needsGeocodableGeo,
    );
    if (!selection) continue;
    const { source, affinityPlaced } = selection;
    reusableByTemplateField.set(slot.template_field, source);
    fieldBySlot.set(slot.slot_id, source.field);
    bindings.push({ slot_id: slot.slot_id, field: source.field.name });
    greedyAssignments.push({ slot, field: source.field, affinityPlaced });
  }
  appendCategoricalSwapWarning(warnings, greedyAssignments);

  return {
    proposal: { template: manifest.template, title: title ?? manifest.template, bindings },
    fieldBySlot,
    warnings,
  };
}

function shouldReserveCategoricalSource(
  slot: SlotSpec,
  laterSlots: SlotSpec[],
  sources: ResolvedSource[],
  used: Set<SchemaField>,
): boolean {
  if (slot.required || slot.kind !== 'categorical') return false;
  const compatible = sources.filter(
    (source) => !used.has(source.field) && kindCompatible(slot.kind, source.field),
  );
  const laterRequired = laterSlots.filter(
    (candidate) => candidate.required && candidate.kind === 'categorical',
  ).length;
  return compatible.length <= laterRequired;
}

function buildProposalFromFieldMapping(
  manifest: TemplateManifest,
  mapping: Record<string, string>,
  schema: SchemaSummary,
  title?: string,
): ProposalBuild {
  const warnings: string[] = [];
  const usedKeys = new Set<string>();
  const usedFields = new Set<SchemaField>();
  const fieldBySlot = new Map<string, SchemaField>();
  const bindings: BindingProposal['bindings'] = [];
  const greedyAssignments: GreedyAssignment[] = [];

  // The caller (the agent) owns slot→field mapping on this path: we bind ONLY the slots
  // it explicitly keyed. Unmapped slots are deliberately left unbound — a required one
  // then surfaces as a `missing-required-slot` blocker in validate.ts so the agent learns
  // the slot is required, and an optional one is handled by the optional-field mechanism.
  // We never auto-fill an unmapped slot from leftover mapping values (that guessing lives
  // only on the ordered-refs / ShowMe path via autoMapFields).
  for (const slot of manifest.slots) {
    if (!slot.bindable) continue;
    const key = mappingKeyForSlot(slot, manifest, mapping);
    if (!key) continue;

    const resolved = resolveSource(mapping[key], schema);
    if (!('field' in resolved)) {
      warnings.push(`unresolved-field-mapping: key '${key}' -> ${resolved.detail}`);
      continue;
    }

    usedKeys.add(key);
    usedFields.add(resolved.field);
    fieldBySlot.set(slot.slot_id, resolved.field);
    bindings.push({ slot_id: slot.slot_id, field: resolved.field.name });
  }

  const remainingSources: ResolvedSource[] = [];
  for (const [key, value] of Object.entries(mapping)) {
    if (usedKeys.has(key)) continue;
    const resolved = resolveSource(value, schema);
    if ('field' in resolved) remainingSources.push(resolved);
  }

  for (const slot of manifest.slots) {
    if (!slot.bindable || !slot.required || fieldBySlot.has(slot.slot_id)) continue;
    const selection = takeCompatibleSource(
      slot,
      remainingSources,
      usedFields,
      new Map(),
      requiresGeocodableGeo(manifest),
    );
    if (!selection) continue;
    const { source, affinityPlaced } = selection;
    usedFields.add(source.field);
    fieldBySlot.set(slot.slot_id, source.field);
    bindings.push({ slot_id: slot.slot_id, field: source.field.name });
    greedyAssignments.push({ slot, field: source.field, affinityPlaced });
  }
  appendCategoricalSwapWarning(warnings, greedyAssignments);

  return {
    proposal: { template: manifest.template, title: title ?? manifest.template, bindings },
    fieldBySlot,
    warnings,
  };
}

/**
 * Preference score among kind-compatible candidates — higher wins, ties keep
 * schema order so every existing bind is unchanged unless a genuinely better
 * candidate exists.
 *
 * Only geo slots score today. Without this, the FIRST kind-compatible field in
 * schema order won a geo slot, so a `city` slot could take a Country-tagged field
 * merely because it appeared earlier — the concept-mismatch that validate.ts then
 * rejects as a blocker (the §0 probe's sole Superstore bind failure). Ranking by
 * declared concept means the right field is proposed instead of a valid bind being
 * turned into an error.
 */
function slotAffinity(slot: SlotSpec, f: SchemaField): number {
  if (slot.kind !== 'geo') return 0;
  const slotConcept = geoConceptFromSlotId(slot.slot_id);
  const fieldConcept = geoConceptFromSemanticRole(f.semanticRole);
  if (slotConcept && fieldConcept) return slotConcept === fieldConcept ? 3 : -1;
  // A geocodable field still beats an untagged one for a geo slot.
  if (fieldConcept || f.semanticRole) return 1;
  return 0;
}

function takeCompatibleSource(
  slot: SlotSpec,
  sources: ResolvedSource[],
  used: Set<SchemaField>,
  reusableByTemplateField: Map<string, ResolvedSource>,
  needsGeocodableGeo = false,
): CompatibleSourceSelection | null {
  const reusable = reusableByTemplateField.get(slot.template_field);
  if (reusable && kindCompatible(slot.kind, reusable.field, needsGeocodableGeo)) {
    return { source: reusable, affinityPlaced: false };
  }

  if (slot.kind === 'categorical') {
    const affine = sources.filter(
      (source) =>
        !used.has(source.field) &&
        !source.field.isGroup &&
        kindCompatible(slot.kind, source.field, needsGeocodableGeo) &&
        fieldNameMatchesSlot(source.field, slot),
    );
    if (affine.length === 1) {
      used.add(affine[0].field);
      return { source: affine[0], affinityPlaced: true };
    }
  }

  let best: ResolvedSource | null = null;
  let bestScore = -Infinity;
  for (const source of sources) {
    if (used.has(source.field)) continue;
    if (source.field.isGroup) continue;
    if (!kindCompatible(slot.kind, source.field, needsGeocodableGeo)) continue;
    const score = slotAffinity(slot, source.field);
    if (score > bestScore) {
      best = source;
      bestScore = score;
    }
  }

  if (!best) return null;
  used.add(best.field);
  return { source: best, affinityPlaced: false };
}

function fieldNameMatchesSlot(field: SchemaField, slot: SlotSpec): boolean {
  if (slot.template_field.includes('{{')) return false;
  const templateFieldName = normalizeComparableName(slot.template_field);
  return [field.name, field.caption, bareName(field.columnName)]
    .filter((name): name is string => typeof name === 'string')
    .map(normalizeComparableName)
    .some((name) => name === templateFieldName);
}

function normalizeComparableName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mappingKeyForSlot(
  slot: SlotSpec,
  manifest: TemplateManifest,
  mapping: Record<string, string>,
): string | null {
  const qualified = `${slot.template_field}@${slot.derivation}`;
  if (Object.prototype.hasOwnProperty.call(mapping, qualified)) return qualified;
  if (Object.prototype.hasOwnProperty.call(mapping, slot.slot_id)) return slot.slot_id;

  const duplicateTemplateField =
    manifest.slots.filter((s) => s.bindable && s.template_field === slot.template_field).length > 1;
  if (
    !duplicateTemplateField &&
    Object.prototype.hasOwnProperty.call(mapping, slot.template_field)
  ) {
    return slot.template_field;
  }

  return null;
}

function resolveSource(raw: string, schema: SchemaSummary): ResolvedSource | ExplicitBindError {
  const exact = schema.fields.find((f) => f.column_ref === raw);
  if (exact) return { raw, field: exact };

  const parsed = parseColumnRef(raw);
  if (parsed) {
    const matches = schema.fields.filter(
      (f) =>
        bareName(f.columnName) === parsed.base &&
        (!parsed.datasource || f.datasource === parsed.datasource),
    );
    if (matches.length === 1) return { raw, field: matches[0] };
    if (matches.length > 1) {
      return {
        code: 'ambiguous-field',
        detail: `"${raw}" matches ${matches.length} fields in schema`,
        candidates: matches.map((f) => f.column_ref),
        fix: 'Pass a fully qualified column_ref or resolve the field before applying the template.',
      };
    }
    return {
      code: 'field-not-found',
      detail: `no schema field matches "${raw}"`,
      fix: 'Use list-available-fields or resolve-field, then retry with a valid column_ref.',
    };
  }

  const named = schema.fields.filter(
    (f) => f.name === raw || f.caption === raw || bareName(f.columnName) === bareName(raw),
  );
  if (named.length === 1) return { raw, field: named[0] };
  if (named.length > 1) {
    return {
      code: 'ambiguous-field',
      detail: `"${raw}" matches ${named.length} fields in schema`,
      candidates: named.map((f) => f.column_ref),
      fix: 'Pass an exact column_ref instead of a bare field name.',
    };
  }

  return {
    code: 'field-not-found',
    detail: `no schema field matches "${raw}"`,
    fix: 'Use list-available-fields or resolve-field, then retry with a valid field.',
  };
}

function parseColumnRef(raw: string): { datasource?: string; base: string } | null {
  const trimmed = raw.trim();
  const qualified = parseDatasourceQualifiedColumnRef(trimmed);
  if (qualified) {
    const instance = parseColumnInstanceRef(qualified.columnInstanceName);
    return instance ? { datasource: qualified.datasource, base: instance.localFieldName } : null;
  }

  // Keep bare instances for legacy explicit mappings; fields.ts only accepts full refs.
  const instance = parseColumnInstanceRef(trimmed);
  return instance ? { base: instance.localFieldName } : null;
}

const TEMPORAL_DATATYPES: ReadonlySet<string> = new Set(['date', 'datetime']);
const TRUNCATION_DERIVATIONS: ReadonlySet<string> = new Set(['tyr', 'tqr', 'tmn', 'tdy']);

/**
 * On a template whose rows/cols are Tableau's GENERATED Latitude/Longitude, a geo
 * slot must receive a field the datasource actually geocodes. `requiresGeocodableGeo`
 * is keyed on the manifest's own `generated-geo-required` hazard rather than on
 * `kind: 'geo'` at large, because two templates use geo slots without needing
 * geocoding (distribution-bar-code-chart puts them on detail; spatial-symbol-map-latlon
 * plots real coordinate measures) and must keep accepting untagged dimensions.
 */
const GENERATED_GEO_HAZARD = 'generated-geo-required';

function requiresGeocodableGeo(manifest: TemplateManifest): boolean {
  return (manifest.hazards ?? []).some((h) => h.code === GENERATED_GEO_HAZARD);
}

function kindCompatible(
  kind: SlotSpec['kind'],
  f: SchemaField,
  needsGeocodableGeo = false,
): boolean {
  switch (kind) {
    case 'quantitative':
      return f.role === 'measure' || f.isAggregated;
    case 'categorical':
      return f.role === 'dimension' && (f.type === 'nominal' || f.type === 'ordinal');
    case 'quantitative-or-categorical':
      return (
        f.role === 'measure' ||
        f.isAggregated ||
        (f.role === 'dimension' && (f.type === 'nominal' || f.type === 'ordinal'))
      );
    case 'temporal':
      return TEMPORAL_DATATYPES.has(f.datatype);
    case 'geo':
      // A generated-Lat/Long map needs a genuinely geocoded field; elsewhere a geo
      // slot is a grain/detail pill and any dimension is fine.
      return f.role === 'dimension' && (!needsGeocodableGeo || !!f.semanticRole);
    default:
      return false;
  }
}

function appendCategoricalSwapWarning(warnings: string[], assignments: GreedyAssignment[]): void {
  const categorical = assignments.filter(
    ({ slot, field, affinityPlaced }) =>
      !affinityPlaced && slot.kind === 'categorical' && field.role === 'dimension',
  );
  if (categorical.length < 2) return;

  const landed = categorical
    .map(({ slot, field }) => `field '${field.name}' landed on slot '${slot.slot_id}'`)
    .join('; ');
  warnings.push(
    `Ambiguous categorical assignment: ${landed}. These categorical sources fit either slot and could swap when field order changes.`,
  );
}

function suffixFor(derivation: Derivation, type: string): string {
  if (TRUNCATION_DERIVATIONS.has(derivation)) return 'qk';
  if (type === 'quantitative') return 'qk';
  if (type === 'ordinal') return 'ok';
  return 'nk';
}

function emitRawFieldMapping(
  manifest: TemplateManifest,
  fieldBySlot: Map<string, SchemaField>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const slot of manifest.slots) {
    if (!slot.bindable) continue;
    const field = fieldBySlot.get(slot.slot_id);
    if (!field) continue;
    const deriv = field.isAggregated
      ? 'usr'
      : slot.kind === 'quantitative-or-categorical' && field.role === 'dimension'
        ? 'none'
        : slot.derivation;
    const key = slot.qualified_key_required
      ? `${slot.template_field}@${slot.derivation}`
      : slot.template_field;
    mapping[key] =
      `[${field.datasource}].[${deriv}:${bareName(field.columnName)}:${suffixFor(deriv, field.type)}]`;
  }
  return mapping;
}

function fieldMetadataFor(
  manifest: TemplateManifest,
  fieldBySlot: Map<string, SchemaField>,
): Record<string, FieldMetadataOverride> {
  const metadata: Record<string, FieldMetadataOverride> = {};
  for (const slot of manifest.slots) {
    const field = fieldBySlot.get(slot.slot_id);
    if (!field) continue;
    const key = slot.qualified_key_required
      ? `${slot.template_field}@${slot.derivation}`
      : slot.template_field;
    // semanticRole is the BOUND field's own geo role. Carrying it (and its absence)
    // lets the rewriter replace or drop the donor template's semantic-role instead of
    // transplanting a geography the target datasource never declared.
    metadata[key] = {
      datatype: field.datatype,
      type: field.type,
      ...(field.semanticRole ? { semanticRole: field.semanticRole } : {}),
    };
  }
  return metadata;
}

function consumedFieldRefsFor(
  manifest: TemplateManifest,
  fieldBySlot: Map<string, SchemaField>,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const slot of manifest.slots) {
    if (!slot.bindable) continue;
    const ref = fieldBySlot.get(slot.slot_id)?.column_ref;
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function rawDatasourceFor(fieldBySlot: Map<string, SchemaField>, fallback: string): string {
  return fieldBySlot.values().next().value?.datasource ?? fallback;
}

function manifestWarnings(m: TemplateManifest): string[] {
  const warnings: string[] = [];
  if (!m.fast_path_eligible) {
    warnings.push(
      `fast_path_eligible:false: explicit template apply is proceeding outside the fast path (readiness=${m.readiness}).`,
    );
    for (const blocker of m.fast_path_blockers ?? []) warnings.push(`fast_path_blocker:${blocker}`);
  }
  if (m.portability_evidence.render_verified === 'none') {
    warnings.push(`render_verified:none: template '${m.template}' has no live render stamp.`);
  }
  for (const hazard of m.hazards ?? []) {
    warnings.push(`hazard:${hazard.code}: ${hazard.detail}`);
  }
  return warnings;
}

function blockerToFixError(b: Blocker): ExplicitBindError {
  return {
    code: String(b.code),
    slot_id: b.slot_id,
    detail: b.detail,
    candidates: b.candidates,
    fix: fixForBlocker(b),
  };
}

function fixForBlocker(b: Blocker): string {
  switch (b.code) {
    case 'field-not-found':
      return 'Choose a candidate from list-available-fields or resolve the field, then retry.';
    case 'ambiguous-field':
      return 'Disambiguate with resolve-field and retry with an exact column_ref.';
    case 'missing-required-slot':
      return 'Provide a compatible field for this required manifest slot.';
    case 'kind-mismatch':
      return 'Bind a field whose role/type/datatype matches the manifest slot kind.';
    case 'geo-not-geocodable':
      return (
        'This map plots generated Latitude/Longitude, so the slot needs a field Tableau geocodes ' +
        '(one carrying a geographic semantic-role — a Country/State/City/Postal Code field). ' +
        'Rebind a geocodable field from the candidates, or choose a non-map template for these ' +
        'fields — a plain string dimension yields a map with zero marks.'
      );
    case 'derivation-illegal':
      return 'Drop the illegal derivation override or bind a field whose datatype supports it.';
    case 'aggregation-level-mismatch':
      return (
        'Bind a row-level (non-aggregated) measure or dimension to this slot. The template uses ' +
        'it inside a calculation, so an already-aggregated field (a SUM/AVG-based calc, or any ' +
        'table calc) breaks the formula — it either re-aggregates an already-aggregated field or ' +
        'mixes aggregate and non-aggregate arguments.'
      );
    case 'base-column-conflict':
      return 'Use the same base column for all qualified derivations of one template field.';
    case 'cross-datasource-binding':
      return 'Bind all template slots from a single datasource.';
    case 'calc-dependency-unmet':
      return 'Bind every manifest slot required by the template-owned calculation.';
    default:
      return 'Choose another eligible template from list-templates, then rebuild.';
  }
}

function pickPrimaryDatasource(fields: SchemaField[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const field of fields) {
    if (!counts.has(field.datasource)) order.push(field.datasource);
    counts.set(field.datasource, (counts.get(field.datasource) ?? 0) + 1);
  }

  let best = '';
  let bestCount = -1;
  for (const datasource of order) {
    const count = counts.get(datasource) ?? 0;
    if (count > bestCount) {
      best = datasource;
      bestCount = count;
    }
  }
  return best;
}
