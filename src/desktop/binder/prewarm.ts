// src/binder/prewarm.ts
//
// SCHEMA PRE-WARM — compute a datasource's summary + per-family candidate
// shortlists AHEAD of the first ask, so the first real bind is already warm.
//
// `prewarmForDatasource(schema)` is PURE (deterministic; its only side effect is
// populating the shared schema cache, which is the whole point of pre-warming).
// It is intended to be called by the server on a datasource-connect event — the
// wire-up itself is OUT OF SCOPE here; this module only provides the pure
// computation the server can adopt later.
//
// The shortlist is content-addressed: `schemaHash` / `manifestHash` are the exact
// components the bind memo (memo.ts) keys on, so a caller can correlate a warmed
// datasource with subsequent warm binds.

import type { SchemaField, SchemaSummary } from './binder.js';
import { loadManifests } from './manifest.js';
import type { Family, SlotKind, TemplateManifest } from './manifest-types.js';
import { getDefaultSchemaCache, hashManifests, hashSchemaSummary, SchemaCache } from './memo.js';

const TEMPORAL_DATATYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

/**
 * Does a schema field satisfy a bindable slot kind? Mirrors validate.ts's
 * gate-3 `kindCompatible` so a pre-warmed shortlist matches what the gate would
 * actually accept. Non-bindable kinds (calc/generated/pseudo/parameter) are never
 * user-bound and so never yield candidates.
 */
function fieldFitsKind(kind: SlotKind, f: SchemaField): boolean {
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

/** A bindable slot with the schema fields that fit its kind (in schema order). */
export interface SlotShortlist {
  slot_id: string;
  kind: SlotKind;
  required: boolean;
  candidate_fields: string[];
}

/** One eligible template with its bindable slots pre-matched against the schema. */
export interface TemplateShortlist {
  template: string;
  bindable_slots: SlotShortlist[];
}

/** Eligible templates of one chart-intent family. */
export interface FamilyShortlist {
  family: Family;
  templates: TemplateShortlist[];
}

export interface PrewarmResult {
  /** Primary datasource of the summary (the {{DATASOURCE}} a bind will target). */
  datasource: string;
  /** Number of fields in the summary. */
  field_count: number;
  /** Content hash of the summary (== the bind memo's schema-hash component). */
  schemaHash: string;
  /** Content hash of the manifest set (== the bind memo's manifest-hash component). */
  manifestHash: string;
  /** Fast-path-eligible templates, grouped per family, families + templates sorted by name. */
  families: FamilyShortlist[];
}

export interface PrewarmOptions {
  manifests?: Map<string, TemplateManifest>;
  /** Schema cache to warm. Defaults to the process-wide shared cache. */
  schemaCache?: SchemaCache;
}

/**
 * Pre-warm a datasource. Accepts either raw workbook XML (which also warms the
 * schema cache) or an already-derived SchemaSummary. Returns the summary identity
 * plus per-family candidate shortlists for every fast-path-eligible template.
 */
export function prewarmForDatasource(
  schema: string | SchemaSummary,
  opts: PrewarmOptions = {},
): PrewarmResult {
  const manifests = opts.manifests ?? loadManifests();

  let summary: SchemaSummary;
  if (typeof schema === 'string') {
    const cache = opts.schemaCache ?? getDefaultSchemaCache();
    summary = cache.getOrCompute(schema).summary;
  } else {
    summary = schema;
  }

  const byFamily = new Map<Family, TemplateShortlist[]>();
  for (const m of manifests.values()) {
    if (!m.fast_path_eligible) continue;
    const bindable_slots: SlotShortlist[] = m.slots
      .filter((s) => s.bindable)
      .map((s) => ({
        slot_id: s.slot_id,
        kind: s.kind,
        required: s.required,
        candidate_fields: summary.fields.filter((f) => fieldFitsKind(s.kind, f)).map((f) => f.name),
      }));
    const list = byFamily.get(m.family) ?? [];
    list.push({ template: m.template, bindable_slots });
    byFamily.set(m.family, list);
  }

  const families: FamilyShortlist[] = [...byFamily.entries()]
    .map(([family, templates]) => ({
      family,
      templates: templates.sort((a, b) => a.template.localeCompare(b.template)),
    }))
    .sort((a, b) => a.family.localeCompare(b.family));

  return {
    datasource: summary.datasource,
    field_count: summary.fields.length,
    schemaHash: hashSchemaSummary(summary),
    manifestHash: hashManifests(manifests),
    families,
  };
}
