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
import type {
  Derivation,
  RuntimeTemplateDescriptor,
  SlotSpec,
  TemplateBindingContract,
} from './manifest-types.js';
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
  semanticRole?: string;
  approxCount?: number;
  table?: string;
  isAggregated?: boolean;
  isGroup?: boolean;
  column_ref: string;
}

export interface ExplicitBindOptions {
  manifests?: Map<string, RuntimeTemplateDescriptor>;
  contract?: TemplateBindingContract;
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
      ...(f.semanticRole ? { semanticRole: f.semanticRole } : {}),
      ...(f.approxCount !== undefined ? { approxCount: f.approxCount } : {}),
      datasource: f.datasource,
      isAggregated: !!f.isAggregated,
      ...(f.isGroup ? { isGroup: true } : {}),
      ...(f.table ? { table: f.table } : {}),
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
  let contract = opts.contract;
  let descriptor: RuntimeTemplateDescriptor | undefined;
  if (!contract) {
    descriptor = opts.manifests?.get(templateName);
    contract = descriptor;
  }

  if (!contract) {
    const blocker: Blocker = {
      code: 'template-not-found',
      detail: `No TBM-derived binding contract is available for template '${templateName}'.`,
    };
    return {
      ok: false,
      template: templateName,
      blockers: [blocker],
      errors: [blockerToFixError(blocker)],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const built = Array.isArray(input)
    ? buildProposalFromOrderedRefs(contract, input, schema, opts.title)
    : buildProposalFromFieldMapping(contract, input, schema, opts.title);
  warnings.push(...built.warnings);

  const validation = validateBinding(contract, built.proposal, schema);
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
    fieldMapping: emitRawFieldMapping(contract, built.fieldBySlot),
    fieldMetadata: fieldMetadataFor(contract, built.fieldBySlot),
    consumedFieldRefs: consumedFieldRefsFor(contract, built.fieldBySlot),
    templateSlots: contract.slots,
    optionalFieldPrunes: optionalFieldPrunesFor(contract, built.fieldBySlot),
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
  manifest: TemplateBindingContract,
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
  const greedyAssignments: GreedyAssignment[] = [];

  const orderedSlots = manifest.slots.filter((slot) => slot.bindable);
  for (const [index, slot] of orderedSlots.entries()) {
    if (shouldReserveCategoricalSource(slot, orderedSlots.slice(index + 1), sources, used)) {
      continue;
    }
    const selection = takeCompatibleSource(slot, sources, used, reusableByTemplateField);
    if (!selection) continue;
    const { source, affinityPlaced } = selection;
    reusableByTemplateField.set(slot.template_field, source);
    fieldBySlot.set(slot.slot_id, source.field);
    bindings.push({ slot_id: slot.slot_id, field: source.field.column_ref });
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
    (source) =>
      !source.field.isGroup && !used.has(source.field) && kindCompatible(slot.kind, source.field),
  );
  const laterRequired = laterSlots.filter(
    (candidate) => candidate.required && candidate.kind === 'categorical',
  ).length;
  return compatible.length <= laterRequired;
}

function buildProposalFromFieldMapping(
  manifest: TemplateBindingContract,
  mapping: Record<string, string>,
  schema: SchemaSummary,
  title?: string,
): ProposalBuild {
  const warnings: string[] = [];
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

    fieldBySlot.set(slot.slot_id, resolved.field);
    bindings.push({ slot_id: slot.slot_id, field: resolved.field.column_ref });
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
): CompatibleSourceSelection | null {
  const reusable = reusableByTemplateField.get(slot.template_field);
  if (reusable && kindCompatible(slot.kind, reusable.field)) {
    return { source: reusable, affinityPlaced: false };
  }

  if (slot.kind === 'categorical') {
    const affine = sources.filter(
      (source) =>
        !used.has(source.field) &&
        !source.field.isGroup &&
        kindCompatible(slot.kind, source.field) &&
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
    if (!kindCompatible(slot.kind, source.field)) continue;
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

function slotAffinity(slot: SlotSpec, field: SchemaField): number {
  if (slot.kind !== 'geo') return 0;
  const slotConcept =
    geoConceptFromSemanticRole(slot.semantic_role) ?? geoConceptFromSlotId(slot.slot_id);
  const fieldConcept = geoConceptFromSemanticRole(field.semanticRole);
  if (slotConcept && fieldConcept) return slotConcept === fieldConcept ? 3 : -1;
  return fieldConcept || field.semanticRole ? 1 : 0;
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
  manifest: TemplateBindingContract,
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
    case 'quantitative-or-categorical':
      return (
        f.role === 'measure' ||
        f.isAggregated ||
        (f.role === 'dimension' && (f.type === 'nominal' || f.type === 'ordinal'))
      );
    case 'temporal':
      return TEMPORAL_DATATYPES.has(f.datatype);
    case 'geo':
      return f.role === 'dimension';
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

function suffixFor(
  derivation: Derivation,
  type: string,
  authoredRole?: 'nk' | 'ok' | 'qk',
): string {
  if (authoredRole) return authoredRole;
  if (TRUNCATION_DERIVATIONS.has(derivation)) return 'qk';
  if (type === 'quantitative') return 'qk';
  if (type === 'ordinal') return 'ok';
  return 'nk';
}

function emitRawFieldMapping(
  manifest: TemplateBindingContract,
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
      `[${field.datasource}].[${deriv}:${bareName(field.columnName)}:${suffixFor(deriv, field.type, slot.instance_role)}]`;
  }
  return mapping;
}

function fieldMetadataFor(
  manifest: TemplateBindingContract,
  fieldBySlot: Map<string, SchemaField>,
): Record<string, FieldMetadataOverride> {
  const metadata: Record<string, FieldMetadataOverride> = {};
  for (const slot of manifest.slots) {
    const field = fieldBySlot.get(slot.slot_id);
    if (!field) continue;
    const key = slot.qualified_key_required
      ? `${slot.template_field}@${slot.derivation}`
      : slot.template_field;
    metadata[key] = {
      datatype: field.datatype,
      type: field.type,
      ...(field.semanticRole ? { semanticRole: field.semanticRole } : {}),
    };
  }
  return metadata;
}

function consumedFieldRefsFor(
  manifest: TemplateBindingContract,
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
    case 'aggregation-level-mismatch':
      return 'Bind an unaggregated source field; an already aggregated field cannot feed this template calculation.';
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
