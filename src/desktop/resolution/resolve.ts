/**
 * Field resolution heuristics — NOT part of the metadata model.
 *
 * `resolveField` maps a free-form, user/agent-supplied field name (or ref) to a
 * concrete field in ONE datasource, then instantiates it. It is all heuristics:
 * a matching ladder (exact → bare → aggregation-prefix → fuzzy), plus the
 * disambiguation policy from `./disambiguate.js`. The structural facts it reads
 * (Datasource, Field, how a FieldInstance is built) come from the metadata model
 * (`../metadata/datasource.js`); the guessing lives here.
 *
 * Scoping is "which datasource you ask" — the caller picks `ds`. Cross-datasource
 * concerns live one level up in `./workbook-resolver.js`.
 */
import Fuse from 'fuse.js';

import {
  type Datasource,
  defaultInstance,
  type Field,
  type FieldInstance,
  type GlobalFieldName,
  instantiate,
  isGlobalFieldName,
  stripBrackets,
} from '../metadata/datasource.js';
import { parseCanonicalColumnRef } from '../metadata/field-resolver.js';
import { AggregationType } from '../metadata/types.js';
import { disambiguateRanked, nearDuplicateNote } from './disambiguate.js';

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

function matchesExact(field: Field, query: string): boolean {
  return field.caption === query || field.name === query;
}

function matchesBare(field: Field, query: string): boolean {
  const target = stripBrackets(query).trim();
  return field.caption === target || stripBrackets(field.name) === target;
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
