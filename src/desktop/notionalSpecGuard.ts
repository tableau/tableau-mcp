/**
 * Pre-dispatch guard: tabdoc:generate-viz-from-notional-spec
 *
 * Confirmed incident (2026-07-19, live Sonnet 5 session driving Tableau Desktop): the
 * agent invoked this command with a fabricated schema ({"mark","columns","rows","title"}
 * plus a "worksheetName" parameter) instead of the real contract. The product does not
 * validate the args client-side — it returned a raw 500 and the agent lost the fast
 * path. This guard rejects a malformed invocation BEFORE it reaches the product, with a
 * FIX message that carries the correct minimal example and points at the knowledge
 * module that documents the contract.
 *
 * Contract source of truth: resources/desktop/knowledge/tactics/data/notional-spec-authoring.md
 * (expertise://tableau/tactics/data/notional-spec-authoring). Keep this guard in sync
 * with that doc if the v0.2 schema changes.
 */
import type { CommandValidationResult } from './commandRegistry.js';

export const GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND = 'tabdoc:generate-viz-from-notional-spec';

const KNOWLEDGE_URI = 'expertise://tableau/tactics/data/notional-spec-authoring';

const ALLOWED_ARG_KEYS = new Set(['NotionalSpecJson', 'ClearSheet']);

const ALLOWED_TOP_LEVEL_SPEC_KEYS = new Set([
  'version',
  'fields',
  'chart',
  'relativeDateFilters',
  'dateRangeFilters',
  'rangeFilters',
  'categoricalFilters',
  'sort',
]);

const V0_2_CHART_ENUM = new Set([
  'text',
  'heatmap',
  'bar',
  'stackedbar',
  'line',
  'area',
  'gantt',
  'scatterplot',
  'histogram',
  'symbolmap',
  'filledmap',
  'treemap',
  'pie',
  'dualline',
  'boxplot',
  'bullet',
  'bubble',
]);

const EXAMPLE_1 = `{
  "version": "0.2.0",
  "chart": "bar",
  "fields": [
    { "caption": "Region", "data": "string", "type": "discrete",
      "role": "dimension", "encoding": "x" },
    { "caption": "Sales", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "y" }
  ],
  "sort": { "field": "Region", "by": "Sales",
            "aggregation": "sum", "direction": "desc" }
}`;

function fixFooter(fix: string): string {
  return (
    `FIX: ${fix} Minimal valid example (NotionalSpecJson value):\n${EXAMPLE_1}\n` +
    `See ${KNOWLEDGE_URI} for the full v0.2 contract.`
  );
}

function fail(problem: string, fix: string): CommandValidationResult {
  return { ok: false, message: `${problem} ${fixFooter(fix)}` };
}

/**
 * Validates args for tabdoc:generate-viz-from-notional-spec BEFORE dispatch. Returns
 * { ok: true } for every other command — this guard is scoped to the one command.
 */
export function validateNotionalSpecArgs(
  command: string,
  args: Record<string, unknown> | undefined,
): CommandValidationResult {
  if (command !== GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND) {
    return { ok: true };
  }

  const safeArgs = args ?? {};

  if ('WorksheetId' in safeArgs) {
    return fail(
      `Unknown parameter "WorksheetId" for ${GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND}. ` +
        'Passing WorksheetId is documented as producing a 500 — the command renders on the ' +
        'current worksheet. Target the sheet with tabdoc:goto-sheet first, then call this ' +
        'command with only NotionalSpecJson (and optional ClearSheet).',
      'Remove the WorksheetId parameter and call tabdoc:goto-sheet beforehand instead.',
    );
  }

  for (const key of Object.keys(safeArgs)) {
    if (!ALLOWED_ARG_KEYS.has(key)) {
      return fail(
        `Unknown parameter "${key}" for ${GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND}. ` +
          'Only "NotionalSpecJson" (required JSON string) and "ClearSheet" (optional boolean) ' +
          'are accepted.',
        `Remove "${key}" and pass the spec as a JSON string in "NotionalSpecJson".`,
      );
    }
  }

  const notionalSpecJson = safeArgs.NotionalSpecJson;
  if (typeof notionalSpecJson !== 'string') {
    return fail(
      `${GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND} requires "NotionalSpecJson" as a JSON string ` +
        `(got ${notionalSpecJson === undefined ? 'undefined' : typeof notionalSpecJson}).`,
      'Serialize the spec object to a JSON string and pass it as "NotionalSpecJson".',
    );
  }

  let parsedSpec: unknown;
  try {
    parsedSpec = JSON.parse(notionalSpecJson);
  } catch (error) {
    return fail(
      `"NotionalSpecJson" is not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
      'Fix the JSON syntax in "NotionalSpecJson".',
    );
  }

  if (typeof parsedSpec !== 'object' || parsedSpec === null || Array.isArray(parsedSpec)) {
    return fail(
      '"NotionalSpecJson" must parse to a JSON object, not an array or primitive.',
      'Wrap the spec in a top-level object with "version" and "fields".',
    );
  }

  const spec = parsedSpec as Record<string, unknown>;

  for (const key of Object.keys(spec)) {
    if (!ALLOWED_TOP_LEVEL_SPEC_KEYS.has(key)) {
      return fail(
        `Unknown top-level key "${key}" in the NotionalSpec. Valid top-level keys are: ` +
          'version, fields, chart, relativeDateFilters, dateRangeFilters, rangeFilters, ' +
          'categoricalFilters, sort.',
        `Remove "${key}" — NotionalSpec is not a chart-primitive schema (no "mark"/"columns"/` +
          '"rows"/"title" keys); it is version + fields (+ optional chart/filters/sort).',
      );
    }
  }

  if (typeof spec.version !== 'string' || spec.version.trim().length === 0) {
    return fail(
      'The NotionalSpec is missing a valid "version" string (e.g. "0.2.0").',
      'Add "version": "0.2.0" at the top level.',
    );
  }

  if (!Array.isArray(spec.fields) || spec.fields.length === 0) {
    return fail(
      'The NotionalSpec is missing a non-empty "fields" array.',
      'Add at least one field object under "fields", each with a "caption" string.',
    );
  }

  for (const [index, field] of spec.fields.entries()) {
    if (
      typeof field !== 'object' ||
      field === null ||
      typeof (field as Record<string, unknown>).caption !== 'string' ||
      ((field as Record<string, unknown>).caption as string).trim().length === 0
    ) {
      return fail(
        `NotionalSpec field at index ${index} is missing a non-empty "caption" string.`,
        'Every entry in "fields" requires a "caption" (the field name in the datasource).',
      );
    }
  }

  if (spec.chart !== undefined) {
    if (typeof spec.chart !== 'string' || !V0_2_CHART_ENUM.has(spec.chart)) {
      return fail(
        `"chart" value ${JSON.stringify(spec.chart)} is not in the v0.2 chart enum ` +
          `(${[...V0_2_CHART_ENUM].join(', ')}).`,
        'Use a chart value from the v0.2 enum, or omit "chart" and fall back to XML authoring ' +
          'for chart families outside it.',
      );
    }
  }

  return { ok: true };
}
