/**
 * Workbook-level field resolver (heuristics) — NOT part of the metadata model.
 *
 * Reproduces the agent-facing `resolveField(workbookXml, query, options):
 * FieldResolution` contract on top of the metadata model + the per-datasource
 * `resolveField` heuristics. It adds only the workbook-level concerns the
 * per-datasource resolver deliberately leaves out: cross-datasource ambiguity
 * and datasource-caption → internal-name selection.
 *
 * Purpose (trial): prove the domain layer can back a real consumer end-to-end.
 * Checked against the legacy resolver in `workbook-resolver.test.ts` (parity
 * over the real fixtures). Nothing in production calls this yet — wiring it in
 * is the reviewed cutover.
 */
import {
  type Datasource,
  defaultInstance,
  type Field,
  isGlobalFieldName,
  toDatasources,
} from '../metadata/datasource.js';
import {
  type FieldCandidate,
  type FieldResolution,
  type FieldResolveOptions,
  resolveUniqueDatasourceName,
} from '../metadata/field-resolver.js';
import { type Resolution, resolveField as resolveInDatasource } from './resolve.js';

function toCandidate(ds: Datasource, field: Field): FieldCandidate {
  return {
    column_ref: defaultInstance(ds, field).column_ref,
    datasource: ds.name,
    caption: field.caption,
    column_name: field.name,
    role: field.role,
    is_aggregated: field.isAggregated,
  };
}

/** Project a (single-datasource) domain Resolution into the agent-facing shape. */
function project(query: string, ds: Datasource, r: Resolution, maxFuzzy: number): FieldResolution {
  const notes = r.notes && r.notes.length > 0 ? { notes: r.notes } : {};
  switch (r.kind) {
    case 'exact':
      return {
        kind: 'exact',
        query,
        column_ref: r.field!.column_ref,
        datasource: ds.name,
        ...notes,
      };
    case 'rewritten':
      return {
        kind: 'rewritten',
        query,
        column_ref: r.field!.column_ref,
        datasource: ds.name,
        ...(r.rewrites ? { rewrites: r.rewrites } : {}),
        ...notes,
      };
    case 'ambiguous':
      return {
        kind: 'ambiguous',
        query,
        candidates: r.candidates.map((f) => toCandidate(ds, f)),
        reason: `"${query.trim()}" matches ${r.candidates.length} fields in datasource "${ds.name}". Pick a column_ref.`,
      };
    case 'fuzzy':
      return {
        kind: 'not_found',
        query,
        candidates: r.candidates.slice(0, maxFuzzy).map((f) => toCandidate(ds, f)),
      };
    default:
      return { kind: 'not_found', query, candidates: [] };
  }
}

/**
 * Resolve a free-form field name/ref against the whole workbook, via the domain
 * layer. Same outcome semantics as the legacy `resolveField`.
 */
export function resolveFieldViaDomain(
  workbookXml: string,
  query: string,
  options: FieldResolveOptions = {},
): FieldResolution {
  const trimmed = query.trim();
  const maxFuzzy = options.maxFuzzyCandidates ?? 5;
  if (!trimmed) {
    return { kind: 'not_found', query, reason: 'empty query', candidates: [] };
  }

  const datasources = toDatasources(workbookXml);

  // A datasource-qualified ref is already disambiguated: try each datasource for
  // an exact hit; a miss must NOT fall through to fuzzy.
  if (isGlobalFieldName(trimmed)) {
    for (const ds of datasources) {
      const r = resolveInDatasource(ds, trimmed);
      if (r.kind === 'exact') return project(query, ds, r, maxFuzzy);
    }
    return {
      kind: 'not_found',
      query,
      reason: `no field matches exact column_ref "${trimmed}"`,
      candidates: [],
    };
  }

  // Scoped: resolve the caller's datasource selector (internal name or caption)
  // to a single internal datasource, then resolve within it.
  if (options.datasource) {
    const direct = datasources.find((d) => d.name === options.datasource);
    const resolvedName = direct
      ? direct.name
      : resolveUniqueDatasourceName(workbookXml, options.datasource);
    const target = resolvedName ? datasources.find((d) => d.name === resolvedName) : undefined;
    if (!target) {
      // Either the selector matched no datasource, or a caption that is not unique.
      const shared = datasources.filter((d) => d.caption === options.datasource);
      if (shared.length > 1) {
        const candidates = shared.flatMap((ds) => {
          const r = resolveInDatasource(ds, trimmed, { aggregationPrefix: true });
          if (r.match) return [toCandidate(ds, r.match)];
          return r.candidates.map((f) => toCandidate(ds, f));
        });
        return {
          kind: 'ambiguous',
          query,
          candidates,
          reason: `datasource selector "${options.datasource}" matches multiple datasources; use an internal datasource name or exact column_ref.`,
        };
      }
      return {
        kind: 'not_found',
        query,
        reason: `no fields available in datasource "${options.datasource}"`,
        candidates: [],
      };
    }
    return project(
      query,
      target,
      resolveInDatasource(target, trimmed, { aggregationPrefix: true }),
      maxFuzzy,
    );
  }

  // Unscoped: match across every datasource; cross-datasource matches are
  // ambiguous (the resolver's headline safety property).
  const perDs = datasources.map((ds) => ({
    ds,
    r: resolveInDatasource(ds, trimmed, { aggregationPrefix: true }),
  }));

  const strong = perDs.filter((m) => m.r.kind === 'exact' || m.r.kind === 'rewritten');
  if (strong.length === 1) return project(query, strong[0].ds, strong[0].r, maxFuzzy);
  if (strong.length > 1) {
    return {
      kind: 'ambiguous',
      query,
      candidates: strong.map((m) => toCandidate(m.ds, m.r.match!)),
      reason: `"${trimmed}" matches fields in ${strong.length} datasources. Disambiguate with options.datasource or by picking a column_ref.`,
    };
  }

  // No cross-datasource winner: surface any single-datasource ambiguity, else fuzzy.
  const ambiguousMatches = perDs.filter((m) => m.r.kind === 'ambiguous');
  if (ambiguousMatches.length > 0) {
    const candidates = ambiguousMatches.flatMap((m) =>
      m.r.candidates.map((f) => toCandidate(m.ds, f)),
    );
    return {
      kind: 'ambiguous',
      query,
      candidates,
      reason: `"${trimmed}" matches ${candidates.length} fields. Disambiguate with options.datasource or by picking a column_ref.`,
    };
  }

  const fuzzy = perDs
    .filter((m) => m.r.kind === 'fuzzy')
    .flatMap((m) => m.r.candidates.map((f) => toCandidate(m.ds, f)))
    .slice(0, maxFuzzy);
  return { kind: 'not_found', query, candidates: fuzzy };
}
