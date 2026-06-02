import z from 'zod';

export const FilterOperatorSchema = z.enum(['eq', 'in', 'gt', 'gte', 'lt', 'lte']);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export function isISO8601DateTime(value: string): boolean {
  // Basic ISO 8601 regex (covers most common cases)
  // Example: 2016-05-04T21:24:49Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
}

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a value supplied for a date-time filter field (`createdAt`,
 * `updatedAt`) into the canonical ISO 8601 form Tableau's REST API expects
 * (`YYYY-MM-DDTHH:MM:SSZ`).
 *
 * Two input shapes are accepted:
 *  1. Full ISO 8601 with `Z` suffix (e.g. `2025-11-20T00:00:00Z`) — returned
 *     as-is.
 *  2. Date-only `YYYY-MM-DD` (e.g. `2025-11-20`) — auto-promoted to midnight
 *     UTC (`2025-11-20T00:00:00Z`). LLMs naturally emit date-only when the
 *     user said "before Nov 20" with no time-of-day; auto-promoting saves a
 *     needless self-correction round-trip while staying unambiguous (UTC,
 *     start-of-day is the only reasonable promotion).
 *
 * Everything else is rejected: locale-style `MM/DD/YYYY` (ambiguous across
 * locales), non-zero-padded `2025-1-1`, no-timezone `2025-11-20T00:00:00`,
 * and offset-style `2025-11-20T00:00:00+00:00` (Tableau itself accepts this
 * but the tool's contract pins `Z` to keep the validator small and the docs
 * unambiguous). The thrown error spells out both accepted formats so an LLM
 * can self-correct in a single retry.
 */
function normalizeDateTimeValue(field: string, value: string): string {
  if (isISO8601DateTime(value)) {
    return value;
  }
  if (ISO_DATE_ONLY_REGEX.test(value)) {
    return `${value}T00:00:00Z`;
  }
  throw new Error(
    `Value for field '${field}' must be either a full ISO 8601 date-time with Z suffix (e.g. 2025-11-20T00:00:00Z) or a date-only YYYY-MM-DD (e.g. 2025-11-20). Got: '${value}'.`,
  );
}

const dateTimeFields = ['createdAt', 'updatedAt'];

/**
 * Reject filter strings whose `[...]` brackets are unbalanced before any
 * splitting happens. Two cases are caught:
 *
 *  1. A `]` with no matching `[` ahead of it (depth would go negative).
 *  2. A `[` that is never closed (depth is still positive at end of string).
 *
 * Pre-validating here keeps {@link splitTopLevel} a straightforward depth
 * tracker and gives the LLM a specific, local error to recover from rather
 * than letting Tableau reject the malformed value one network round-trip
 * later with a generic "bad filter syntax" message.
 */
function validateBracketBalance(filterString: string): void {
  let depth = 0;
  for (const ch of filterString) {
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth < 0) {
        throw new Error(
          `Unbalanced bracket in filter: unexpected ']' with no matching '['. Got: '${filterString}'.`,
        );
      }
    }
  }
  if (depth > 0) {
    throw new Error(
      `Unbalanced bracket in filter: '[' opened with no matching ']'. Got: '${filterString}'.`,
    );
  }
}

/**
 * Splits a filter string on commas, ignoring commas that are inside `[...]`
 * brackets. This is required so multi-element `:in:` lists like
 * `name:in:[Foo,Bar,Baz]` are NOT shredded into broken sub-expressions
 * (`name:in:[Foo`, `Bar`, `Baz]`). Naive `split(',')` was the original
 * implementation; live verification against Tableau REST 3.30 confirmed it
 * rejected every multi-element `:in:` filter, even though the documentation
 * for every list-* tool advertises `[A,B]` as the canonical syntax.
 *
 * Callers must pre-validate the bracket structure with
 * {@link validateBracketBalance}; this walker assumes balance and simply
 * tracks depth so commas only delimit top-level expressions when
 * `depth === 0`. Leading/trailing whitespace and empty segments are stripped
 * by the caller's `.map(trim).filter(Boolean)` chain.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parses and validates a Tableau-style filter string
 * @param filterString e.g. 'name:eq:Project Views,type:eq:Workbook'
 * @param allowedOperatorsByField - A map of filter fields to allowed operators
 * @param filterFieldSchema - A schema for the filter field
 * @returns validated filter string
 * @throws ZodError or custom error for invalid operators
 */
export function parseAndValidateFilterString<
  TFilterField extends string,
  TFilterExpression extends { field: TFilterField; operator: FilterOperator; value: string } = {
    field: TFilterField;
    operator: FilterOperator;
    value: string;
  },
>({
  filterString,
  allowedOperatorsByField,
  filterFieldSchema,
}: {
  filterString: string;
  allowedOperatorsByField: Record<TFilterField, FilterOperator[]>;
  filterFieldSchema: z.ZodSchema<TFilterField>;
}): string {
  function isOperatorAllowed(field: TFilterField, operator: FilterOperator): boolean {
    const allowed = allowedOperatorsByField[field];
    return allowed.includes(operator);
  }

  validateBracketBalance(filterString);

  const expressions = splitTopLevel(filterString, ',')
    .map((f) => f.trim())
    .filter(Boolean);

  const parsedFilters: Record<string, TFilterExpression> = {};

  for (const expr of expressions) {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    if (!fieldRaw || !operatorRaw || valueParts.length === 0) {
      throw new Error(`Invalid filter expression format: "${expr}"`);
    }

    let value = valueParts.join(':');

    const field = filterFieldSchema.parse(fieldRaw);
    const operator = FilterOperatorSchema.parse(operatorRaw);

    if (!isOperatorAllowed(field, operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowedOperatorsByField[field].join(', ')}`,
      );
    }

    // Validate + normalize ISO 8601 for date-time fields. A bare YYYY-MM-DD is
    // auto-promoted to midnight-UTC ISO 8601; anything else throws.
    if (dateTimeFields.includes(field)) {
      value = normalizeDateTimeValue(field, value);
    }

    parsedFilters[field] = { field, operator, value } as TFilterExpression;
  }

  // Reconstruct the filter string from validated filters
  return Object.values(parsedFilters)
    .map((f) => `${f.field}:${f.operator}:${f.value}`)
    .join(',');
}

export const exportedForTesting = {
  FilterOperatorSchema,
};
