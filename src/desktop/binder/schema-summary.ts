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
  isAggregated: boolean;
  column_ref: string; // straight from listAvailableFields, e.g. "[Superstore].[sum:Sales:qk]"
}

export interface SchemaSummary {
  /** The primary datasource — substituted for {{DATASOURCE}} and the expected home of every bound field. */
  datasource: string;
  fields: SchemaField[];
}

/** Strip surrounding brackets from a Tableau field name: "[Region]" -> "Region". */
export function bareName(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

/**
 * Build a `SchemaSummary` from workbook XML. Pure: same XML => same summary.
 * The `fields` array preserves the order `listAvailableFields` returns; the
 * primary datasource is the one with the most fields (first-seen wins ties).
 */
export function summarizeSchema(workbookXml: string): SchemaSummary {
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
      isAggregated: !!f.isAggregated,
      column_ref: f.column_ref,
    };
  });

  return { datasource: pickPrimaryDatasource(fields), fields };
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
