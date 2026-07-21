import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from '../metadata/field-resolver.js';
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
      fieldMetadata: Record<string, { datatype: string; type: string }>;
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
    return {
      ok: true,
      template: templateName,
      datasource: opts.datasource ?? schema.datasource,
      fieldMapping: Array.isArray(input) ? (opts.passthroughFieldMapping ?? {}) : input,
      fieldMetadata: {},
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

  const used = new Set<SchemaField>();
  const reusableByTemplateField = new Map<string, ResolvedSource>();
  const fieldBySlot = new Map<string, SchemaField>();
  const bindings: BindingProposal['bindings'] = [];

  for (const slot of manifest.slots) {
    if (!slot.bindable) continue;
    const source = takeCompatibleSource(slot, sources, used, reusableByTemplateField);
    if (!source) continue;
    reusableByTemplateField.set(slot.template_field, source);
    fieldBySlot.set(slot.slot_id, source.field);
    bindings.push({ slot_id: slot.slot_id, field: source.field.name });
  }

  return {
    proposal: { template: manifest.template, title: title ?? manifest.template, bindings },
    fieldBySlot,
    warnings,
  };
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
    const source = takeCompatibleSource(slot, remainingSources, usedFields, new Map());
    if (!source) continue;
    usedFields.add(source.field);
    fieldBySlot.set(slot.slot_id, source.field);
    bindings.push({ slot_id: slot.slot_id, field: source.field.name });
  }

  return {
    proposal: { template: manifest.template, title: title ?? manifest.template, bindings },
    fieldBySlot,
    warnings,
  };
}

function takeCompatibleSource(
  slot: SlotSpec,
  sources: ResolvedSource[],
  used: Set<SchemaField>,
  reusableByTemplateField: Map<string, ResolvedSource>,
): ResolvedSource | null {
  const reusable = reusableByTemplateField.get(slot.template_field);
  if (reusable && kindCompatible(slot.kind, reusable.field)) return reusable;

  for (const source of sources) {
    if (used.has(source.field)) continue;
    if (!kindCompatible(slot.kind, source.field)) continue;
    used.add(source.field);
    return source;
  }

  return null;
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
    default:
      return false;
  }
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
    const deriv = field.isAggregated ? 'usr' : slot.derivation;
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
): Record<string, { datatype: string; type: string }> {
  const metadata: Record<string, { datatype: string; type: string }> = {};
  for (const slot of manifest.slots) {
    const field = fieldBySlot.get(slot.slot_id);
    if (!field) continue;
    const key = slot.qualified_key_required
      ? `${slot.template_field}@${slot.derivation}`
      : slot.template_field;
    metadata[key] = { datatype: field.datatype, type: field.type };
  }
  return metadata;
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
    case 'derivation-illegal':
      return 'Drop the illegal derivation override or bind a field whose datatype supports it.';
    case 'base-column-conflict':
      return 'Use the same base column for all qualified derivations of one template field.';
    case 'cross-datasource-binding':
      return 'Bind all template slots from a single datasource.';
    case 'calc-dependency-unmet':
      return 'Bind every manifest slot required by the template-owned calculation.';
    default:
      return 'Fall back to plan-dashboard-creation, placing fields per sheet with add-field.';
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
