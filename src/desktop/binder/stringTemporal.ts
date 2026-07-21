/**
 * String-temporal detection for the temporal_axis_from_string slot option.
 *
 * The binder sees only SCHEMA (name, datatype, type, role) — never cell VALUES. So
 * "is this string field a date, and in what format?" is an inference from the field
 * NAME, not a measurement. DATEPARSE returns NULL silently on a wrong format, so this
 * is deliberately CONSERVATIVE and FAIL-CLOSED: it only accepts a string field whose
 * name strongly implies a temporal role, and only emits a format it is willing to
 * stand behind. A field it isn't sure about returns null → the slot stays a
 * kind-mismatch (unchanged behavior), never a silently-blank axis.
 *
 * The inferred format is still a guess about the VALUES; the render must be verified
 * live before a template opts in (see dateparseTemporalAxis.ts caveat).
 */
import type { SchemaField } from './schema-summary.js';

/** Field-name tokens that strongly imply the string holds a date/period. */
const TEMPORAL_NAME_RE =
  /\b(month|date|period|day|week|quarter|year|yyyy|yearmonth|ym|calendar|timestamp)\b|^(month|date|period|day|week|quarter|year|dt|ts)$/i;

export interface StringTemporalInference {
  /** DATEPARSE format the binder will emit (a best-effort inference from the name). */
  format: string;
}

/**
 * Decide whether a STRING field should be accepted as the source for a temporal slot,
 * and with what DATEPARSE format. Returns null to REJECT (leave it a kind-mismatch).
 *
 * Only strings pass here; a real date/datetime field never reaches this path (it
 * already satisfies the temporal gate). Non-date-like names return null (fail-closed).
 */
export function inferStringTemporal(field: SchemaField): StringTemporalInference | null {
  if (field.datatype !== 'string') return null;
  if (field.role !== 'dimension') return null;
  const name = field.name;
  if (!TEMPORAL_NAME_RE.test(name)) return null;

  // Format inference from the name. "month"/"year-month"/"ym" → month granularity
  // ("yyyy-MM"); anything else date-like defaults to a full ISO date ("yyyy-MM-dd").
  // Both are the ISO forms the eval datasources use; a mismatch renders blank and is
  // caught by the required live-render verification, never shipped on trust.
  const lower = name.toLowerCase();
  const monthly = /\b(month|yearmonth|ym|calendar)\b|^month$|^ym$/.test(lower);
  const format = monthly ? 'yyyy-MM' : 'yyyy-MM-dd';
  return { format };
}
