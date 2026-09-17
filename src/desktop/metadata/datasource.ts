/**
 * Field-resolution domain layer (trial).
 *
 * A first-class model over what `listAvailableFields` returns today as a flat
 * bag of `FieldReference & { column_ref }`:
 *
 *   Datasource  --owns-->  Field (union by `kind`)  --instantiates-->  FieldInstance
 *
 * Design: docs/field-resolution-unification.md. Principles honoured here:
 *   - `Field` is the owned umbrella (a DB column is one `kind`).
 *   - A `FieldInstance` is (almost) just its `column_ref`; datasource / derivation
 *     / base name / instance name all DERIVE from that ref via free accessor
 *     functions (no duplicated fields, no classes).
 *   - Names are branded strings so a qualified ref can't be passed where a local
 *     one is expected.
 *
 * This is a trial: it builds the model from `listAvailableFields` output and
 * resolves against it, alongside (not yet replacing) the existing resolvers.
 */

import { DERIVATION_LONG_TO_SHORT } from '../derivations.js';
import { listAvailableFields } from './field-builder.js';
import {
  COLUMN_REF_REGEX,
  formatCanonicalColumnRef,
  parseCanonicalColumnRef,
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from './field-resolver.js';
import { normalizeArray, parseXML } from './parser.js';
import { AggregationType, type FieldReference } from './types.js';

// ---------------------------------------------------------------------------
// Branded name strings
// ---------------------------------------------------------------------------

/** A single bracketed segment with no datasource: `[Region]`, `[sum:Sales:qk]`. */
export type LocalFieldName = string & { readonly __brand: 'LocalFieldName' };
/** A datasource-qualified instance ref: `[Sample - Superstore].[sum:Sales:qk]` (the column_ref). */
export type GlobalFieldName = string & { readonly __brand: 'GlobalFieldName' };

export function isLocalFieldName(s: string): s is LocalFieldName {
  return s.startsWith('[') && s.endsWith(']') && !COLUMN_REF_REGEX.test(s);
}

export function isGlobalFieldName(s: string): s is GlobalFieldName {
  return COLUMN_REF_REGEX.test(s);
}

/** Assert a bare bracketed local name. Throws on a qualified ref. */
export function asLocalFieldName(s: string): LocalFieldName {
  if (!isLocalFieldName(s)) {
    throw new Error(`not a LocalFieldName: ${JSON.stringify(s)}`);
  }
  return s;
}

/** Assert a datasource-qualified column ref. Throws otherwise. */
export function asGlobalFieldName(s: string): GlobalFieldName {
  if (!isGlobalFieldName(s)) {
    throw new Error(`not a GlobalFieldName: ${JSON.stringify(s)}`);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type FieldRole = 'dimension' | 'measure';

interface FieldBase {
  /** Bare bracketed field name, e.g. `[Sales]` (today's columnName). */
  name: LocalFieldName;
  caption?: string;
  datatype?: string;
  role: FieldRole;
  folder?: string;
  /** Aggregation baked into the default instance: measure→Sum, calc→User, else None. */
  defaultDerivation: AggregationType;
  // Definition metadata needed to reconstruct instance refs / for callers:
  /** VizQL type: 'quantitative' | 'ordinal' | 'nominal' (drives the ref type-code). */
  vizType: string;
  /** True for calcs whose formula already aggregates (SUM(...) etc.) — never re-aggregated. */
  isAggregated: boolean;
}

export interface ColumnField extends FieldBase {
  kind: 'column';
}
export interface CalculationField extends FieldBase {
  kind: 'calculation';
  formula: string;
}
export interface BinField extends FieldBase {
  kind: 'bin';
}

/**
 * A data-pane field. Union by `kind`, scoped to what the workbook actually
 * distinguishes today: `column`, `calculation`, `bin` (categorical-bin).
 * Sets and hierarchies are NOT modeled — `listAvailableFields` never emits them.
 */
export type Field = ColumnField | CalculationField | BinField;

/**
 * A Field used with one derivation. Stores only its ref (single source of
 * truth) plus the one piece of state the ref can't carry — a per-instance role
 * reinterpretation. Everything else derives (see accessors).
 */
export interface FieldInstance {
  column_ref: GlobalFieldName;
  /** Per-instance dimension/measure override; undefined = use the Field's role. */
  roleOverride?: FieldRole;
}

export interface Datasource {
  readonly name: string;
  readonly caption?: string;
  readonly fields: ReadonlyArray<Field>;
}

// ---------------------------------------------------------------------------
// FieldInstance accessors — derive from the ref (wrap the existing parsers)
// ---------------------------------------------------------------------------

export function datasourceOf(instance: FieldInstance): string {
  const parsed = parseDatasourceQualifiedColumnRef(instance.column_ref);
  if (!parsed) throw new Error(`malformed column_ref: ${instance.column_ref}`);
  return parsed.datasource;
}

export function instanceNameOf(instance: FieldInstance): LocalFieldName {
  const parsed = parseDatasourceQualifiedColumnRef(instance.column_ref);
  if (!parsed) throw new Error(`malformed column_ref: ${instance.column_ref}`);
  return parsed.columnInstanceName as LocalFieldName;
}

/** The base (bracketed) field name the instance points back to: `[Sales]`. */
export function baseFieldNameOf(instance: FieldInstance): LocalFieldName {
  const parts = parseCanonicalColumnRef(instance.column_ref);
  if (!parts) throw new Error(`malformed column_ref: ${instance.column_ref}`);
  return `[${parts.localFieldName}]` as LocalFieldName;
}

/** The instance's derivation short-form (`sum`, `none`, `usr`, …). */
export function derivationOf(instance: FieldInstance): string {
  const parts = parseColumnInstanceRef(instanceNameOf(instance));
  if (!parts) throw new Error(`malformed column-instance name in: ${instance.column_ref}`);
  return parts.derivation;
}

// ---------------------------------------------------------------------------
// Instance construction
// ---------------------------------------------------------------------------

// Map the aggregation enum to the ONE canonical short-form table (derivations.ts)
// rather than re-spelling 'sum'/'usr'/… here — no drift.
const DERIVATION_SHORT: Record<AggregationType, string> = {
  [AggregationType.None]: DERIVATION_LONG_TO_SHORT.None,
  [AggregationType.Sum]: DERIVATION_LONG_TO_SHORT.Sum,
  [AggregationType.Avg]: DERIVATION_LONG_TO_SHORT.Avg,
  [AggregationType.Min]: DERIVATION_LONG_TO_SHORT.Min,
  [AggregationType.Max]: DERIVATION_LONG_TO_SHORT.Max,
  [AggregationType.Count]: DERIVATION_LONG_TO_SHORT.Count,
  [AggregationType.CountDistinct]: DERIVATION_LONG_TO_SHORT.CountD,
  [AggregationType.User]: DERIVATION_LONG_TO_SHORT.User,
};

function typeSuffixFor(vizType: string): string {
  if (vizType === 'quantitative') return 'qk';
  if (vizType === 'ordinal') return 'ok';
  return 'nk';
}

/** Build a specific instance ref for a field + derivation. */
function buildRef(ds: Datasource, field: Field, derivation: AggregationType): GlobalFieldName {
  // An already-aggregated calc always emits the 'usr' derivation regardless of
  // request — mirrors listAvailableFields / resolveField (no double-aggregation).
  const effective = field.isAggregated ? AggregationType.User : derivation;
  const ref = formatCanonicalColumnRef({
    datasource: ds.name,
    derivation: DERIVATION_SHORT[effective],
    localFieldName: stripBrackets(field.name),
    pivot: typeSuffixFor(field.vizType),
  });
  return ref as GlobalFieldName;
}

/** The field's default instance — what `listAvailableFields` bakes on today. */
export function defaultInstance(ds: Datasource, field: Field): FieldInstance {
  return { column_ref: buildRef(ds, field, field.defaultDerivation) };
}

/** A specific aggregated instance — what agg-prefix / a shelf drop mints. */
export function instantiate(
  ds: Datasource,
  field: Field,
  derivation: AggregationType,
): FieldInstance {
  return { column_ref: buildRef(ds, field, derivation) };
}

// ---------------------------------------------------------------------------
// Build the model from workbook XML
// ---------------------------------------------------------------------------

function toField(row: FieldReference): Field {
  const base: FieldBase = {
    name: (row.columnName.startsWith('[')
      ? row.columnName
      : `[${row.columnName}]`) as LocalFieldName,
    caption: row.caption,
    datatype: row.datatype,
    role: row.role === 'measure' ? 'measure' : 'dimension',
    folder: row.folder,
    defaultDerivation: row.derivation,
    vizType: row.type,
    isAggregated: !!row.isAggregated,
  };
  if (row.isGroup) return { ...base, kind: 'bin' };
  if (row.formula) return { ...base, kind: 'calculation', formula: row.formula };
  return { ...base, kind: 'column' };
}

/** Map each datasource's internal name to its caption (for display / selectors). */
function datasourceCaptions(workbookXml: string): Map<string, string> {
  const workbook = parseXML(workbookXml);
  const datasources = normalizeArray<Record<string, string>>(
    workbook.workbook?.datasources?.datasource,
  );
  const captions = new Map<string, string>();
  for (const ds of datasources) {
    const name = ds?.['@_name'];
    const caption = ds?.['@_caption'];
    if (name && caption) captions.set(name, caption);
  }
  return captions;
}

/** Parse a workbook into first-class Datasources, each owning its Fields. */
export function toDatasources(workbookXml: string): Datasource[] {
  const rows = listAvailableFields(workbookXml);
  const captions = datasourceCaptions(workbookXml);
  const byName = new Map<string, Field[]>();
  for (const row of rows) {
    const list = byName.get(row.datasource) ?? [];
    list.push(toField(row));
    byName.set(row.datasource, list);
  }
  return [...byName.entries()].map(([name, fields]) => ({
    name,
    caption: captions.get(name),
    fields,
  }));
}

// ---------------------------------------------------------------------------
// Name / label helpers (deterministic — not matching heuristics)
// ---------------------------------------------------------------------------

export function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

/** Human label for a field: caption when present, else the bare name. */
export function displayName(field: Field): string {
  return field.caption ?? stripBrackets(field.name);
}
