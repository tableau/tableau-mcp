/**
 * Multi-datasource field resolver.
 *
 * Today the codebase silently picks the first match for a user-friendly field
 * name across `findField` (single-datasource), `coordination.ts` (ad hoc
 * exact + agg-prefix logic), and `field-builder.ts` (`listAvailableFields`).
 * The agent then learns to "trust" the first guess. When the workbook has
 * two datasources both with a "Profit" column — or one with "Profit Ratio"
 * and another with "Profit (USD)" — that silent guess produces XML that
 * loads but binds the wrong field.
 *
 * `resolveField` makes ambiguity a first-class outcome, returning one of:
 *   - `exact`: a single, unambiguous match
 *   - `rewritten`: matched after applying a known transformation (parsed an
 *     `<agg> of <name>` prefix, normalized brackets, mapped a calculated
 *     field with embedded aggregation to derivation=User)
 *   - `ambiguous`: more than one candidate matches; caller MUST disambiguate
 *     (typically via `tableau-ask-user`) before applying
 *   - `not_found`: no match; returns fuzzy did-you-mean suggestions
 *
 * The resolver is pure: same workbook XML + same query => same output. It
 * does NOT emit events; the calling tool emits a `field_resolution` event
 * with the result.
 */
import Fuse from 'fuse.js';

import { listAvailableFields } from './field-builder.js';
import { normalizeArray, parseXML } from './parser.js';
import { AggregationType, type FieldReference } from './types.js';

export type FieldResolutionKind = 'exact' | 'rewritten' | 'ambiguous' | 'not_found';

export interface FieldCandidate {
  column_ref: string;
  datasource: string;
  caption?: string;
  column_name: string;
  role: string;
  is_aggregated: boolean;
}

export interface FieldResolution {
  kind: FieldResolutionKind;
  /** The original user-supplied query (echoed back for logging). */
  query: string;
  /**
   * The resolved column_ref. Present for `exact` and `rewritten`. Absent for
   * `ambiguous` (caller must pick from `candidates`) and `not_found`.
   */
  column_ref?: string;
  /** Datasource the resolved field belongs to (when single). */
  datasource?: string;
  /**
   * For `ambiguous` and `not_found`: the candidates the caller can choose
   * from (or surface as a did-you-mean prompt). For `not_found` these are
   * fuzzy suggestions; for `ambiguous` they are exact matches.
   */
  candidates?: FieldCandidate[];
  /** Human-readable explanation suitable for logging or surfacing to the user. */
  reason?: string;
  /** Advisory notes, e.g. deterministic duplicate-column choices the caller should surface. */
  notes?: string[];
  /**
   * For `rewritten`: the transformations applied (e.g.,
   * 'parsed-aggregation-prefix', 'mapped-calc-to-User').
   */
  rewrites?: string[];
}

export interface FieldResolveOptions {
  /** Restrict resolution to a single datasource by name (skips ambiguity across datasources). */
  datasource?: string;
  /** Number of fuzzy candidates to return on `not_found`. Defaults to 5. */
  maxFuzzyCandidates?: number;
  /** Fuse.js threshold (0 = exact, 1 = anything). Defaults to 0.4. */
  fuzzyThreshold?: number;
}

const AGG_PREFIX_REGEX =
  /^(sum|avg|average|mean|min|minimum|max|maximum|count|countd|count\s*distinct|countdistinct|median|stdev|stdevp|var|varp)\s+of\s+(.+)$/i;

export const COLUMN_REF_REGEX = /^\[([^\]]+)\]\.\[([^\]]+)\]$/;

export interface DatasourceQualifiedColumnRef {
  datasource: string;
  columnInstanceName: string;
}

export interface ColumnInstanceRefParts {
  derivation: string;
  localFieldName: string;
  pivot: string;
  columnInstanceName: string;
}

export type CanonicalColumnRefParts = Omit<ColumnInstanceRefParts, 'columnInstanceName'> & {
  datasource: string;
};

export type ParsedCanonicalColumnRef = CanonicalColumnRefParts & {
  columnInstanceName: string;
};

export function parseDatasourceQualifiedColumnRef(
  columnRef: string,
): DatasourceQualifiedColumnRef | null {
  const match = COLUMN_REF_REGEX.exec(columnRef);
  if (!match) return null;
  return {
    datasource: match[1],
    columnInstanceName: `[${match[2]}]`,
  };
}

export function parseColumnInstanceRef(columnInstanceRef: string): ColumnInstanceRefParts | null {
  if (!columnInstanceRef.startsWith('[') || !columnInstanceRef.endsWith(']')) {
    return null;
  }

  const instance = columnInstanceRef.slice(1, -1);
  const first = instance.indexOf(':');
  const last = instance.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;

  const localFieldName = instance.slice(first + 1, last);
  if (!localFieldName) return null;

  return {
    derivation: instance.slice(0, first),
    localFieldName,
    pivot: instance.slice(last + 1),
    columnInstanceName: `[${instance}]`,
  };
}

export function parseCanonicalColumnRef(columnRef: string): ParsedCanonicalColumnRef | null {
  const qualified = parseDatasourceQualifiedColumnRef(columnRef);
  if (!qualified) return null;

  const instance = parseColumnInstanceRef(qualified.columnInstanceName);
  if (!instance || !instance.pivot) return null;

  return {
    datasource: qualified.datasource,
    ...instance,
  };
}

export function formatCanonicalColumnRef(parts: CanonicalColumnRefParts): string {
  return `[${parts.datasource}].[${parts.derivation}:${parts.localFieldName}:${parts.pivot}]`;
}

function normalizeName(s: string): string {
  return s.replace(/^\[|\]$/g, '').trim();
}

/** Strict match — same string, not normalized. */
function fieldMatchesExact(field: FieldReference & { column_ref: string }, name: string): boolean {
  if (field.caption && field.caption === name) return true;
  if (field.columnName === name) return true;
  return false;
}

/** Loose match — strip brackets from both sides before comparing. */
function fieldMatchesByBareName(
  field: FieldReference & { column_ref: string },
  name: string,
): boolean {
  const target = normalizeName(name);
  if (field.caption && field.caption === target) return true;
  if (normalizeName(field.columnName) === target) return true;
  return false;
}

/** Type suffix used in column-instance names: `[<prefix>:<col>:<suffix>]`. */
function typeSuffixFor(type: string | undefined): string {
  if (type === 'quantitative') return 'qk';
  if (type === 'ordinal') return 'ok';
  return 'nk';
}

function aggregationPrefix(agg: AggregationType): string {
  switch (agg) {
    case AggregationType.Sum:
      return 'sum';
    case AggregationType.Avg:
      return 'avg';
    case AggregationType.Min:
      return 'min';
    case AggregationType.Max:
      return 'max';
    case AggregationType.Count:
      return 'count';
    case AggregationType.CountDistinct:
      return 'countdistinct';
    case AggregationType.User:
      return 'usr';
    default:
      return 'none';
  }
}

/** Construct an aggregated column_ref from a base field candidate. */
function buildAggregatedRef(
  base: FieldReference & { column_ref: string },
  agg: AggregationType,
): string {
  const bareName = normalizeName(base.columnName);
  const suffix = typeSuffixFor(base.type);
  const prefix = aggregationPrefix(agg);
  return formatCanonicalColumnRef({
    datasource: base.datasource,
    derivation: prefix,
    localFieldName: bareName,
    pivot: suffix,
  });
}

function toCandidate(field: FieldReference & { column_ref: string }): FieldCandidate {
  return {
    column_ref: field.column_ref,
    datasource: field.datasource,
    caption: field.caption,
    column_name: field.columnName,
    role: field.role,
    is_aggregated: !!field.isAggregated,
  };
}

function displayName(field: FieldReference & { column_ref: string }): string {
  return field.caption ?? normalizeName(field.columnName);
}

function numericSuffixParts(name: string): { base: string; suffix: string | null } {
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match || match[1].length === 0) return { base: name, suffix: null };
  return { base: match[1], suffix: match[2] };
}

function nearDuplicateNote(
  fields: Array<FieldReference & { column_ref: string }>,
  chosen: FieldReference & { column_ref: string },
): string | undefined {
  const chosenName = displayName(chosen);
  const chosenParts = numericSuffixParts(chosenName);
  const family = fields.filter((candidate) => {
    if (candidate.datasource !== chosen.datasource) return false;
    return numericSuffixParts(displayName(candidate)).base === chosenParts.base;
  });
  if (family.length < 2 || !family.some((candidate) => candidate !== chosen)) return undefined;

  const names = [...new Set(family.map(displayName))].sort((a, b) => {
    const aSuffix = numericSuffixParts(a).suffix;
    const bSuffix = numericSuffixParts(b).suffix;
    if (aSuffix === null && bSuffix !== null) return -1;
    if (aSuffix !== null && bSuffix === null) return 1;
    return a.localeCompare(b);
  });
  return `dataset has near-duplicate columns ${names.join('/')} - used ${chosenName}; consider cleaning the source`;
}

function exactResolution(
  query: string,
  fields: Array<FieldReference & { column_ref: string }>,
  field: FieldReference & { column_ref: string },
): FieldResolution {
  const note = nearDuplicateNote(fields, field);
  return {
    kind: 'exact',
    query,
    column_ref: field.column_ref,
    datasource: field.datasource,
    ...(note ? { notes: [note] } : {}),
  };
}

function rewrittenResolution(
  query: string,
  fields: Array<FieldReference & { column_ref: string }>,
  field: FieldReference & { column_ref: string },
  extras: Omit<FieldResolution, 'kind' | 'query' | 'column_ref' | 'datasource' | 'notes'> = {},
): FieldResolution {
  const note = nearDuplicateNote(fields, field);
  return {
    kind: 'rewritten',
    query,
    column_ref: field.column_ref,
    datasource: field.datasource,
    ...extras,
    ...(note ? { notes: [note] } : {}),
  };
}

function disambiguateRanked(
  candidates: Array<FieldReference & { column_ref: string }>,
  query: string,
  fields: Array<FieldReference & { column_ref: string }>,
): FieldResolution | null {
  const captionMatches = candidates.filter((field) => field.caption === query);
  if (captionMatches.length === 1) return exactResolution(query, fields, captionMatches[0]);

  const parts = candidates.map((candidate) => ({
    candidate,
    parts: numericSuffixParts(displayName(candidate)),
  }));
  const bases = new Set(parts.map(({ parts: p }) => p.base));
  const unsuffixed = parts.filter(({ parts: p }) => p.suffix === null);
  const suffixed = parts.filter(({ parts: p }) => p.suffix !== null);
  if (bases.size === 1 && unsuffixed.length === 1 && suffixed.length > 0) {
    return exactResolution(query, fields, unsuffixed[0].candidate);
  }

  return null;
}

function datasourceCaptionMap(workbookXml: string): Map<string, Set<string>> {
  const workbook = parseXML(workbookXml);
  const datasources = normalizeArray<any>(workbook.workbook?.datasources?.datasource);
  const captions = new Map<string, Set<string>>();

  for (const datasource of datasources) {
    const name = datasource?.['@_name'];
    const caption = datasource?.['@_caption'];
    if (!name || !caption || name === 'Parameters') continue;

    const names = captions.get(caption) ?? new Set<string>();
    names.add(name);
    captions.set(caption, names);
  }

  return captions;
}

function matchingFieldsForDatasource(
  workbookXml: string,
  fields: Array<FieldReference & { column_ref: string }>,
  datasource: string,
):
  | { kind: 'exact'; fields: Array<FieldReference & { column_ref: string }> }
  | { kind: 'ambiguous'; fields: Array<FieldReference & { column_ref: string }> }
  | { kind: 'not_found'; fields: [] } {
  const internalMatches = fields.filter((f) => f.datasource === datasource);
  if (internalMatches.length > 0) {
    return { kind: 'exact', fields: internalMatches };
  }

  const captionNames = datasourceCaptionMap(workbookXml).get(datasource);
  if (!captionNames || captionNames.size === 0) {
    return { kind: 'not_found', fields: [] };
  }

  const captionFields = fields.filter((f) => captionNames.has(f.datasource));
  if (captionNames.size === 1) {
    return { kind: 'exact', fields: captionFields };
  }
  return { kind: 'ambiguous', fields: captionFields };
}

function matchingCandidates(
  fields: Array<FieldReference & { column_ref: string }>,
  query: string,
): Array<FieldReference & { column_ref: string }> {
  return fields.filter((f) => fieldMatchesExact(f, query) || fieldMatchesByBareName(f, query));
}

/**
 * Resolve a free-form user-supplied field reference against the workbook's
 * available fields. See module docstring for outcome semantics.
 */
export function resolveField(
  workbookXml: string,
  query: string,
  options: FieldResolveOptions = {},
): FieldResolution {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      kind: 'not_found',
      query,
      reason: 'empty query',
      candidates: [],
    };
  }

  let allFields = listAvailableFields(workbookXml);
  const exactRefMatch = allFields.find((f) => f.column_ref === trimmed);
  if (exactRefMatch) {
    return exactResolution(query, allFields, exactRefMatch);
  }
  // A datasource-qualified ref is already disambiguated; a miss must not fuzzy-match.
  if (COLUMN_REF_REGEX.test(trimmed)) {
    return {
      kind: 'not_found',
      query,
      reason: `no field matches exact column_ref "${trimmed}"`,
      candidates: [],
    };
  }

  if (options.datasource) {
    const scoped = matchingFieldsForDatasource(workbookXml, allFields, options.datasource);
    if (scoped.kind === 'ambiguous') {
      const matches = matchingCandidates(scoped.fields, trimmed);
      return {
        kind: 'ambiguous',
        query,
        candidates: (matches.length > 0 ? matches : scoped.fields).map(toCandidate),
        reason: `datasource selector "${options.datasource}" matches multiple datasources; use an internal datasource name or exact column_ref.`,
      };
    }
    allFields = scoped.fields;
  }

  if (allFields.length === 0) {
    return {
      kind: 'not_found',
      query,
      reason: options.datasource
        ? `no fields available in datasource "${options.datasource}"`
        : 'workbook has no datasources',
      candidates: [],
    };
  }

  const isBracketedQuery = trimmed.startsWith('[') && trimmed.endsWith(']');

  // Phase 1: strict exact match (same string, not normalized).
  // Bracketed queries skip this phase so they're classified as "rewritten"
  // in Phase 2 (the user explicitly typed Tableau syntax we then normalized).
  const exactMatches = isBracketedQuery
    ? []
    : allFields.filter((f) => fieldMatchesExact(f, trimmed));
  if (exactMatches.length === 1) {
    return exactResolution(query, allFields, exactMatches[0]);
  }
  if (exactMatches.length > 1) {
    const ranked = disambiguateRanked(exactMatches, trimmed, allFields);
    if (ranked) return ranked;
    return {
      kind: 'ambiguous',
      query,
      candidates: exactMatches.map(toCandidate),
      reason: `${exactMatches.length} fields match "${trimmed}" (across ${
        new Set(exactMatches.map((f) => f.datasource)).size
      } datasource(s)). Disambiguate with options.datasource or by picking a column_ref.`,
    };
  }

  // Phase 2: bracket-stripped match. The columnName format is `[Profit]`
  // and a bare-name query like `Profit` should match it as `exact`-feeling
  // because the user gave the human-friendly form. We classify it as
  // `exact` to avoid noisy "rewritten" annotations on the common case.
  const bareMatches = allFields.filter((f) => fieldMatchesByBareName(f, trimmed));
  if (bareMatches.length === 1) {
    const f = bareMatches[0];
    return isBracketedQuery
      ? rewrittenResolution(query, allFields, f, {
          reason: 'stripped surrounding brackets',
          rewrites: ['normalized-brackets'],
        })
      : exactResolution(query, allFields, f);
  }
  if (bareMatches.length > 1) {
    const ranked = disambiguateRanked(bareMatches, trimmed, allFields);
    if (ranked) return ranked;
    return {
      kind: 'ambiguous',
      query,
      candidates: bareMatches.map(toCandidate),
      reason: `"${trimmed}" matches ${bareMatches.length} fields. Disambiguate with options.datasource or by picking a column_ref.`,
    };
  }

  // Phase 3: aggregation prefix ("sum of Profit", "count distinct of Region").
  const aggMatch = trimmed.match(AGG_PREFIX_REGEX);
  if (aggMatch) {
    const reqAgg = aggMatch[1].toLowerCase().replace(/\s+/g, '');
    const baseName = aggMatch[2].trim();
    const baseCandidates = allFields.filter((f) => fieldMatchesByBareName(f, baseName));

    if (baseCandidates.length === 1) {
      const base = baseCandidates[0];
      const rewrites = ['parsed-aggregation-prefix'];
      const note = nearDuplicateNote(allFields, base);
      // If the base is already aggregated (calc field with SUM(...) etc.),
      // ignore the requested aggregation — using the base column_ref avoids
      // double-aggregation. This mirrors coordination.ts's existing behavior
      // but surfaces it as a rewrite.
      if (base.isAggregated) {
        rewrites.push('ignored-redundant-aggregation');
        return {
          kind: 'rewritten',
          query,
          column_ref: base.column_ref,
          datasource: base.datasource,
          reason: `field "${baseName}" is already aggregated (formula: ${
            base.formula ?? '?'
          }); ignored requested "${reqAgg}".`,
          rewrites,
          ...(note ? { notes: [note] } : {}),
        };
      }
      const mapped = mapAggregationToken(reqAgg);
      if (mapped === undefined) {
        return {
          kind: 'not_found',
          query,
          candidates: [toCandidate(base)],
          reason: `aggregation "${reqAgg}" is not supported by the resolver. Pick a column_ref from candidates and apply the aggregation explicitly.`,
        };
      }
      return {
        kind: 'rewritten',
        query,
        column_ref: buildAggregatedRef(base, mapped),
        datasource: base.datasource,
        reason: `applied aggregation "${reqAgg}" to base field "${baseName}"`,
        rewrites,
        ...(note ? { notes: [note] } : {}),
      };
    }
    if (baseCandidates.length > 1) {
      const ranked = disambiguateRanked(baseCandidates, baseName, allFields);
      if (ranked?.column_ref) {
        const base = allFields.find((field) => field.column_ref === ranked.column_ref);
        const mapped = mapAggregationToken(reqAgg);
        if (base && mapped !== undefined) {
          return {
            ...ranked,
            kind: 'rewritten',
            column_ref: buildAggregatedRef(base, mapped),
            reason: `applied aggregation "${reqAgg}" to base field "${baseName}"`,
            rewrites: ['parsed-aggregation-prefix'],
          };
        }
      }
      return {
        kind: 'ambiguous',
        query,
        candidates: baseCandidates.map(toCandidate),
        reason: `aggregation prefix "${reqAgg}" parsed but base name "${baseName}" matches ${baseCandidates.length} fields.`,
      };
    }
  }

  // Phase 4: fuzzy did-you-mean via Fuse.js.
  const fuse = new Fuse(allFields, {
    keys: ['caption', 'columnName'],
    threshold: options.fuzzyThreshold ?? 0.4,
    includeScore: true,
  });
  const fuzzy = fuse
    .search(trimmed)
    .slice(0, options.maxFuzzyCandidates ?? 5)
    .map((r) => toCandidate(r.item));

  return {
    kind: 'not_found',
    query,
    candidates: fuzzy,
    reason:
      fuzzy.length > 0
        ? `no exact match for "${trimmed}"; ${fuzzy.length} did-you-mean candidate(s) returned.`
        : `no match for "${trimmed}".`,
  };
}

/**
 * Map a parsed aggregation token to the `AggregationType` enum used by
 * `findAndBuildColumnRef`. Unsupported aggregations (median, stdev, var, ...)
 * return undefined so the caller can fall back to the resolver's "exact"
 * path or surface a clearer error.
 */
function mapAggregationToken(token: string): AggregationType | undefined {
  switch (token) {
    case 'sum':
      return AggregationType.Sum;
    case 'avg':
    case 'average':
    case 'mean':
      return AggregationType.Avg;
    case 'min':
    case 'minimum':
      return AggregationType.Min;
    case 'max':
    case 'maximum':
      return AggregationType.Max;
    case 'count':
      return AggregationType.Count;
    case 'countd':
    case 'countdistinct':
      return AggregationType.CountDistinct;
    default:
      // median / stdev / stdevp / var / varp are not in the supported
      // AggregationType enum yet; leaving undefined causes
      // `findAndBuildColumnRef` to apply a default, which is worse than
      // explicit "not_found". The resolver catches that below.
      return undefined;
  }
}
