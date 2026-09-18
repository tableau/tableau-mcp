// src/binder/schema-summary.ts
//
// Tier-1 fast-path binder — schema summary (design doc §3.1, §3.2).
//
// `summarizeSchema(workbookXml)` is the "cached schema summary" the binder
// needs: a thin wrapper over `listAvailableFields` (src/metadata/field-builder.ts)
// that also picks a single PRIMARY datasource. `listAvailableFields` already
// returns the kinded, pure `FieldReference & {column_ref}` the resolver and the
// planner use, so the binder reuses that exact source of truth rather than
// re-parsing XML.
//
// The primary datasource is the one contributing the most fields (ties broken by
// first appearance). It becomes the `{{DATASOURCE}}` the injector substitutes and
// the datasource every bound field is expected to resolve within.

import { listAvailableFields } from '../metadata/field-builder.js';

/**
 * One field from the workbook's datasources, projected to just what the binder
 * and the small-LLM contract need. `name` is the human-friendly identifier
 * (caption when present, else the bare column name); `columnName` keeps the
 * bracketed local name used to build the column-instance VALUE.
 */
export interface SchemaField {
  name: string; // friendly name: caption ?? bare column name
  caption?: string;
  columnName: string; // bracketed local name, e.g. "[Region]"
  role: 'dimension' | 'measure';
  type: string; // "quantitative" | "nominal" | "ordinal" | ...
  datatype: string; // "string" | "real" | "integer" | "date" | "datetime" | ...
  semanticRole?: string; // Tableau geo semantic role, e.g. "[State].[Name]"
  datasource: string;
  table?: string; // metadata-record parent-name for federated grain disambiguation
  isAggregated: boolean;
  isGroup?: boolean;
  column_ref: string; // straight from listAvailableFields, e.g. "[Superstore].[sum:Sales:qk]"
}

export interface SchemaSummary {
  /** The chosen datasource — substituted for {{DATASOURCE}} and the expected home of every bound field. Scoped when `summarizeSchema` was given a `scopeDatasource`, else the primary. */
  datasource: string;
  fields: SchemaField[];
  /**
   * Per-field distinct-value counts, keyed by `column_ref`. A statistic, not a
   * definition fact — kept off `SchemaField` so a field carries only what it IS,
   * not what a given extract measured. Absent key = unknown count.
   */
  approxCountByRef?: Record<string, number>;
}

/** Strip surrounding brackets from a Tableau field name: "[Region]" -> "Region". */
export function bareName(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

/**
 * Build a `SchemaSummary` from workbook XML. Pure: same XML => same summary.
 * The `fields` array preserves the order `listAvailableFields` returns.
 *
 * When `scopeDatasource` names a datasource present in the workbook, the summary
 * is restricted to that datasource's fields and its `datasource` is that name —
 * so resolution can never wander to a bare-name match in another connected
 * datasource. When it is omitted (or names nothing present), behaviour is
 * unchanged: all fields, primary datasource (most fields, first-seen wins ties).
 */
export function summarizeSchema(workbookXml: string, scopeDatasource?: string): SchemaSummary {
  const raw = listAvailableFields(workbookXml);

  const fields: SchemaField[] = raw.map((f) => {
    const bare = bareName(f.columnName);
    const caption = f.caption && f.caption.length > 0 ? f.caption : undefined;
    const role = f.role === 'measure' ? 'measure' : 'dimension';
    return {
      name: caption ?? bare,
      caption,
      columnName: f.columnName,
      role,
      type: f.type,
      datatype: f.datatype ?? '',
      semanticRole: f.semanticRole,
      datasource: f.datasource,
      ...(f.table ? { table: f.table } : {}),
      isAggregated: !!f.isAggregated,
      ...(f.isGroup ? { isGroup: true } : {}),
      column_ref: f.column_ref,
    };
  });

  const approxCountByRef: Record<string, number> = {};
  for (const f of raw) {
    if (f.approxCount !== undefined) approxCountByRef[f.column_ref] = f.approxCount;
  }

  if (scopeDatasource !== undefined) {
    const canonical = canonicalDatasource(fields, scopeDatasource);
    if (canonical !== undefined) {
      return {
        datasource: canonical,
        fields: fields.filter((f) => f.datasource === canonical),
        approxCountByRef,
      };
    }
  }

  return { datasource: pickPrimaryDatasource(fields), fields, approxCountByRef };
}

/**
 * The present datasource name matching `requested` — exact first, then
 * case-insensitive. `undefined` when no connected datasource matches.
 */
function canonicalDatasource(fields: SchemaField[], requested: string): string | undefined {
  const present = fields.map((f) => f.datasource);
  return (
    present.find((ds) => ds === requested) ??
    present.find((ds) => ds.toLowerCase() === requested.toLowerCase())
  );
}

/** The datasource contributing the most fields; first-seen wins ties. "" if none. */
function pickPrimaryDatasource(fields: SchemaField[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const f of fields) {
    if (!counts.has(f.datasource)) order.push(f.datasource);
    counts.set(f.datasource, (counts.get(f.datasource) ?? 0) + 1);
  }
  let best = '';
  let bestCount = -1;
  for (const ds of order) {
    const c = counts.get(ds) ?? 0;
    if (c > bestCount) {
      best = ds;
      bestCount = c;
    }
  }
  return best;
}
