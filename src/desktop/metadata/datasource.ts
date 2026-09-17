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

import Fuse from 'fuse.js';

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
// Resolution
// ---------------------------------------------------------------------------

export type ResolutionKind = 'exact' | 'rewritten' | 'fuzzy' | 'ambiguous' | 'not_found';

export interface Resolution {
  kind: ResolutionKind;
  /** The field that matched — set whenever there is a single winner. */
  match?: Field;
  /** The matched field, instantiated (default, or aggregated when parsed). */
  field?: FieldInstance;
  /** Ranked disambiguation set when ambiguous / suggestions when fuzzy. */
  candidates: Field[];
  rewrites?: string[];
  notes?: string[];
}

export interface ResolveOptions {
  /** Parse an aggregation prefix ("sum of Profit"); default false. */
  aggregationPrefix?: boolean;
  fuzzyThreshold?: number;
}

const AGG_PREFIX_REGEX =
  /^(sum|avg|average|min|minimum|max|maximum|count distinct|countd|count|median)\s+of\s+(.+)$/i;

const AGG_WORD_TO_TYPE: Record<string, AggregationType> = {
  sum: AggregationType.Sum,
  avg: AggregationType.Avg,
  average: AggregationType.Avg,
  min: AggregationType.Min,
  minimum: AggregationType.Min,
  max: AggregationType.Max,
  maximum: AggregationType.Max,
  count: AggregationType.Count,
  'count distinct': AggregationType.CountDistinct,
  countd: AggregationType.CountDistinct,
};

export function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

/** Human label for a field: caption when present, else the bare name. */
export function displayName(field: Field): string {
  return field.caption ?? stripBrackets(field.name);
}

function matchesExact(field: Field, query: string): boolean {
  return field.caption === query || field.name === query;
}

function matchesBare(field: Field, query: string): boolean {
  const target = stripBrackets(query).trim();
  return field.caption === target || stripBrackets(field.name) === target;
}

// --- Ambiguity policy + near-duplicate note (the shared primitives) ----------

function numericSuffixParts(name: string): { base: string; suffix: string | null } {
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match || match[1].length === 0) return { base: name, suffix: null };
  return { base: match[1], suffix: match[2] };
}

/**
 * A near-duplicate cleanup note when the chosen field belongs to a numeric-suffix
 * family (`Country`/`Country1`). Same policy as the legacy resolver.
 */
export function nearDuplicateNote(fields: ReadonlyArray<Field>, chosen: Field): string | undefined {
  const chosenName = displayName(chosen);
  const chosenBase = numericSuffixParts(chosenName).base;
  const family = fields.filter((f) => numericSuffixParts(displayName(f)).base === chosenBase);
  if (family.length < 2 || !family.some((f) => f !== chosen)) return undefined;
  const names = [...new Set(family.map(displayName))].sort((a, b) => {
    const aSuffix = numericSuffixParts(a).suffix;
    const bSuffix = numericSuffixParts(b).suffix;
    if (aSuffix === null && bSuffix !== null) return -1;
    if (aSuffix !== null && bSuffix === null) return 1;
    return a.localeCompare(b);
  });
  return `dataset has near-duplicate columns ${names.join('/')} - used ${chosenName}; consider cleaning the source`;
}

/**
 * Break a tie deterministically: an exact-caption match wins; else the single
 * unsuffixed member of a numeric-suffix family wins. Returns null when neither
 * rule applies (genuinely ambiguous).
 */
function disambiguateRanked(candidates: Field[], query: string): Field | null {
  const captionMatches = candidates.filter((f) => f.caption === query);
  if (captionMatches.length === 1) return captionMatches[0];

  const parts = candidates.map((c) => numericSuffixParts(displayName(c)));
  const bases = new Set(parts.map((p) => p.base));
  const unsuffixed = candidates.filter((_, i) => parts[i].suffix === null);
  const suffixed = candidates.filter((_, i) => parts[i].suffix !== null);
  if (bases.size === 1 && unsuffixed.length === 1 && suffixed.length > 0) {
    return unsuffixed[0];
  }
  return null;
}

/**
 * Resolve a name/ref to a field within one datasource, then instantiate.
 * Scoping is "which datasource you ask" — the caller picks `ds`.
 */
export function resolveField(ds: Datasource, query: string, opts: ResolveOptions = {}): Resolution {
  const trimmed = query.trim();
  if (!trimmed) return { kind: 'not_found', candidates: [] };

  // Exact column_ref (a fully-qualified instance ref).
  if (isGlobalFieldName(trimmed)) {
    const parts = parseCanonicalColumnRef(trimmed);
    const match = parts
      ? ds.fields.find((f) => stripBrackets(f.name) === parts.localFieldName)
      : undefined;
    if (match && parts && parts.datasource === ds.name) {
      return {
        kind: 'exact',
        match,
        field: { column_ref: trimmed as GlobalFieldName },
        candidates: [],
      };
    }
    // A qualified ref that misses must NOT fuzzy-match — it's already disambiguated.
    return { kind: 'not_found', candidates: [] };
  }

  const isBracketed = trimmed.startsWith('[') && trimmed.endsWith(']');

  // Phase 1: strict exact (caption or exact bracketed name).
  if (!isBracketed) {
    const exact = ds.fields.filter((f) => matchesExact(f, trimmed));
    if (exact.length === 1) return exactHit(ds, exact[0]);
    if (exact.length > 1) {
      const winner = disambiguateRanked(exact, trimmed);
      return winner ? exactHit(ds, winner) : ambiguous(exact);
    }
  }

  // Phase 2: bracket-stripped / case-sensitive bare match.
  const bare = ds.fields.filter((f) => matchesBare(f, trimmed));
  if (bare.length === 1) {
    return isBracketed
      ? { ...exactHit(ds, bare[0]), kind: 'rewritten', rewrites: ['normalized-brackets'] }
      : exactHit(ds, bare[0]);
  }
  if (bare.length > 1) {
    const winner = disambiguateRanked(bare, trimmed);
    return winner ? exactHit(ds, winner) : ambiguous(bare);
  }

  // Phase 3: aggregation prefix ("sum of Profit").
  if (opts.aggregationPrefix) {
    const m = trimmed.match(AGG_PREFIX_REGEX);
    if (m) {
      const reqWord = m[1].toLowerCase().replace(/\s+/g, ' ');
      const baseName = m[2].trim();
      const baseMatches = ds.fields.filter((f) => matchesBare(f, baseName));
      if (baseMatches.length === 1) {
        const base = baseMatches[0];
        const rewrites = ['parsed-aggregation-prefix'];
        const note = nearDuplicateNote(ds.fields, base);
        if (base.isAggregated) {
          return {
            kind: 'rewritten',
            match: base,
            field: defaultInstance(ds, base),
            candidates: [],
            rewrites: [...rewrites, 'ignored-redundant-aggregation'],
            ...(note ? { notes: [note] } : {}),
          };
        }
        const agg = AGG_WORD_TO_TYPE[reqWord] ?? base.defaultDerivation;
        return {
          kind: 'rewritten',
          match: base,
          field: instantiate(ds, base, agg),
          candidates: [],
          rewrites,
          ...(note ? { notes: [note] } : {}),
        };
      }
    }
  }

  // Phase 4: fuzzy did-you-mean.
  const fuse = new Fuse(ds.fields, {
    keys: ['caption', 'name'],
    threshold: opts.fuzzyThreshold ?? 0.4,
    includeScore: true,
  });
  const hits = fuse.search(stripBrackets(trimmed));
  if (hits.length === 0) return { kind: 'not_found', candidates: [] };
  const top = hits[0].item;
  return {
    kind: 'fuzzy',
    match: top,
    field: defaultInstance(ds, top),
    candidates: hits.map((h) => h.item),
  };
}

function exactHit(ds: Datasource, field: Field): Resolution {
  const note = nearDuplicateNote(ds.fields, field);
  return {
    kind: 'exact',
    match: field,
    field: defaultInstance(ds, field),
    candidates: [],
    ...(note ? { notes: [note] } : {}),
  };
}

function ambiguous(matches: Field[]): Resolution {
  return { kind: 'ambiguous', candidates: matches };
}
