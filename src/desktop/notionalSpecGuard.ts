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
 * The NotionalSpec dialect is retired; this guard exists to block/contain the retired
 * command. Its FIX message steers to the current dialect's knowledge home
 * (expertise://tableau/tactics/data/dynamic-dashboard-authoring). Keep this guard in sync
 * with that doc if the v0.2 schema changes.
 */
import type { CommandValidationResult } from './commandRegistry.js';

export const GENERATE_VIZ_FROM_NOTIONAL_SPEC_COMMAND = 'tabdoc:generate-viz-from-notional-spec';

const KNOWLEDGE_URI = 'expertise://tableau/tactics/data/dynamic-dashboard-authoring';

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

const ALLOWED_FIELD_KEYS = new Set([
  'caption',
  'data',
  'type',
  'role',
  'aggregation',
  'encoding',
  'fieldIdentifier',
]);

const V0_2_FIELD_DATA_ENUM = new Set(['number', 'string', 'date', 'boolean', 'geographic', 'set']);
const V0_2_FIELD_TYPE_ENUM = new Set(['discrete', 'continuous']);
const V0_2_FIELD_ROLE_ENUM = new Set(['dimension', 'measure']);
const V0_2_FIELD_AGGREGATION_ENUM = new Set([
  'default',
  'count',
  'countd',
  'sum',
  'avg',
  'max',
  'min',
  'median',
  'year',
  'qtr',
  'month',
  'week',
  'day',
  'hour',
  'minute',
  'second',
]);
const V0_2_FIELD_ENCODING_ENUM = new Set(['color', 'size', 'text', 'shape', 'x', 'y']);

const ALLOWED_SORT_KEYS = new Set(['field', 'by', 'aggregation', 'direction']);
const V0_2_SORT_DIRECTION_ENUM = new Set(['asc', 'desc']);

const ALLOWED_RANGE_FILTER_KEYS = new Set(['field', 'aggregation', 'start', 'end', 'includeNull']);

const ALLOWED_RELATIVE_DATE_FILTER_KEYS = new Set([
  'type',
  'field',
  'amount',
  'period',
  'direction',
  'anchor',
  'includeNull',
]);
const V0_2_RELATIVE_DATE_PERIOD_ENUM = new Set(['days', 'weeks', 'months', 'quarters', 'years']);
const V0_2_RELATIVE_DATE_DIRECTION_ENUM = new Set(['next', 'previous']);

const ALLOWED_CATEGORICAL_FILTER_KEYS = new Set([
  'type',
  'field',
  'values',
  'exclude',
  'limit',
  'condition',
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRangeFilters(spec: Record<string, unknown>): CommandValidationResult | undefined {
  if (!Array.isArray(spec.rangeFilters)) {
    return undefined;
  }

  for (const [index, rangeFilter] of spec.rangeFilters.entries()) {
    if (!isJsonObject(rangeFilter)) {
      return fail(
        `rangeFilters entry at index ${index} is not an object (got ${JSON.stringify(rangeFilter)}).`,
        'Use range filter objects with "field" and optional "aggregation", "start", "end", "includeNull".',
      );
    }

    for (const key of Object.keys(rangeFilter)) {
      if (!ALLOWED_RANGE_FILTER_KEYS.has(key)) {
        if (key === 'min' || key === 'max') {
          return fail(
            `Unknown rangeFilters key "${key}" at index ${index}.`,
            'v0.2 numeric range filters use "start"/"end", not "min"/"max".',
          );
        }

        return fail(
          `Unknown rangeFilters key "${key}" at index ${index}.`,
          `Remove "${key}" — v0.2 range filters allow only field, aggregation, start, end, includeNull.`,
        );
      }
    }

    if (!hasNonEmptyString(rangeFilter.field)) {
      return fail(
        `"rangeFilters[${index}].field" is required and must be a non-empty string (got ${JSON.stringify(rangeFilter.field)}).`,
        'Add the datasource field name as "field" on the range filter.',
      );
    }
  }

  return undefined;
}

function validateSort(spec: Record<string, unknown>): CommandValidationResult | undefined {
  if (spec.sort === undefined) {
    return undefined;
  }

  if (!isJsonObject(spec.sort)) {
    return fail(
      `"sort" must be an object (got ${JSON.stringify(spec.sort)}).`,
      'Use "sort": { "field": "...", "by": "...", "direction": "asc|desc" } or omit "sort".',
    );
  }

  for (const key of Object.keys(spec.sort)) {
    if (!ALLOWED_SORT_KEYS.has(key)) {
      return fail(
        `Unknown sort key "${key}".`,
        `Remove "${key}" — v0.2 sort allows only field, by, aggregation, direction.`,
      );
    }
  }

  if (!hasNonEmptyString(spec.sort.by)) {
    return fail(
      `"sort.by" is required and must be a non-empty string (got ${JSON.stringify(spec.sort.by)}).`,
      'Set "sort.by" to the field or measure caption used to order the marks.',
    );
  }

  if (
    spec.sort.direction !== undefined &&
    (typeof spec.sort.direction !== 'string' || !V0_2_SORT_DIRECTION_ENUM.has(spec.sort.direction))
  ) {
    return fail(
      `"sort.direction" value ${JSON.stringify(spec.sort.direction)} is not in the v0.2 enum (asc, desc).`,
      'Use "direction": "asc" or "direction": "desc", or omit "direction".',
    );
  }

  return undefined;
}

function validateRelativeDateFilters(
  spec: Record<string, unknown>,
): CommandValidationResult | undefined {
  if (!Array.isArray(spec.relativeDateFilters)) {
    return undefined;
  }

  for (const [index, relativeDateFilter] of spec.relativeDateFilters.entries()) {
    if (!isJsonObject(relativeDateFilter)) {
      return fail(
        `relativeDateFilters entry at index ${index} is not an object (got ${JSON.stringify(relativeDateFilter)}).`,
        'Use relative date filter objects with type, field, amount, period, direction, anchor, includeNull.',
      );
    }

    for (const key of Object.keys(relativeDateFilter)) {
      if (!ALLOWED_RELATIVE_DATE_FILTER_KEYS.has(key)) {
        return fail(
          `Unknown relativeDateFilters key "${key}" at index ${index}.`,
          `Remove "${key}" — v0.2 relative date filters allow only type, field, amount, period, direction, anchor, includeNull.`,
        );
      }
    }

    if (relativeDateFilter.type !== 'relative-date') {
      return fail(
        `"relativeDateFilters[${index}].type" value ${JSON.stringify(relativeDateFilter.type)} is not "relative-date".`,
        'Set "type": "relative-date".',
      );
    }

    if (!hasNonEmptyString(relativeDateFilter.field)) {
      return fail(
        `"relativeDateFilters[${index}].field" is required and must be a non-empty string (got ${JSON.stringify(relativeDateFilter.field)}).`,
        'Add the datasource field name as "field" on the relative date filter.',
      );
    }

    if (typeof relativeDateFilter.amount !== 'number') {
      return fail(
        `"relativeDateFilters[${index}].amount" value ${JSON.stringify(relativeDateFilter.amount)} is not a number.`,
        'Set "amount" to a number, e.g. 3 for the previous 3 months.',
      );
    }

    if (
      typeof relativeDateFilter.period !== 'string' ||
      !V0_2_RELATIVE_DATE_PERIOD_ENUM.has(relativeDateFilter.period)
    ) {
      const singularPeriods = new Set(['day', 'week', 'month', 'quarter', 'year']);
      if (
        typeof relativeDateFilter.period === 'string' &&
        singularPeriods.has(relativeDateFilter.period)
      ) {
        return fail(
          `"relativeDateFilters[${index}].period" value ${JSON.stringify(relativeDateFilter.period)} is singular, not v0.2 vocabulary.`,
          'Use plural relative date periods: days, weeks, months, quarters, years.',
        );
      }

      return fail(
        `"relativeDateFilters[${index}].period" value ${JSON.stringify(relativeDateFilter.period)} is not in the v0.2 enum (days, weeks, months, quarters, years).`,
        'Use one of: days, weeks, months, quarters, years.',
      );
    }

    if (
      relativeDateFilter.direction !== undefined &&
      (typeof relativeDateFilter.direction !== 'string' ||
        !V0_2_RELATIVE_DATE_DIRECTION_ENUM.has(relativeDateFilter.direction))
    ) {
      if (relativeDateFilter.direction === 'last') {
        return fail(
          `"relativeDateFilters[${index}].direction" value "last" is not v0.2 vocabulary.`,
          '"last N months" is direction "previous" — there is no "last" literal.',
        );
      }

      return fail(
        `"relativeDateFilters[${index}].direction" value ${JSON.stringify(relativeDateFilter.direction)} is not in the v0.2 enum (next, previous).`,
        'Use "direction": "next" or "direction": "previous".',
      );
    }
  }

  return undefined;
}

function validateCategoricalFilters(
  spec: Record<string, unknown>,
): CommandValidationResult | undefined {
  if (!Array.isArray(spec.categoricalFilters)) {
    return undefined;
  }

  for (const [index, categoricalFilter] of spec.categoricalFilters.entries()) {
    if (!isJsonObject(categoricalFilter)) {
      return fail(
        `categoricalFilters entry at index ${index} is not an object (got ${JSON.stringify(categoricalFilter)}).`,
        'Use categorical filter objects with type, field, values, exclude, limit, condition.',
      );
    }

    for (const key of Object.keys(categoricalFilter)) {
      if (!ALLOWED_CATEGORICAL_FILTER_KEYS.has(key)) {
        return fail(
          `Unknown categoricalFilters key "${key}" at index ${index}.`,
          `Remove "${key}" — v0.2 categorical filters allow only type, field, values, exclude, limit, condition.`,
        );
      }
    }

    if (categoricalFilter.type !== 'categorical') {
      return fail(
        `"categoricalFilters[${index}].type" value ${JSON.stringify(categoricalFilter.type)} is not "categorical".`,
        'Set "type": "categorical".',
      );
    }

    if (!hasNonEmptyString(categoricalFilter.field)) {
      return fail(
        `"categoricalFilters[${index}].field" is required and must be a non-empty string (got ${JSON.stringify(categoricalFilter.field)}).`,
        'Add the datasource field name as "field" on the categorical filter.',
      );
    }
  }

  return undefined;
}

function validateFieldVocabulary(
  field: Record<string, unknown>,
  index: number,
): CommandValidationResult | undefined {
  for (const key of Object.keys(field)) {
    if (!ALLOWED_FIELD_KEYS.has(key)) {
      if (key === 'shelf') {
        return fail(
          `Unknown field key "shelf" at index ${index}.`,
          'NotionalSpec v0.2 has no "shelf" — use "encoding": x|y|color|size|text|shape (x/y are the axes).',
        );
      }

      return fail(
        `Unknown field key "${key}" at index ${index}.`,
        `Remove "${key}" — v0.2 fields allow only caption, data, type, role, aggregation, encoding, fieldIdentifier.`,
      );
    }
  }

  if (
    field.data !== undefined &&
    (typeof field.data !== 'string' || !V0_2_FIELD_DATA_ENUM.has(field.data))
  ) {
    return fail(
      `"data" value ${JSON.stringify(field.data)} on field at index ${index} is not in the v0.2 enum (number, string, date, boolean, geographic, set).`,
      'Use one of: number, string, date, boolean, geographic, set.',
    );
  }

  if (
    field.type !== undefined &&
    (typeof field.type !== 'string' || !V0_2_FIELD_TYPE_ENUM.has(field.type))
  ) {
    return fail(
      `"type" value ${JSON.stringify(field.type)} on field at index ${index} is not in the v0.2 enum (discrete, continuous).`,
      'Use "type": "discrete" or "type": "continuous".',
    );
  }

  if (
    field.role !== undefined &&
    (typeof field.role !== 'string' || !V0_2_FIELD_ROLE_ENUM.has(field.role))
  ) {
    return fail(
      `"role" value ${JSON.stringify(field.role)} on field at index ${index} is not in the v0.2 enum (dimension, measure).`,
      'Use "role": "dimension" or "role": "measure".',
    );
  }

  if (
    field.aggregation !== undefined &&
    (typeof field.aggregation !== 'string' || !V0_2_FIELD_AGGREGATION_ENUM.has(field.aggregation))
  ) {
    if (field.aggregation === 'none') {
      return fail(
        `"aggregation" value "none" on field at index ${index} is not v0.2 vocabulary.`,
        '"none" is not v0.2 vocabulary — omit "aggregation" or use "default" (REQUIRED for calculated fields that are already aggregate, e.g. SUM()/SUM() ratios).',
      );
    }

    return fail(
      `"aggregation" value ${JSON.stringify(field.aggregation)} on field at index ${index} is not in the v0.2 enum (default, count, countd, sum, avg, max, min, median, year, qtr, month, week, day, hour, minute, second).`,
      'Use one of: default, count, countd, sum, avg, max, min, median, year, qtr, month, week, day, hour, minute, second.',
    );
  }

  if (
    field.encoding !== undefined &&
    (typeof field.encoding !== 'string' || !V0_2_FIELD_ENCODING_ENUM.has(field.encoding))
  ) {
    if (field.encoding === 'detail' || field.encoding === 'tooltip') {
      return fail(
        `"encoding" value ${JSON.stringify(field.encoding)} on field at index ${index} is not v0.2 vocabulary.`,
        'detail/tooltip are v0.3-flag-only — use one of color, size, text, shape, x, y in v0.2.',
      );
    }

    return fail(
      `"encoding" value ${JSON.stringify(field.encoding)} on field at index ${index} is not in the v0.2 enum (color, size, text, shape, x, y).`,
      'Use one of: color, size, text, shape, x, y.',
    );
  }

  return undefined;
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
        'current worksheet. Target the sheet with activate-sheet first, then call this ' +
        'command with only NotionalSpecJson (and optional ClearSheet).',
      'Remove the WorksheetId parameter and call activate-sheet beforehand instead.',
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

  const rangeFiltersValidation = validateRangeFilters(spec);
  if (rangeFiltersValidation !== undefined) {
    return rangeFiltersValidation;
  }

  for (const [index, field] of spec.fields.entries()) {
    const fieldValidation = validateFieldVocabulary(field as Record<string, unknown>, index);
    if (fieldValidation !== undefined) {
      return fieldValidation;
    }
  }

  const sortValidation = validateSort(spec);
  if (sortValidation !== undefined) {
    return sortValidation;
  }

  const relativeDateFiltersValidation = validateRelativeDateFilters(spec);
  if (relativeDateFiltersValidation !== undefined) {
    return relativeDateFiltersValidation;
  }

  const categoricalFiltersValidation = validateCategoricalFilters(spec);
  if (categoricalFiltersValidation !== undefined) {
    return categoricalFiltersValidation;
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
